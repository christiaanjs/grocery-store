import { useState, useEffect, useCallback } from "preact/hooks";
import {
  getFoodLogDay,
  addFoodLogEntries,
  deleteFoodLogEntries,
  listIngredientMacros,
  setIngredientMacros,
  deleteIngredientMacros,
  type FoodLogEntryData,
  type IngredientMacrosData,
  type NutritionTotals,
} from "../api.ts";
import { localDateStr } from "../hooks/useUrlState.ts";

const MEAL_CATEGORIES = ["breakfast", "lunch", "dinner", "snack"];

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

function addDays(dateStr: string, days: number): string {
  const d = new Date(dateStr + "T00:00:00");
  d.setDate(d.getDate() + days);
  return localDateStr(d);
}

function zeroTotals(): NutritionTotals {
  return { calories: 0, protein_g: 0, carbs_g: 0, fat_g: 0 };
}

interface EntryFormState {
  name: string;
  meal_category: string;
  quantity: string;
  unit: string;
  calories: string;
  protein_g: string;
  carbs_g: string;
  fat_g: string;
}

const EMPTY_ENTRY_FORM: EntryFormState = {
  name: "",
  meal_category: "other",
  quantity: "",
  unit: "",
  calories: "",
  protein_g: "",
  carbs_g: "",
  fat_g: "",
};

interface Props {
  onAuthError: (err: unknown) => void;
}

export function Nutrition({ onAuthError }: Props) {
  const [mode, setMode] = useState<"log" | "macros">("log");

  // ── Daily log state ──────────────────────────────────────────────────────
  const [date, setDate] = useState(() => localDateStr(new Date()));
  const [entries, setEntries] = useState<FoodLogEntryData[]>([]);
  const [totals, setTotals] = useState<NutritionTotals>(zeroTotals());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [form, setForm] = useState<EntryFormState>(EMPTY_ENTRY_FORM);
  const [manualCalories, setManualCalories] = useState(false);
  const [adding, setAdding] = useState(false);

  // ── Macros library state ─────────────────────────────────────────────────
  const [macrosLibrary, setMacrosLibrary] = useState<IngredientMacrosData[]>([]);
  const [macrosLoading, setMacrosLoading] = useState(true);
  const [macrosError, setMacrosError] = useState<string | null>(null);
  const [macroForm, setMacroForm] = useState({ name: "", serving_size: "100", serving_unit: "g", calories: "", protein_g: "", carbs_g: "", fat_g: "" });
  const [editingMacro, setEditingMacro] = useState<string | null>(null);

  const loadDay = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const day = await getFoodLogDay(date);
      setEntries(day.entries);
      setTotals(day.totals);
    } catch (err) {
      onAuthError(err);
      setError(err instanceof Error ? err.message : "Failed to load food log");
    } finally {
      setLoading(false);
    }
  }, [date, onAuthError]);

  const loadMacros = useCallback(async () => {
    setMacrosLoading(true);
    setMacrosError(null);
    try {
      setMacrosLibrary(await listIngredientMacros());
    } catch (err) {
      onAuthError(err);
      setMacrosError(err instanceof Error ? err.message : "Failed to load macros library");
    } finally {
      setMacrosLoading(false);
    }
  }, [onAuthError]);

  useEffect(() => { void loadDay(); }, [loadDay]);
  useEffect(() => { void loadMacros(); }, [loadMacros]);

  async function handleAddEntry(e: Event) {
    e.preventDefault();
    const name = form.name.trim();
    if (!name) return;

    if (manualCalories && !form.calories) {
      setError("Calories is required when entering macros manually");
      return;
    }

    setAdding(true);
    setError(null);
    try {
      const entry: Record<string, unknown> = {
        name,
        meal_category: form.meal_category.trim() || "other",
      };
      if (form.quantity) entry["quantity"] = Number(form.quantity);
      if (form.unit.trim()) entry["unit"] = form.unit.trim();
      if (manualCalories) {
        entry["calories"] = Number(form.calories);
        if (form.protein_g) entry["protein_g"] = Number(form.protein_g);
        if (form.carbs_g) entry["carbs_g"] = Number(form.carbs_g);
        if (form.fat_g) entry["fat_g"] = Number(form.fat_g);
      }
      await addFoodLogEntries(date, [entry as never]);
      setForm(EMPTY_ENTRY_FORM);
      setManualCalories(false);
      await loadDay();
    } catch (err) {
      onAuthError(err);
      setError(err instanceof Error ? err.message : "Failed to log entry");
    } finally {
      setAdding(false);
    }
  }

  async function handleDeleteEntry(id: string) {
    try {
      await deleteFoodLogEntries({ ids: [id] });
      setEntries(prev => prev.filter(e => e.id !== id));
      await loadDay();
    } catch (err) {
      onAuthError(err);
      setError(err instanceof Error ? err.message : "Failed to delete entry");
    }
  }

  async function handleSaveMacro(e: Event) {
    e.preventDefault();
    const name = macroForm.name.trim();
    if (!name || !macroForm.calories) return;
    try {
      await setIngredientMacros({
        name,
        serving_size: macroForm.serving_size ? Number(macroForm.serving_size) : undefined,
        serving_unit: macroForm.serving_unit.trim() || undefined,
        calories: Number(macroForm.calories),
        protein_g: macroForm.protein_g ? Number(macroForm.protein_g) : undefined,
        carbs_g: macroForm.carbs_g ? Number(macroForm.carbs_g) : undefined,
        fat_g: macroForm.fat_g ? Number(macroForm.fat_g) : undefined,
      });
      setMacroForm({ name: "", serving_size: "100", serving_unit: "g", calories: "", protein_g: "", carbs_g: "", fat_g: "" });
      setEditingMacro(null);
      await loadMacros();
    } catch (err) {
      onAuthError(err);
      setMacrosError(err instanceof Error ? err.message : "Failed to save macros");
    }
  }

  function startEditMacro(m: IngredientMacrosData) {
    setEditingMacro(m.name);
    setMacroForm({
      name: m.name,
      serving_size: String(m.serving_size),
      serving_unit: m.serving_unit,
      calories: String(m.calories),
      protein_g: m.protein_g != null ? String(m.protein_g) : "",
      carbs_g: m.carbs_g != null ? String(m.carbs_g) : "",
      fat_g: m.fat_g != null ? String(m.fat_g) : "",
    });
  }

  async function handleDeleteMacro(name: string) {
    try {
      await deleteIngredientMacros(name);
      setMacrosLibrary(prev => prev.filter(m => m.name !== name));
    } catch (err) {
      onAuthError(err);
      setMacrosError(err instanceof Error ? err.message : "Failed to delete macros");
    }
  }

  const grouped = entries.reduce<Record<string, FoodLogEntryData[]>>((acc, e) => {
    (acc[e.meal_category] ??= []).push(e);
    return acc;
  }, {});
  const usedCategories = Object.keys(grouped);
  const categoryOrder = [
    ...MEAL_CATEGORIES.filter(c => usedCategories.includes(c)),
    ...usedCategories.filter(c => !MEAL_CATEGORIES.includes(c)).sort(),
  ];

  return (
    <div class="nutrition-view">
      <div class="history-mode-bar">
        <button class={`filter-btn${mode === "log" ? " active" : ""}`} onClick={() => setMode("log")}>
          Daily log
        </button>
        <button class={`filter-btn${mode === "macros" ? " active" : ""}`} onClick={() => setMode("macros")}>
          Macros library
        </button>
      </div>

      {mode === "log" && (
        <div>
          <div class="nutrition-toolbar">
            <button class="btn-secondary" onClick={() => setDate(d => addDays(d, -1))}>← Prev day</button>
            <input
              type="date"
              class="grocery-date-input"
              value={date}
              onInput={e => setDate((e.target as HTMLInputElement).value)}
            />
            <button class="btn-secondary" onClick={() => setDate(d => addDays(d, 1))}>Next day →</button>
            <button class="btn-secondary" onClick={() => setDate(localDateStr(new Date()))}>Today</button>
          </div>

          <div class="nutrition-totals-bar">
            <div class="nutrition-total-stat">
              <span class="nutrition-total-value">{round1(totals.calories)}</span>
              <span class="nutrition-total-label">Calories</span>
            </div>
            <div class="nutrition-total-stat">
              <span class="nutrition-total-value">{round1(totals.protein_g)}g</span>
              <span class="nutrition-total-label">Protein</span>
            </div>
            <div class="nutrition-total-stat">
              <span class="nutrition-total-value">{round1(totals.carbs_g)}g</span>
              <span class="nutrition-total-label">Carbs</span>
            </div>
            <div class="nutrition-total-stat">
              <span class="nutrition-total-value">{round1(totals.fat_g)}g</span>
              <span class="nutrition-total-label">Fat</span>
            </div>
          </div>

          {error && <p class="inline-error">{error}</p>}

          <form class="nutrition-add-form" onSubmit={handleAddEntry}>
            <datalist id="macro-name-options">
              {macrosLibrary.map(m => <option key={m.name} value={m.name} />)}
            </datalist>
            <datalist id="meal-category-options">
              {MEAL_CATEGORIES.map(c => <option key={c} value={c} />)}
            </datalist>
            <div class="nutrition-form-row">
              <input
                type="text"
                list="macro-name-options"
                placeholder="Ingredient or meal name"
                value={form.name}
                onInput={e => setForm(s => ({ ...s, name: (e.target as HTMLInputElement).value }))}
                required
              />
              <input
                type="text"
                list="meal-category-options"
                placeholder="Meal (e.g. breakfast)"
                value={form.meal_category}
                onInput={e => setForm(s => ({ ...s, meal_category: (e.target as HTMLInputElement).value }))}
              />
              <input
                type="number"
                placeholder="Qty"
                value={form.quantity}
                onInput={e => setForm(s => ({ ...s, quantity: (e.target as HTMLInputElement).value }))}
              />
              <input
                type="text"
                placeholder="Unit"
                value={form.unit}
                onInput={e => setForm(s => ({ ...s, unit: (e.target as HTMLInputElement).value }))}
              />
            </div>
            <label class="nutrition-manual-toggle">
              <input
                type="checkbox"
                checked={manualCalories}
                onChange={e => setManualCalories((e.target as HTMLInputElement).checked)}
              />
              Enter calories manually (instead of looking up from the macros library)
            </label>
            {manualCalories && (
              <div class="nutrition-form-row">
                <input
                  type="number"
                  placeholder="Calories*"
                  value={form.calories}
                  onInput={e => setForm(s => ({ ...s, calories: (e.target as HTMLInputElement).value }))}
                  required={manualCalories}
                />
                <input
                  type="number"
                  placeholder="Protein (g)"
                  value={form.protein_g}
                  onInput={e => setForm(s => ({ ...s, protein_g: (e.target as HTMLInputElement).value }))}
                />
                <input
                  type="number"
                  placeholder="Carbs (g)"
                  value={form.carbs_g}
                  onInput={e => setForm(s => ({ ...s, carbs_g: (e.target as HTMLInputElement).value }))}
                />
                <input
                  type="number"
                  placeholder="Fat (g)"
                  value={form.fat_g}
                  onInput={e => setForm(s => ({ ...s, fat_g: (e.target as HTMLInputElement).value }))}
                />
              </div>
            )}
            {!manualCalories && (
              <p class="nutrition-form-hint">
                Leave quantity blank to log a full serving, based on the stored macros for this name.
              </p>
            )}
            <button type="submit" class="btn-primary" disabled={adding || !form.name.trim()}>
              {adding ? "Logging…" : "Log entry"}
            </button>
          </form>

          {loading && <p class="loading">Loading…</p>}

          {!loading && entries.length === 0 && (
            <p class="nutrition-empty">Nothing logged for {date} yet.</p>
          )}

          {!loading && categoryOrder.map(cat => (
            <div key={cat} class="nutrition-group">
              <h3 class="nutrition-group-title">{cat}</h3>
              <ul class="nutrition-entry-list">
                {grouped[cat].map(entry => (
                  <li key={entry.id} class="nutrition-entry">
                    <div class="nutrition-entry-info">
                      <span class="nutrition-entry-name">{entry.name}</span>
                      {(entry.quantity != null || entry.unit) && (
                        <span class="nutrition-entry-meta">
                          {entry.quantity ?? ""} {entry.unit ?? ""}
                        </span>
                      )}
                    </div>
                    <div class="nutrition-entry-macros">
                      <span>{round1(entry.calories)} cal</span>
                      {entry.protein_g != null && <span>{round1(entry.protein_g)}g P</span>}
                      {entry.carbs_g != null && <span>{round1(entry.carbs_g)}g C</span>}
                      {entry.fat_g != null && <span>{round1(entry.fat_g)}g F</span>}
                    </div>
                    <button class="btn-danger nutrition-entry-delete" onClick={() => void handleDeleteEntry(entry.id)}>
                      Delete
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}

      {mode === "macros" && (
        <div>
          {macrosError && <p class="inline-error">{macrosError}</p>}
          <form class="nutrition-add-form" onSubmit={handleSaveMacro}>
            <div class="nutrition-form-row">
              <input
                type="text"
                placeholder="Ingredient name*"
                value={macroForm.name}
                onInput={e => setMacroForm(s => ({ ...s, name: (e.target as HTMLInputElement).value }))}
                disabled={editingMacro !== null}
                required
              />
              <input
                type="number"
                placeholder="Serving size"
                value={macroForm.serving_size}
                onInput={e => setMacroForm(s => ({ ...s, serving_size: (e.target as HTMLInputElement).value }))}
              />
              <input
                type="text"
                placeholder="Unit"
                value={macroForm.serving_unit}
                onInput={e => setMacroForm(s => ({ ...s, serving_unit: (e.target as HTMLInputElement).value }))}
              />
            </div>
            <div class="nutrition-form-row">
              <input
                type="number"
                placeholder="Calories*"
                value={macroForm.calories}
                onInput={e => setMacroForm(s => ({ ...s, calories: (e.target as HTMLInputElement).value }))}
                required
              />
              <input
                type="number"
                placeholder="Protein (g)"
                value={macroForm.protein_g}
                onInput={e => setMacroForm(s => ({ ...s, protein_g: (e.target as HTMLInputElement).value }))}
              />
              <input
                type="number"
                placeholder="Carbs (g)"
                value={macroForm.carbs_g}
                onInput={e => setMacroForm(s => ({ ...s, carbs_g: (e.target as HTMLInputElement).value }))}
              />
              <input
                type="number"
                placeholder="Fat (g)"
                value={macroForm.fat_g}
                onInput={e => setMacroForm(s => ({ ...s, fat_g: (e.target as HTMLInputElement).value }))}
              />
            </div>
            <div class="nutrition-form-actions">
              <button type="submit" class="btn-primary" disabled={!macroForm.name.trim() || !macroForm.calories}>
                {editingMacro ? "Save changes" : "Add to library"}
              </button>
              {editingMacro && (
                <button
                  type="button"
                  class="btn-secondary"
                  onClick={() => { setEditingMacro(null); setMacroForm({ name: "", serving_size: "100", serving_unit: "g", calories: "", protein_g: "", carbs_g: "", fat_g: "" }); }}
                >
                  Cancel
                </button>
              )}
            </div>
          </form>

          {macrosLoading && <p class="loading">Loading…</p>}
          {!macrosLoading && macrosLibrary.length === 0 && (
            <p class="nutrition-empty">No ingredients in your macros library yet.</p>
          )}
          {!macrosLoading && macrosLibrary.length > 0 && (
            <table class="pantry-table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Serving</th>
                  <th>Calories</th>
                  <th>Protein (g)</th>
                  <th>Carbs (g)</th>
                  <th>Fat (g)</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {macrosLibrary.map(m => (
                  <tr key={m.name}>
                    <td>{m.name}</td>
                    <td>{m.serving_size} {m.serving_unit}</td>
                    <td>{m.calories}</td>
                    <td>{m.protein_g ?? "—"}</td>
                    <td>{m.carbs_g ?? "—"}</td>
                    <td>{m.fat_g ?? "—"}</td>
                    <td>
                      <div class="row-actions">
                        <button onClick={() => startEditMacro(m)}>Edit</button>
                        <button class="btn-danger" onClick={() => void handleDeleteMacro(m.name)}>Delete</button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
    </div>
  );
}
