export const EMBEDDING_MODEL = "@cf/baai/bge-base-en-v1.5" as const;
export const EMBEDDING_DIMENSIONS = 768;

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
