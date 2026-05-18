/**
 * Backfill all existing meal_entries into Vectorize.
 *
 * Usage:
 *   npx tsx scripts/backfill-embeddings.ts                    # production, skip already-embedded
 *   npx tsx scripts/backfill-embeddings.ts --replace          # production, re-embed everything
 *   npx tsx scripts/backfill-embeddings.ts --env staging      # staging, skip already-embedded
 *   npx tsx scripts/backfill-embeddings.ts --env staging --replace
 *
 * Required environment variables (or in .dev.vars for local use):
 *   CLOUDFLARE_API_TOKEN   — API token with D1, AI, and Vectorize permissions
 *   CLOUDFLARE_ACCOUNT_ID  — Cloudflare account ID
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { EMBEDDING_MODEL } from "../src/embedding-config.ts";

// ── CLI args ──────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const envName = (() => {
  const i = args.indexOf("--env");
  return i !== -1 ? args[i + 1] : undefined;
})();
const replace = args.includes("--replace");

// ── Load env vars ─────────────────────────────────────────────────────────

function loadDevVars(): Record<string, string> {
  try {
    const raw = readFileSync(resolve(process.cwd(), ".dev.vars"), "utf8");
    return Object.fromEntries(
      raw
        .split("\n")
        .filter((l) => l.includes("=") && !l.startsWith("#"))
        .map((l) => {
          const eq = l.indexOf("=");
          return [l.slice(0, eq).trim(), l.slice(eq + 1).trim()];
        }),
    );
  } catch {
    return {};
  }
}

const devVars = loadDevVars();

function getVar(name: string): string {
  const val = process.env[name] ?? devVars[name];
  if (!val) throw new Error(`Missing required env var: ${name}`);
  return val;
}

const API_TOKEN = getVar("CLOUDFLARE_API_TOKEN");
const ACCOUNT_ID = getVar("CLOUDFLARE_ACCOUNT_ID");
const BASE = `https://api.cloudflare.com/client/v4/accounts/${ACCOUNT_ID}`;

// ── Parse wrangler.toml ───────────────────────────────────────────────────

function parseWranglerToml(envTarget: string | undefined): { dbId: string; indexName: string } {
  const toml = readFileSync(resolve(process.cwd(), "wrangler.toml"), "utf8");

  if (envTarget) {
    // Extract the env section by finding [env.<name>] and reading until the next top-level section
    const envStart = toml.indexOf(`[env.${envTarget}]`);
    if (envStart === -1) throw new Error(`env.${envTarget} not found in wrangler.toml`);
    const section = toml.slice(envStart);

    const dbIdMatch = section.match(/database_id\s*=\s*"([^"]+)"/);
    if (!dbIdMatch) throw new Error(`database_id not found for env.${envTarget}`);

    const indexMatch = section.match(/index_name\s*=\s*"([^"]+)"/);
    if (!indexMatch) throw new Error(`index_name not found for env.${envTarget}`);

    return { dbId: dbIdMatch[1]!, indexName: indexMatch[1]! };
  }

  // Production: extract the first [[d1_databases]] block (before any [env.] section)
  const envSectionStart = toml.search(/^\[env\./m);
  const prodSection = envSectionStart !== -1 ? toml.slice(0, envSectionStart) : toml;

  const dbIdMatch = prodSection.match(/database_id\s*=\s*"([^"]+)"/);
  if (!dbIdMatch) throw new Error("database_id not found in wrangler.toml");

  const indexMatch = prodSection.match(/index_name\s*=\s*"([^"]+)"/);
  if (!indexMatch) throw new Error("index_name not found in wrangler.toml");

  return { dbId: dbIdMatch[1]!, indexName: indexMatch[1]! };
}

const { dbId, indexName } = parseWranglerToml(envName);

// ── Cloudflare REST helpers ───────────────────────────────────────────────

async function cfFetch(path: string, init: RequestInit = {}): Promise<unknown> {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${API_TOKEN}`,
      "Content-Type": "application/json",
      ...(init.headers as Record<string, string> | undefined),
    },
  });
  if (!res.ok) {
    const errorBody = await res.text();
    throw new Error(
      `Cloudflare API request failed: ${res.status} ${res.statusText} - ${errorBody}`,
    );
  }
  const body = await res.json() as { success: boolean; result?: unknown; errors?: unknown[] };
  if (!body.success) {
    throw new Error(`Cloudflare API error: ${JSON.stringify(body.errors)}`);
  }
  return body.result;
}

interface D1Row {
  household_id: string;
  date: string;
  name: string;
  ingredients: string | null;
}

async function d1Query(sql: string, params: unknown[] = []): Promise<D1Row[]> {
  const result = await cfFetch(`/d1/database/${dbId}/query`, {
    method: "POST",
    body: JSON.stringify({ sql, params }),
  }) as Array<{ results: D1Row[] }>;
  return result[0]?.results ?? [];
}

async function getEmbedding(text: string): Promise<number[]> {
  const result = await cfFetch(`/ai/run/${EMBEDDING_MODEL}`, {
    method: "POST",
    body: JSON.stringify({ text: [text] }),
  }) as { data: number[][] };
  return result.data[0]!;
}

interface VectorizeVector {
  id: string;
  values: number[];
  metadata: Record<string, string>;
}

async function upsertVectors(vectors: VectorizeVector[]): Promise<void> {
  // Vectorize upsert uses NDJSON
  const ndjson = vectors.map((v) => JSON.stringify(v)).join("\n");
  const res = await fetch(`${BASE}/vectorize/v2/indexes/${indexName}/upsert`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${API_TOKEN}`,
      "Content-Type": "application/x-ndjson",
    },
    body: ndjson,
  });
  const body = await res.json() as { success: boolean; errors?: unknown[] };
  if (!body.success) throw new Error(`Vectorize upsert error: ${JSON.stringify(body.errors)}`);
}

async function getExistingIds(ids: string[]): Promise<Set<string>> {
  if (ids.length === 0) return new Set();
  const result = (await cfFetch(
    `/vectorize/v2/indexes/${indexName}/get_by_ids`,
    {
      method: "POST",
      body: JSON.stringify({ ids }),
    },
  )) as Array<{ id: string }>;
  return new Set(result.map((v) => v.id));
}

// ── Main ──────────────────────────────────────────────────────────────────

function buildText(name: string, ingredients: string | null): string {
  let text = name;
  if (ingredients) {
    try {
      const ings = JSON.parse(ingredients) as Array<{ name: string }>;
      const names = ings.map((i) => i.name).join(", ");
      if (names) text += `. Ingredients: ${names}`;
    } catch { /* skip */ }
  }
  return text;
}

const BATCH_SIZE = 100;

async function run(): Promise<void> {
  console.log(`Target: ${envName ?? "production"} | Index: ${indexName} | DB: ${dbId}`);
  console.log(`Mode: ${replace ? "replace (re-embed all)" : "skip existing"}`);
  console.log();

  const rows = await d1Query(
    "SELECT household_id, date, name, ingredients FROM meal_entries ORDER BY date DESC",
  );
  console.log(`Found ${rows.length} meal entries`);

  if (rows.length === 0) return;

  const allIds = rows.map((r) => `${r.household_id}:${r.date}`);
  const existingIds = replace ? new Set<string>() : await getExistingIds(allIds);
  console.log(`Skipping ${existingIds.size} already-embedded meals`);
  console.log();

  const toEmbed = rows.filter((r) => !existingIds.has(`${r.household_id}:${r.date}`));
  let processed = 0;
  let failed = 0;

  for (let i = 0; i < toEmbed.length; i += BATCH_SIZE) {
    const batch = toEmbed.slice(i, i + BATCH_SIZE);
    const vectors: VectorizeVector[] = [];

    for (const row of batch) {
      try {
        const text = buildText(row.name, row.ingredients);
        const values = await getEmbedding(text);
        vectors.push({
          id: `${row.household_id}:${row.date}`,
          values,
          metadata: { household_id: row.household_id, date: row.date },
        });
        processed++;
      } catch (err) {
        console.error(`  Failed to embed ${row.date} "${row.name}": ${err}`);
        failed++;
      }
    }

    if (vectors.length > 0) {
      await upsertVectors(vectors);
    }

    const done = Math.min(i + BATCH_SIZE, toEmbed.length);
    console.log(`  Batch ${Math.ceil((i + 1) / BATCH_SIZE)}: ${done}/${toEmbed.length} processed, ${failed} failed`);
  }

  console.log();
  console.log(`Done. Embedded: ${processed}, Failed: ${failed}, Skipped: ${existingIds.size}`);
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
