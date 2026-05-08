import { useState, useEffect } from "preact/hooks";
import { listPantryItems, updatePantryItem, markItemsOut, type PantryItem } from "../api.ts";
import { replaceUrl, type Filter } from "../hooks/useUrlState.ts";

interface EditState {
  name: string;
  category: string;
  quantity: string;
  unit: string;
}

interface Props {
  onAuthError: (err: unknown) => void;
  initialFilter?: Filter;
  initialSearch?: string;
}

export function Pantry({ onAuthError, initialFilter, initialSearch }: Props) {
  const [items, setItems] = useState<PantryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<Filter>(initialFilter ?? "all");
  const [search, setSearch] = useState(initialSearch ?? "");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editState, setEditState] = useState<EditState>({ name: "", category: "", quantity: "", unit: "" });
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [addingNew, setAddingNew] = useState(false);
  const [newItem, setNewItem] = useState<EditState>({ name: "", category: "", quantity: "", unit: "" });

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const opts: { in_stock?: boolean } = {};
      if (filter === "in_stock") opts.in_stock = true;
      if (filter === "out_of_stock") opts.in_stock = false;
      const data = await listPantryItems(opts);
      setItems(data);
    } catch (err) {
      onAuthError(err);
      setError(err instanceof Error ? err.message : "Failed to load pantry");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void load(); }, [filter]);

  useEffect(() => {
    replaceUrl({ tab: "pantry", filter, search, from: undefined, to: undefined });
  }, [filter, search]);

  function startEdit(item: PantryItem) {
    setEditingId(item.id);
    setEditState({
      name: item.name,
      category: item.category ?? "",
      quantity: item.quantity != null ? String(item.quantity) : "",
      unit: item.unit ?? "",
    });
  }

  async function saveEdit(item: PantryItem) {
    try {
      const updated = await updatePantryItem({
        name: editState.name || item.name,
        category: editState.category || undefined,
        quantity: editState.quantity ? Number(editState.quantity) : undefined,
        unit: editState.unit || undefined,
        in_stock: item.in_stock === 1,
      });
      setItems(prev => prev.map(i => i.id === item.id ? updated : i));
      setEditingId(null);
    } catch (err) {
      onAuthError(err);
      setError(err instanceof Error ? err.message : "Save failed");
    }
  }

  async function toggleStock(item: PantryItem) {
    try {
      const updated = await updatePantryItem({
        name: item.name,
        category: item.category ?? undefined,
        quantity: item.quantity ?? undefined,
        unit: item.unit ?? undefined,
        in_stock: item.in_stock === 0,
      });
      setItems(prev => prev.map(i => i.id === item.id ? updated : i));
    } catch (err) {
      onAuthError(err);
    }
  }

  async function markSelectedOut() {
    const names = items.filter(i => selected.has(i.id)).map(i => i.name);
    if (!names.length) return;
    try {
      await markItemsOut(names);
      setItems(prev => prev.map(i => selected.has(i.id) ? { ...i, in_stock: 0 } : i));
      setSelected(new Set());
    } catch (err) {
      onAuthError(err);
      setError(err instanceof Error ? err.message : "Mark out failed");
    }
  }

  async function saveNewItem() {
    if (!newItem.name.trim()) return;
    try {
      const created = await updatePantryItem({
        name: newItem.name.trim(),
        category: newItem.category || undefined,
        quantity: newItem.quantity ? Number(newItem.quantity) : undefined,
        unit: newItem.unit || undefined,
        in_stock: true,
      });
      setItems(prev => [...prev, created]);
      setAddingNew(false);
      setNewItem({ name: "", category: "", quantity: "", unit: "" });
    } catch (err) {
      onAuthError(err);
      setError(err instanceof Error ? err.message : "Add item failed");
    }
  }

  const visible = items.filter(item => {
    if (!search) return true;
    return item.name.toLowerCase().includes(search.toLowerCase());
  });

  const grouped = visible.reduce<Record<string, PantryItem[]>>((acc, item) => {
    const cat = item.category ?? "Uncategorized";
    (acc[cat] ??= []).push(item);
    return acc;
  }, {});

  const categories = Object.keys(grouped).sort();

  return (
    <div>
      <div class="pantry-toolbar">
        <input
          type="text"
          placeholder="Search items…"
          value={search}
          onInput={e => setSearch((e.target as HTMLInputElement).value)}
        />
        {(["all", "in_stock", "out_of_stock"] as Filter[]).map(f => (
          <button
            key={f}
            class={`filter-btn${filter === f ? " active" : ""}`}
            onClick={() => setFilter(f)}
          >
            {f === "all" ? "All" : f === "in_stock" ? "In stock" : "Out of stock"}
          </button>
        ))}
        <button class="add-item-btn" onClick={() => setAddingNew(true)}>+ Add item</button>
      </div>

      {error && <p class="inline-error">{error}</p>}
      {loading && <p class="loading">Loading…</p>}

      {!loading && (
        <table class="pantry-table">
          <thead>
            <tr>
              <th style="width:32px" />
              <th>Name</th>
              <th>Category</th>
              <th>Quantity</th>
              <th>Unit</th>
              <th>In stock</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {categories.map(cat =>
              grouped[cat].map(item => (
                <tr key={item.id} class={item.in_stock === 0 ? "out-of-stock" : ""}>
                  <td>
                    <input
                      type="checkbox"
                      checked={selected.has(item.id)}
                      onChange={() => {
                        const next = new Set(selected);
                        if (next.has(item.id)) next.delete(item.id);
                        else next.add(item.id);
                        setSelected(next);
                      }}
                    />
                  </td>
                  {editingId === item.id ? (
                    <>
                      <td class="edit-row"><input type="text" value={editState.name} onInput={e => setEditState(s => ({ ...s, name: (e.target as HTMLInputElement).value }))} /></td>
                      <td class="edit-row"><input type="text" value={editState.category} onInput={e => setEditState(s => ({ ...s, category: (e.target as HTMLInputElement).value }))} /></td>
                      <td class="edit-row"><input type="text" value={editState.quantity} onInput={e => setEditState(s => ({ ...s, quantity: (e.target as HTMLInputElement).value }))} /></td>
                      <td class="edit-row"><input type="text" value={editState.unit} onInput={e => setEditState(s => ({ ...s, unit: (e.target as HTMLInputElement).value }))} /></td>
                      <td />
                      <td>
                        <div class="row-actions">
                          <button class="save-btn" onClick={() => void saveEdit(item)}>Save</button>
                          <button onClick={() => setEditingId(null)}>Cancel</button>
                        </div>
                      </td>
                    </>
                  ) : (
                    <>
                      <td>{item.name}</td>
                      <td>{item.category ? <span class="category-badge">{item.category}</span> : null}</td>
                      <td>{item.quantity ?? "—"}</td>
                      <td>{item.unit ?? "—"}</td>
                      <td>
                        <input
                          class="stock-toggle"
                          type="checkbox"
                          checked={item.in_stock === 1}
                          onChange={() => void toggleStock(item)}
                        />
                      </td>
                      <td>
                        <div class="row-actions">
                          <button onClick={() => startEdit(item)}>Edit</button>
                        </div>
                      </td>
                    </>
                  )}
                </tr>
              ))
            )}

            {addingNew && (
              <tr>
                <td />
                <td class="edit-row"><input type="text" placeholder="Name*" value={newItem.name} onInput={e => setNewItem(s => ({ ...s, name: (e.target as HTMLInputElement).value }))} /></td>
                <td class="edit-row"><input type="text" placeholder="Category" value={newItem.category} onInput={e => setNewItem(s => ({ ...s, category: (e.target as HTMLInputElement).value }))} /></td>
                <td class="edit-row"><input type="text" placeholder="Qty" value={newItem.quantity} onInput={e => setNewItem(s => ({ ...s, quantity: (e.target as HTMLInputElement).value }))} /></td>
                <td class="edit-row"><input type="text" placeholder="Unit" value={newItem.unit} onInput={e => setNewItem(s => ({ ...s, unit: (e.target as HTMLInputElement).value }))} /></td>
                <td />
                <td>
                  <div class="row-actions">
                    <button class="save-btn" onClick={() => void saveNewItem()}>Add</button>
                    <button onClick={() => setAddingNew(false)}>Cancel</button>
                  </div>
                </td>
              </tr>
            )}
          </tbody>
        </table>
      )}

      {selected.size > 0 && (
        <div class="bulk-actions">
          <button class="mark-out-btn" onClick={() => void markSelectedOut()}>
            Mark {selected.size} out of stock
          </button>
        </div>
      )}
    </div>
  );
}
