import { useState, useEffect, useCallback } from "preact/hooks";
import { getMealPlan, listPantryItems } from "../api.ts";
import type { PantryItem } from "../api.ts";
import { localDateStr } from "../hooks/useUrlState.ts";

interface GroceryItem {
  name: string;
  quantity?: number;
  unit?: string;
  category: string | null;
}

function addDays(date: Date, days: number): Date {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}

function formatItem(item: GroceryItem): string {
  if (item.quantity !== undefined && item.unit) {
    return `${item.name} (${item.quantity} ${item.unit})`;
  }
  if (item.quantity !== undefined) {
    return `${item.name} (${item.quantity})`;
  }
  return item.name;
}

function itemKey(item: GroceryItem): string {
  return `${item.name}|${item.unit ?? ""}`;
}

function buildGroceryList(
  meals: Awaited<ReturnType<typeof getMealPlan>>,
  pantry: PantryItem[],
): GroceryItem[] {
  const pantryMap = new Map<string, PantryItem>();
  for (const p of pantry) {
    pantryMap.set(p.name.toLowerCase(), p);
  }

  // Aggregate ingredients: key = "name_lower|unit_lower"
  const aggregated = new Map<string, GroceryItem>();
  for (const meal of meals) {
    for (const ing of meal.ingredients ?? []) {
      const key = `${ing.name.toLowerCase()}|${(ing.unit ?? "").toLowerCase()}`;
      const existing = aggregated.get(key);
      if (existing) {
        if (ing.quantity !== undefined) {
          existing.quantity = (existing.quantity ?? 0) + ing.quantity;
        }
      } else {
        const pantryItem = pantryMap.get(ing.name.toLowerCase());
        aggregated.set(key, {
          name: ing.name,
          quantity: ing.quantity,
          unit: ing.unit,
          category: pantryItem?.category ?? null,
        });
      }
    }
  }

  // Keep only items missing from pantry or out of stock
  return [...aggregated.values()].filter(ing => {
    const p = pantryMap.get(ing.name.toLowerCase());
    return !p || p.in_stock === 0;
  });
}

function sortItems(items: GroceryItem[], groupByCategory: boolean): GroceryItem[] {
  return [...items].sort((a, b) => {
    if (groupByCategory) {
      const catCmp = (a.category ?? "Uncategorized").localeCompare(b.category ?? "Uncategorized");
      if (catCmp !== 0) return catCmp;
    }
    return a.name.localeCompare(b.name);
  });
}

function toMarkdown(items: GroceryItem[], groupByCategory: boolean): string {
  if (items.length === 0) return "*(no missing ingredients)*";

  const sorted = sortItems(items, groupByCategory);

  if (!groupByCategory) {
    return sorted.map(item => `- ${formatItem(item)}`).join("\n");
  }

  const groups = new Map<string, GroceryItem[]>();
  for (const item of sorted) {
    const cat = item.category ?? "Uncategorized";
    if (!groups.has(cat)) groups.set(cat, []);
    groups.get(cat)!.push(item);
  }

  return [...groups.entries()]
    .map(([cat, catItems]) => `## ${cat}\n${catItems.map(i => `- ${formatItem(i)}`).join("\n")}`)
    .join("\n\n");
}

export function GroceryList({ onAuthError }: { onAuthError: (err: unknown) => void }) {
  const today = localDateStr(new Date());
  const weekEnd = localDateStr(addDays(new Date(), 6));

  const [from, setFrom] = useState(today);
  const [to, setTo] = useState(weekEnd);
  const [groupByCategory, setGroupByCategory] = useState(true);
  const [items, setItems] = useState<GroceryItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [meals, pantry] = await Promise.all([getMealPlan(from, to), listPantryItems()]);
      setItems(buildGroceryList(meals, pantry));
    } catch (err) {
      onAuthError(err);
      setError(err instanceof Error ? err.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }, [from, to, onAuthError]);

  useEffect(() => {
    void load();
  }, [load]);

  async function copyToClipboard() {
    const md = toMarkdown(items, groupByCategory);
    try {
      await navigator.clipboard.writeText(md);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard API unavailable — nothing to do
    }
  }

  const sorted = sortItems(items, groupByCategory);

  function renderList() {
    if (sorted.length === 0) {
      return <p class="grocery-empty">No missing ingredients for this period.</p>;
    }

    if (!groupByCategory) {
      return (
        <ul class="grocery-list">
          {sorted.map(item => (
            <li key={itemKey(item)}>{formatItem(item)}</li>
          ))}
        </ul>
      );
    }

    const groups = new Map<string, GroceryItem[]>();
    for (const item of sorted) {
      const cat = item.category ?? "Uncategorized";
      if (!groups.has(cat)) groups.set(cat, []);
      groups.get(cat)!.push(item);
    }

    return (
      <>
        {[...groups.entries()].map(([cat, catItems]) => (
          <div key={cat} class="grocery-category">
            <h3 class="grocery-category-name">{cat}</h3>
            <ul class="grocery-list">
              {catItems.map(item => (
                <li key={itemKey(item)}>{formatItem(item)}</li>
              ))}
            </ul>
          </div>
        ))}
      </>
    );
  }

  return (
    <div class="grocery-view">
      <div class="grocery-toolbar">
        <label class="grocery-date-label">
          From
          <input
            type="date"
            class="grocery-date-input"
            value={from}
            onInput={e => setFrom((e.target as HTMLInputElement).value)}
          />
        </label>
        <label class="grocery-date-label">
          To
          <input
            type="date"
            class="grocery-date-input"
            value={to}
            onInput={e => setTo((e.target as HTMLInputElement).value)}
          />
        </label>
        <label class="grocery-group-toggle">
          <input
            type="checkbox"
            checked={groupByCategory}
            onChange={e => setGroupByCategory((e.target as HTMLInputElement).checked)}
          />
          Group by category
        </label>
        <button
          class="btn-primary grocery-copy-btn"
          onClick={() => void copyToClipboard()}
          disabled={items.length === 0}
        >
          {copied ? "Copied!" : "Copy as Markdown"}
        </button>
      </div>

      {loading && <div class="loading">Loading…</div>}
      {error && <p class="inline-error">{error}</p>}
      {!loading && !error && renderList()}
    </div>
  );
}
