import { useState, useEffect, useCallback } from "preact/hooks";
import { getGroceryList, bulkUpdatePantry, getGoogleIntegrationStatus, exportGroceryListToKeep, AuthError } from "../api.ts";
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
  return item.name;
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
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [marking, setMarking] = useState(false);
  const [keepConnected, setKeepConnected] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [exportUrl, setExportUrl] = useState<string | null>(null);

  useEffect(() => {
    getGoogleIntegrationStatus()
      .then(s => setKeepConnected(s.connected))
      .catch(err => {
        if (err instanceof AuthError) onAuthError(err);
        // Non-auth errors: silently hide the Keep button
      });
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    setSelected(new Set());
    setExportUrl(null);
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

  async function exportToKeep() {
    setExporting(true);
    setError(null);
    setExportUrl(null);
    try {
      const result = await exportGroceryListToKeep({ date_from: from, date_to: to });
      setExportUrl(result.url);
    } catch (err) {
      onAuthError(err);
      setError(err instanceof Error ? err.message : "Export to Keep failed");
    } finally {
      setExporting(false);
    }
  }

  function toggleItem(key: string) {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  function toggleSelectAll() {
    if (selected.size === items.length) {
      setSelected(new Set());
    } else {
      setSelected(new Set(items.map(itemKey)));
    }
  }

  async function markAsBought() {
    const toBuy = items.filter(i => selected.has(itemKey(i)));
    if (toBuy.length === 0) return;
    setMarking(true);
    setError(null);
    try {
      await bulkUpdatePantry(
        toBuy.map(i => ({
          name: i.name,
          ...(i.category != null ? { category: i.category } : {}),
          ...(i.quantity !== undefined ? { quantity: i.quantity } : {}),
          ...(i.unit !== undefined ? { unit: i.unit } : {}),
          in_stock: true,
        })),
      );
      await load();
    } catch (err) {
      onAuthError(err);
      setError(err instanceof Error ? err.message : "Failed to update pantry");
    } finally {
      setMarking(false);
    }
  }

  function renderItem(item: GroceryItem) {
    const key = itemKey(item);
    return (
      <li key={key} class={`grocery-item${selected.has(key) ? " grocery-item--selected" : ""}`}>
        <input
          type="checkbox"
          class="grocery-item-check"
          checked={selected.has(key)}
          onChange={() => toggleItem(key)}
        />
        <span>{formatItem(item)}</span>
      </li>
    );
  }

  function renderList() {
    if (items.length === 0) {
      return <p class="grocery-empty">No missing ingredients for this period.</p>;
    }

    const allSelected = selected.size === items.length;

    const list = groupByCategory ? (() => {
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
              <ul class="grocery-list">{catItems.map(renderItem)}</ul>
            </div>
          ))}
        </>
      );
    })() : (
      <ul class="grocery-list">{items.map(renderItem)}</ul>
    );

    return (
      <>
        <div class="grocery-selection-bar">
          <label class="grocery-select-all">
            <input
              type="checkbox"
              checked={allSelected}
              onChange={toggleSelectAll}
            />
            {allSelected ? "Deselect all" : "Select all"}
          </label>
          {selected.size > 0 && (
            <button
              class="btn-primary grocery-mark-btn"
              onClick={() => void markAsBought()}
              disabled={marking}
            >
              {marking ? "Updating…" : `Mark as bought (${selected.size})`}
            </button>
          )}
        </div>
        {list}
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
        {keepConnected && (
          <button
            class="btn-secondary grocery-keep-btn"
            onClick={() => void exportToKeep()}
            disabled={items.length === 0 || exporting}
          >
            {exporting ? "Exporting…" : "Export to Keep"}
          </button>
        )}
      </div>

      {exportUrl && (
        <p class="grocery-keep-result">
          Exported!{" "}
          <a href={exportUrl} target="_blank" rel="noopener noreferrer" class="keep-link">
            Open in Google Keep ↗
          </a>
        </p>
      )}

      {loading && <div class="loading">Loading…</div>}
      {error && <p class="inline-error">{error}</p>}
      {!loading && !error && renderList()}
    </div>
  );
}
