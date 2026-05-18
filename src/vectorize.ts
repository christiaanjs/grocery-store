import type { Env } from "./types.ts";
import { EMBEDDING_MODEL, EMBEDDING_DIMENSIONS, buildMealText } from "./embedding-config.ts";

export { buildMealText };

/**
 * Returns the Vectorize and AI bindings, or null if either is absent.
 * Tests use wrangler.test.toml which omits these bindings, so both are
 * undefined in tests and this returns null — falling back to keyword search.
 */
export function getVectorizeBindings(env: Env): { index: VectorizeIndex; ai: Ai } | null {
  const index = env.MEAL_EMBEDDINGS;
  const ai = env.AI;
  if (!index || !ai) return null;
  return { index, ai };
}

export async function embedText(ai: Ai, text: string): Promise<number[]> {
  const result = await ai.run(EMBEDDING_MODEL, { text: [text] }) as { data: number[][] };
  const vector = result.data[0];
  if (!vector || vector.length !== EMBEDDING_DIMENSIONS) {
    throw new Error(`Expected ${EMBEDDING_DIMENSIONS}-dim embedding vector, got ${vector?.length ?? 0}`);
  }
  return vector;
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
