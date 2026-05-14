import { useState, useEffect, useCallback } from "preact/hooks";
import { getGroceryList } from "../api.ts";
import type { GroceryItem } from "../api.ts";
import { localDateStr } from "../hooks/useUrlState.ts";

function addDays(date: Date, days: number): Date {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}

function formatItem(item: GroceryItem): string {
  if (item.quantity !== undefined && item.unit) return `${item.name} (${item.quantity} ${item.unit})`;
  if (item.quantity !== undefined) return `${item.name} (${item.quantity})`;
  return item.name;
}

function itemKey(item: GroceryItem): string {
  return `${item.name}|${item.unit ?? ""}`;
}

function toClipboardText(items: GroceryItem[], groupByCategory: boolean): string {
  if (items.length === 0) return "";

  if (!groupByCategory) {
    return items.map(formatItem).join("\n");
  }

  const groups = new Map<string, GroceryItem[]>();
  for (const item of items) {
    const cat = item.category ?? "Uncategorized";
    if (!groups.has(cat)) groups.set(cat, []);
    groups.get(cat)!.push(item);
  }

  return [...groups.entries()]
    .map(([cat, catItems]) => `${cat}\n${catItems.map(formatItem).join("\n")}`)
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
      setItems(await getGroceryList(from, to));
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
    try {
      await navigator.clipboard.writeText(toClipboardText(items, groupByCategory));
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard API unavailable
    }
  }

  function renderList() {
    if (items.length === 0) {
      return <p class="grocery-empty">No missing ingredients for this period.</p>;
    }

    if (!groupByCategory) {
      return (
        <ul class="grocery-list">
          {items.map(item => (
            <li key={itemKey(item)}>{formatItem(item)}</li>
          ))}
        </ul>
      );
    }

    const groups = new Map<string, GroceryItem[]>();
    for (const item of items) {
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
          {copied ? "Copied!" : "Copy grocery list"}
        </button>
      </div>

      {loading && <div class="loading">Loading…</div>}
      {error && <p class="inline-error">{error}</p>}
      {!loading && !error && renderList()}
    </div>
  );
}
