import type { Env } from "./types.ts";
import { EMBEDDING_MODEL } from "./embedding-config.ts";

/**
 * Safely resolves the AI and Vectorize bindings from env.
 * Returns null when bindings are absent or when Miniflare's local stub proxy
 * throws on property access (e.g. in CI without Cloudflare credentials).
 */
export function getVectorizeBindings(env: Env): { index: VectorizeIndex; ai: Ai } | null {
  try {
    const index = env.MEAL_EMBEDDINGS;
    const ai = env.AI;
    if (!index || !ai) return null;
    return { index, ai };
  } catch {
    return null;
  }
}

export function buildMealText(name: string, ingredients: string | null, tags: string[] = []): string {
  let text = name;
  if (ingredients) {
    try {
      const ings = JSON.parse(ingredients) as Array<{ name: string }>;
      const ingNames = ings.map((i) => i.name).join(", ");
      if (ingNames) text += `. Ingredients: ${ingNames}`;
    } catch { /* ignore malformed JSON */ }
  }
  if (tags.length > 0) text += `. Tags: ${tags.join(", ")}`;
  return text;
}

export async function embedText(ai: Ai, text: string): Promise<number[]> {
  const result = await ai.run(EMBEDDING_MODEL, { text: [text] }) as { data: number[][] };
  return result.data[0]!;
}

export async function upsertMealVector(
  index: VectorizeIndex,
  householdId: string,
  date: string,
  ai: Ai,
  name: string,
  ingredients: string | null,
  tags: string[],
): Promise<void> {
  const text = buildMealText(name, ingredients, tags);
  const values = await embedText(ai, text);
  await index.upsert([{
    id: `${householdId}:${date}`,
    values,
    metadata: { household_id: householdId, date },
  }]);
}

export async function deleteMealVector(
  index: VectorizeIndex,
  householdId: string,
  date: string,
): Promise<void> {
  await index.deleteByIds([`${householdId}:${date}`]);
}

export async function queryMealVectors(
  index: VectorizeIndex,
  householdId: string,
  ai: Ai,
  query: string,
  topK = 20,
): Promise<string[]> {
  const values = await embedText(ai, query);
  const result = await index.query(values, {
    topK,
    filter: { household_id: { $eq: householdId } },
    returnMetadata: "all",
  });
  return result.matches.map((m) => (m.metadata as { date: string }).date);
}
