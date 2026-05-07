import { useState } from "preact/hooks";
import type { ComponentType } from "preact";
import _FullCalendar from "@fullcalendar/react";
// @fullcalendar/react is a React class component; cast to Preact ComponentType to work with preact/compat aliasing at runtime.
const FullCalendar = _FullCalendar as unknown as ComponentType<Record<string, unknown>>;
import dayGridPlugin from "@fullcalendar/daygrid";
import interactionPlugin from "@fullcalendar/interaction";
import type { DateClickArg } from "@fullcalendar/interaction";
import type { DatesSetArg, EventClickArg, EventInput, EventDropArg } from "@fullcalendar/core";
import { getMealPlan, setMeals, deleteMeals, type MealEntry, type MealIngredient } from "../api.ts";

interface Props {
  onAuthError: (err: unknown) => void;
}

interface ModalState {
  date: string;
  existing: MealEntry | null;
}

interface FormIngredient {
  name: string;
  quantity: string;
  unit: string;
}

function toCalendarEvents(meals: MealEntry[]): EventInput[] {
  return meals.map(m => ({
    id: m.date,
    title: m.name,
    start: m.date,
    allDay: true,
    extendedProps: { meal: m },
  }));
}

export function MealPlan({ onAuthError }: Props) {
  const [meals, setMealsState] = useState<MealEntry[]>([]);
  const [modal, setModal] = useState<ModalState | null>(null);
  const [error, setError] = useState<string | null>(null);

  // ── Load meals whenever the visible date range changes ─────────────────

  async function onDatesSet({ startStr, endStr }: DatesSetArg) {
    setError(null);
    try {
      const data = await getMealPlan(startStr.slice(0, 10), endStr.slice(0, 10));
      setMealsState(data);
    } catch (err) {
      onAuthError(err);
      setError(err instanceof Error ? err.message : "Failed to load meals");
    }
  }

  // ── Drag-and-drop: move or swap ────────────────────────────────────────

  async function onEventDrop({ event, oldEvent, revert }: EventDropArg) {
    const newDate = event.startStr.slice(0, 10);
    const oldDate = (oldEvent.startStr ?? "").slice(0, 10);
    const draggedMeal = (event.extendedProps as { meal: MealEntry }).meal;
    const occupant = meals.find(m => m.date === newDate && m.date !== oldDate);

    try {
      const updates: Parameters<typeof setMeals>[0] = [];

      updates.push({
        date: newDate,
        name: draggedMeal.name,
        ingredients: draggedMeal.ingredients
          ? (JSON.parse(draggedMeal.ingredients) as MealIngredient[])
          : undefined,
        steps: draggedMeal.steps ? (JSON.parse(draggedMeal.steps) as string[]) : undefined,
      });

      if (occupant) {
        // Swap: displace the occupant back to the old date
        updates.push({
          date: oldDate,
          name: occupant.name,
          ingredients: occupant.ingredients
            ? (JSON.parse(occupant.ingredients) as MealIngredient[])
            : undefined,
          steps: occupant.steps ? (JSON.parse(occupant.steps) as string[]) : undefined,
        });
      } else {
        // Pure move: clear the old date
        await deleteMeals([oldDate]);
      }

      const saved = await setMeals(updates);

      // Update state — FullCalendar re-renders reactively from the events prop
      setMealsState(prev => {
        const next = prev.filter(m => m.date !== newDate && m.date !== oldDate);
        return [...next, ...saved];
      });
    } catch (err) {
      revert();
      onAuthError(err);
      setError(err instanceof Error ? err.message : "Failed to move meal");
    }
  }

  // ── Open modal for adding / editing ───────────────────────────────────

  function onDateClick({ dateStr }: DateClickArg) {
    const existing = meals.find(m => m.date === dateStr) ?? null;
    setModal({ date: dateStr, existing });
  }

  function onEventClick({ event }: EventClickArg) {
    const meal = (event.extendedProps as { meal: MealEntry }).meal;
    setModal({ date: meal.date, existing: meal });
  }

  // ── Save from modal ───────────────────────────────────────────────────

  async function onModalSave(entry: {
    date: string;
    name: string;
    ingredients: MealIngredient[];
    steps: string[];
  }) {
    try {
      const [saved] = await setMeals([entry]);
      setMealsState(prev => {
        const next = prev.filter(m => m.date !== entry.date);
        return [...next, saved];
      });
      setModal(null);
    } catch (err) {
      onAuthError(err);
      setError(err instanceof Error ? err.message : "Failed to save meal");
    }
  }

  async function onModalDelete(date: string) {
    try {
      await deleteMeals([date]);
      setMealsState(prev => prev.filter(m => m.date !== date));
      setModal(null);
    } catch (err) {
      onAuthError(err);
      setError(err instanceof Error ? err.message : "Failed to delete meal");
    }
  }

  return (
    <div class="meal-plan-view">
      {error && <p class="inline-error">{error}</p>}

      <FullCalendar
        plugins={[dayGridPlugin, interactionPlugin]}
        initialView="dayGridMonth"
        headerToolbar={{ left: "prev,next today", center: "title", right: "dayGridMonth,dayGridWeek" }}
        editable={true}
        events={toCalendarEvents(meals)}
        datesSet={onDatesSet}
        eventDrop={onEventDrop}
        dateClick={onDateClick}
        eventClick={onEventClick}
        height="auto"
      />

      {modal && (
        <MealModal
          date={modal.date}
          existing={modal.existing}
          onSave={onModalSave}
          onDelete={onModalDelete}
          onClose={() => setModal(null)}
        />
      )}
    </div>
  );
}

// ── Meal modal ────────────────────────────────────────────────────────────

interface MealModalProps {
  date: string;
  existing: MealEntry | null;
  onSave: (entry: { date: string; name: string; ingredients: MealIngredient[]; steps: string[] }) => void;
  onDelete: (date: string) => void;
  onClose: () => void;
}

function MealModal({ date, existing, onSave, onDelete, onClose }: MealModalProps) {
  const [name, setName] = useState(existing?.name ?? "");
  const [ingredients, setIngredients] = useState<FormIngredient[]>(() => {
    if (!existing?.ingredients) return [{ name: "", quantity: "", unit: "" }];
    const parsed = JSON.parse(existing.ingredients) as MealIngredient[];
    return parsed.map(i => ({ name: i.name, quantity: i.quantity != null ? String(i.quantity) : "", unit: i.unit ?? "" }));
  });
  const [steps, setSteps] = useState(() => {
    if (!existing?.steps) return "";
    const parsed = JSON.parse(existing.steps) as string[];
    return parsed.join("\n");
  });

  function handleSave() {
    if (!name.trim()) return;
    const cleanedIngredients = ingredients
      .filter(i => i.name.trim())
      .map(i => ({
        name: i.name.trim(),
        ...(i.quantity ? { quantity: Number(i.quantity) } : {}),
        ...(i.unit ? { unit: i.unit.trim() } : {}),
      }));
    const cleanedSteps = steps
      .split("\n")
      .map(s => s.trim())
      .filter(Boolean);
    onSave({ date, name: name.trim(), ingredients: cleanedIngredients, steps: cleanedSteps });
  }

  return (
    <div class="modal-backdrop" onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div class="modal">
        <h2>{existing ? "Edit meal" : "Add meal"} — {date}</h2>

        <label>Meal name</label>
        <input
          type="text"
          value={name}
          onInput={e => setName((e.target as HTMLInputElement).value)}
          placeholder="e.g. Pasta carbonara"
          autofocus
        />

        <label>Ingredients</label>
        {ingredients.map((ing, idx) => (
          <div key={idx} class="ingredient-row">
            <input
              type="text"
              placeholder="Ingredient"
              value={ing.name}
              onInput={e => {
                const v = (e.target as HTMLInputElement).value;
                setIngredients(prev => prev.map((i, j) => j === idx ? { ...i, name: v } : i));
              }}
            />
            <input
              type="number"
              placeholder="Qty"
              value={ing.quantity}
              onInput={e => {
                const v = (e.target as HTMLInputElement).value;
                setIngredients(prev => prev.map((i, j) => j === idx ? { ...i, quantity: v } : i));
              }}
            />
            <input
              type="text"
              placeholder="Unit"
              value={ing.unit}
              onInput={e => {
                const v = (e.target as HTMLInputElement).value;
                setIngredients(prev => prev.map((i, j) => j === idx ? { ...i, unit: v } : i));
              }}
            />
            {ingredients.length > 1 && (
              <button onClick={() => setIngredients(prev => prev.filter((_, j) => j !== idx))}>✕</button>
            )}
          </div>
        ))}
        <button class="add-ingredient-btn" onClick={() => setIngredients(prev => [...prev, { name: "", quantity: "", unit: "" }])}>
          + Add ingredient
        </button>

        <label>Steps (one per line)</label>
        <textarea
          value={steps}
          onInput={e => setSteps((e.target as HTMLTextAreaElement).value)}
          placeholder={"Cook pasta al dente\nFry guanciale until crispy\n…"}
        />

        <div class="modal-footer">
          {existing && (
            <button class="btn-danger" onClick={() => onDelete(date)}>Delete</button>
          )}
          <button class="btn-secondary" onClick={onClose}>Cancel</button>
          <button class="btn-primary" onClick={handleSave} disabled={!name.trim()}>
            Save
          </button>
        </div>
      </div>
    </div>
  );
}
