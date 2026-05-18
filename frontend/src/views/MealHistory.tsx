import { useState } from "preact/hooks";
import {
  searchMeals,
  suggestMeals,
  type MealSearchResult,
  type MealSuggestion,
} from "../api.ts";

function Stars({ rating }: { rating: number }) {
  return (
    <span class="stars-display">
      {[1, 2, 3, 4, 5].map((i) => (
        <span key={i} class={`star${i <= rating ? " filled" : ""}`}>★</span>
      ))}
    </span>
  );
}

function SearchResultCard({ result }: { result: MealSearchResult }) {
  const fb = result.feedback;
  return (
    <div class="meal-card">
      <div class="meal-card-header">
        <span class="meal-card-name">{result.name}</span>
        <span class="meal-card-date">{result.date}</span>
      </div>
      {fb && (
        <div class="meal-card-feedback">
          {fb.rating !== undefined && <Stars rating={fb.rating} />}
          {fb.tags && fb.tags.length > 0 && (
            <div class="meal-card-tags">
              {fb.tags.map((t) => <span key={t} class="tag-pill">{t}</span>)}
            </div>
          )}
          {fb.notes && <p class="meal-card-notes">{fb.notes}</p>}
        </div>
      )}
    </div>
  );
}

function SuggestionCard({ suggestion }: { suggestion: MealSuggestion }) {
  const { name, date, rating, tags, ingredients_in_stock: inStock, ingredients_missing: missing } = suggestion;
  return (
    <div class="meal-card">
      <div class="meal-card-header">
        <span class="meal-card-name">{name}</span>
        <span class="meal-card-date">{date}</span>
      </div>
      {rating !== undefined && <Stars rating={rating} />}
      {tags && tags.length > 0 && (
        <div class="meal-card-tags">
          {tags.map((t) => <span key={t} class="tag-pill">{t}</span>)}
        </div>
      )}
      {((inStock && inStock.length > 0) || (missing && missing.length > 0)) && (
        <div class="ingredient-split">
          {inStock && inStock.length > 0 && (
            <div>
              <span class="ingredient-split-label">In stock</span>
              <div class="ingredient-pills">
                {inStock.map((i) => <span key={i} class="ingredient-pill ingredient-pill--in-stock">{i}</span>)}
              </div>
            </div>
          )}
          {missing && missing.length > 0 && (
            <div>
              <span class="ingredient-split-label">Need to buy</span>
              <div class="ingredient-pills">
                {missing.map((i) => <span key={i} class="ingredient-pill ingredient-pill--missing">{i}</span>)}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

const RATINGS = [1, 2, 3, 4, 5] as const;

export function MealHistory({ onAuthError }: { onAuthError: (err: unknown) => void }) {
  const [mode, setMode] = useState<"search" | "suggest">("search");

  // ── Search state ─────────────────────────────────────────────────────────
  const [query, setQuery] = useState("");
  const [minRating, setMinRating] = useState("");
  const [maxRating, setMaxRating] = useState("");
  const [tag, setTag] = useState("");
  const [searchResults, setSearchResults] = useState<MealSearchResult[]>([]);
  const [searchRan, setSearchRan] = useState(false);
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);

  // ── Suggest state ─────────────────────────────────────────────────────────
  const [suggestMinRating, setSuggestMinRating] = useState("");
  const [suggestLimit, setSuggestLimit] = useState("5");
  const [suggestions, setSuggestions] = useState<MealSuggestion[]>([]);
  const [suggestRan, setSuggestRan] = useState(false);
  const [suggestLoading, setSuggestLoading] = useState(false);
  const [suggestError, setSuggestError] = useState<string | null>(null);

  const canSearch = !!query.trim() || !!minRating || !!maxRating || !!tag.trim();

  async function handleSearch(e: Event) {
    e.preventDefault();
    if (!canSearch) return;
    setSearchLoading(true);
    setSearchError(null);
    try {
      const results = await searchMeals({
        query: query.trim() || undefined,
        min_rating: minRating ? parseInt(minRating) : undefined,
        max_rating: maxRating ? parseInt(maxRating) : undefined,
        tag: tag.trim() || undefined,
      });
      setSearchResults(results);
      setSearchRan(true);
    } catch (err) {
      onAuthError(err);
      setSearchError(err instanceof Error ? err.message : "Search failed");
    } finally {
      setSearchLoading(false);
    }
  }

  async function handleSuggest() {
    setSuggestLoading(true);
    setSuggestError(null);
    try {
      const results = await suggestMeals({
        min_rating: suggestMinRating ? parseInt(suggestMinRating) : undefined,
        limit: parseInt(suggestLimit) || 5,
      });
      setSuggestions(results);
      setSuggestRan(true);
    } catch (err) {
      onAuthError(err);
      setSuggestError(err instanceof Error ? err.message : "Failed to get suggestions");
    } finally {
      setSuggestLoading(false);
    }
  }

  return (
    <div class="history-view">
      <div class="history-mode-bar">
        <button class={`filter-btn${mode === "search" ? " active" : ""}`} onClick={() => setMode("search")}>
          Search
        </button>
        <button class={`filter-btn${mode === "suggest" ? " active" : ""}`} onClick={() => setMode("suggest")}>
          Suggest
        </button>
      </div>

      {mode === "search" && (
        <div>
          <form onSubmit={handleSearch} class="history-search-form">
            <input
              type="text"
              class="history-query-input"
              placeholder="e.g. something light with chicken"
              value={query}
              onInput={(e) => setQuery((e.target as HTMLInputElement).value)}
            />
            <div class="history-filter-row">
              <label class="history-filter-item">
                <span>Min rating</span>
                <select value={minRating} onChange={(e) => setMinRating((e.target as HTMLSelectElement).value)}>
                  <option value="">Any</option>
                  {RATINGS.map((n) => <option key={n} value={n}>{"★".repeat(n)}</option>)}
                </select>
              </label>
              <label class="history-filter-item">
                <span>Max rating</span>
                <select value={maxRating} onChange={(e) => setMaxRating((e.target as HTMLSelectElement).value)}>
                  <option value="">Any</option>
                  {RATINGS.map((n) => <option key={n} value={n}>{"★".repeat(n)}</option>)}
                </select>
              </label>
              <label class="history-filter-item">
                <span>Tag</span>
                <input
                  type="text"
                  placeholder="e.g. quick"
                  value={tag}
                  onInput={(e) => setTag((e.target as HTMLInputElement).value)}
                />
              </label>
              <button type="submit" class="btn-primary history-action-btn" disabled={!canSearch || searchLoading}>
                {searchLoading ? "Searching…" : "Search"}
              </button>
            </div>
          </form>
          {searchError && <p class="inline-error">{searchError}</p>}
          {searchRan && (
            <div class="history-results">
              {searchResults.length === 0
                ? <p class="history-empty">No meals found.</p>
                : searchResults.map((r) => <SearchResultCard key={r.date} result={r} />)
              }
            </div>
          )}
        </div>
      )}

      {mode === "suggest" && (
        <div>
          <p class="history-suggest-desc">
            Suggests past meals based on what's currently in your pantry, ranked by ingredient overlap.
          </p>
          <div class="history-filter-row" style="margin-bottom: 1.25rem">
            <label class="history-filter-item">
              <span>Min rating</span>
              <select value={suggestMinRating} onChange={(e) => setSuggestMinRating((e.target as HTMLSelectElement).value)}>
                <option value="">Any</option>
                {RATINGS.map((n) => <option key={n} value={n}>{"★".repeat(n)}</option>)}
              </select>
            </label>
            <label class="history-filter-item">
              <span>Max results</span>
              <select value={suggestLimit} onChange={(e) => setSuggestLimit((e.target as HTMLSelectElement).value)}>
                {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((n) => <option key={n} value={n}>{n}</option>)}
              </select>
            </label>
            <button class="btn-primary history-action-btn" onClick={handleSuggest} disabled={suggestLoading}>
              {suggestLoading ? "Finding…" : "Find Suggestions"}
            </button>
          </div>
          {suggestError && <p class="inline-error">{suggestError}</p>}
          {suggestRan && (
            <div class="history-results">
              {suggestions.length === 0
                ? <p class="history-empty">No suggestions found. Make sure you have items marked in stock in your pantry.</p>
                : suggestions.map((s) => <SuggestionCard key={s.date} suggestion={s} />)
              }
            </div>
          )}
        </div>
      )}
    </div>
  );
}
