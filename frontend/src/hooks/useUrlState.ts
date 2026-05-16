export type Filter = "all" | "in_stock" | "out_of_stock";
export type Tab = "pantry" | "meals" | "grocery" | "integrations";

export interface UrlState {
  tab: Tab;
  filter: Filter;
  search: string;
  from: string | undefined;
  to: string | undefined;
}

export function parseUrl(): UrlState {
  const path = window.location.pathname;
  const params = new URLSearchParams(window.location.search);
  return {
    tab:
      path === "/pantry"
        ? "pantry"
        : path === "/grocery"
        ? "grocery"
        : path === "/integrations"
        ? "integrations"
        : "meals",
    filter: (params.get("filter") ?? "all") as Filter,
    search: params.get("search") ?? "",
    from: params.get("from") ?? undefined,
    to: params.get("to") ?? undefined,
  };
}

function buildUrl(state: UrlState): string {
  const path =
    state.tab === "meals"
      ? "/meal-plan"
      : state.tab === "grocery"
      ? "/grocery"
      : state.tab === "integrations"
      ? "/integrations"
      : "/pantry";
  const params = new URLSearchParams();
  if (state.filter !== "all") params.set("filter", state.filter);
  if (state.search) params.set("search", state.search);
  if (state.tab === "meals") {
    if (state.from) params.set("from", state.from);
    if (state.to) params.set("to", state.to);
  }
  const qs = params.toString();
  return qs ? `${path}?${qs}` : path;
}

export function pushUrl(state: UrlState): void {
  history.pushState(state, "", buildUrl(state));
}

export function replaceUrl(state: UrlState): void {
  history.replaceState(state, "", buildUrl(state));
}

export function localDateStr(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function inferInitialView(from: string | undefined, to: string | undefined): string {
  if (!from) return "dayGridMonth";
  if (!to) return "dayGridWeek";
  const days = (Date.parse(to) - Date.parse(from)) / 86_400_000;
  return days <= 8 ? "dayGridWeek" : "dayGridMonth";
}
