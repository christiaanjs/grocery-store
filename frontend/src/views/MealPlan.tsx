import { useState, useEffect } from "preact/hooks";
import type { ComponentType } from "preact";
import _FullCalendar from "@fullcalendar/react";
// @fullcalendar/react is a React class component; cast to Preact ComponentType to work with preact/compat aliasing at runtime.
const FullCalendar = _FullCalendar as unknown as ComponentType<Record<string, unknown>>;
import dayGridPlugin from "@fullcalendar/daygrid";
import interactionPlugin from "@fullcalendar/interaction";
import type { DateClickArg } from "@fullcalendar/interaction";
import type { DatesSetArg, EventClickArg, EventInput, EventDropArg } from "@fullcalendar/core";
import { getMealPlan, setMeals, deleteMeals, getMealFeedback, setMealFeedback, type MealEntryData, type MealIngredient, type MealFeedback } from "../api.ts";
import { replaceUrl, inferInitialView, localDateStr } from "../hooks/useUrlState.ts";

interface Props {
  onAuthError: (err: unknown) => void;
  initialFrom?: string;
  initialTo?: string;
}

interface ModalState {
  date: string;
  existing: MealEntryData | null;
}

interface FormIngredient {
  name: string;
  quantity: string;
  unit: string;
}

function toCalendarEvents(meals: MealEntryData[]): EventInput[] {
  return meals.map(m => ({
    id: m.date,
    title: m.name,
    start: m.date,
    allDay: true,
    extendedProps: { meal: m },
  }));
}

export function MealPlan({ onAuthError, initialFrom, initialTo }: Props) {
  const [meals, setMealsState] = useState<MealEntryData[]>([]);
  const [modal, setModal] = useState<ModalState | null>(null);
  const [error, setError] = useState<string | null>(null);

  // ── Load meals whenever the visible date range changes ─────────────────

  async function onDatesSet({ startStr, endStr, view }: DatesSetArg) {
    // Use currentStart/currentEnd (canonical month/week boundary) for the URL so refreshing
    // doesn't drift backwards via FullCalendar's overflow padding days.
    replaceUrl({
      tab: "meals",
      filter: "all",
      search: "",
      from: localDateStr(view.currentStart),
      to: localDateStr(view.currentEnd),
    });
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
    const draggedMeal = (event.extendedProps as { meal: MealEntryData }).meal;
    const occupant = meals.find(m => m.date === newDate && m.date !== oldDate);

    try {
      const updates: Parameters<typeof setMeals>[0] = [];

      updates.push({
        date: newDate,
        name: draggedMeal.name,
        ingredients: draggedMeal.ingredients,
        steps: draggedMeal.steps,
      });

      if (occupant) {
        // Swap: displace the occupant back to the old date
        updates.push({
          date: oldDate,
          name: occupant.name,
          ingredients: occupant.ingredients,
          steps: occupant.steps,
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
    const meal = (event.extendedProps as { meal: MealEntryData }).meal;
    setModal({ date: meal.date, existing: meal });
  }

  // ── Save from modal ───────────────────────────────────────────────────

  async function onModalSave(
    entry: { date: string; name: string; ingredients: MealIngredient[]; steps: string[] },
    feedback: { rating?: number; notes?: string; tags?: string[] } | null,
  ) {
    try {
      const [saved] = await setMeals([entry]);
      setMealsState(prev => {
        const next = prev.filter(m => m.date !== entry.date);
        return [...next, saved];
      });
      if (feedback && (feedback.rating !== undefined || feedback.notes || feedback.tags?.length)) {
        await setMealFeedback({ date: entry.date, ...feedback });
      }
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
        initialView={inferInitialView(initialFrom, initialTo)}
        initialDate={initialFrom}
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
          onAuthError={onAuthError}
        />
      )}
    </div>
  );
}

// ── Meal modal ────────────────────────────────────────────────────────────

interface MealModalProps {
  date: string;
  existing: MealEntryData | null;
  onSave: (entry: { date: string; name: string; ingredients: MealIngredient[]; steps: string[] }, feedback: { rating?: number; notes?: string; tags?: string[] } | null) => void;
  onDelete: (date: string) => void;
  onClose: () => void;
  onAuthError: (err: unknown) => void;
}

function MealModal({ date, existing, onSave, onDelete, onClose, onAuthError }: MealModalProps) {
  const [name, setName] = useState(existing?.name ?? "");
  const [ingredients, setIngredients] = useState<FormIngredient[]>(() => {
    if (!existing?.ingredients?.length) return [{ name: "", quantity: "", unit: "" }];
    return existing.ingredients.map(i => ({ name: i.name, quantity: i.quantity != null ? String(i.quantity) : "", unit: i.unit ?? "" }));
  });
  const [steps, setSteps] = useState(() => {
    if (!existing?.steps?.length) return "";
    return existing.steps.join("\n");
  });

  const [feedback, setFeedback] = useState<MealFeedback | null>(null);
  const [fbRating, setFbRating] = useState<number | undefined>(undefined);
  const [fbNotes, setFbNotes] = useState("");
  const [fbTags, setFbTags] = useState("");

  useEffect(() => {
    if (!existing) return;
    getMealFeedback(date)
      .then(fb => {
        if (fb) {
          setFeedback(fb);
          setFbRating(fb.rating);
          setFbNotes(fb.notes ?? "");
          setFbTags(fb.tags?.join(", ") ?? "");
        }
      })
      .catch(onAuthError);
  }, [date, existing]);

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
    const tags = fbTags.split(",").map(t => t.trim()).filter(Boolean);
    const feedbackPayload = (fbRating !== undefined || fbNotes.trim() || tags.length)
      ? { rating: fbRating, notes: fbNotes.trim() || undefined, tags: tags.length ? tags : undefined }
      : null;
    onSave({ date, name: name.trim(), ingredients: cleanedIngredients, steps: cleanedSteps }, feedbackPayload);
  }

  const STARS = [1, 2, 3, 4, 5];

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

        {existing && (
          <details class="feedback-section" open={!!feedback}>
            <summary>Feedback{feedback ? ` · ${"★".repeat(feedback.rating ?? 0)}` : ""}</summary>
            <div class="feedback-body">
              <label>Rating</label>
              <div class="star-rating">
                {STARS.map(s => (
                  <button
                    key={s}
                    class={`star${fbRating !== undefined && s <= fbRating ? " filled" : ""}`}
                    onClick={() => setFbRating(prev => prev === s ? undefined : s)}
                    type="button"
                    aria-label={`${s} star${s !== 1 ? "s" : ""}`}
                  >★</button>
                ))}
              </div>
              <label>Notes</label>
              <textarea
                value={fbNotes}
                onInput={e => setFbNotes((e.target as HTMLTextAreaElement).value)}
                placeholder="What worked well? What to change next time?"
                rows={3}
              />
              <label>Tags (comma-separated)</label>
              <input
                type="text"
                value={fbTags}
                onInput={e => setFbTags((e.target as HTMLInputElement).value)}
                placeholder="family_favorite, quick, would_repeat"
              />
            </div>
          </details>
        )}

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
