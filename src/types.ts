export type { User, Household, PantryItem, MealIngredient, MealEntryData } from "../types/shared.ts";

// Maps directly to the meal_entries D1 row — ingredients/steps are raw JSON strings.
export interface MealEntry {
  id: string;
  household_id: string;
  date: string;
  name: string;
  ingredients: string | null;
  steps: string | null;
  created_at: number;
}

// Worker environment bindings
export interface Env {
  DB: D1Database;
  DEV_TOKEN: string;
  DEV_USER_ID: string;
  ENABLE_OAUTH: string;
  ENABLE_DEV_AUTH: string;
  GITHUB_CLIENT_ID: string;
  GITHUB_CLIENT_SECRET: string;
  JWT_SECRET: string;
  ALLOWED_ORIGIN: string;
  ALLOW_ORIGIN_SUBDOMAINS: string;
}

export interface Preference {
  id: string;
  household_id: string;
  key: string;
  value: string;
  notes: string | null;
  updated_at: number;
}

export interface PreferenceHistory {
  id: string;
  household_id: string;
  preference_key: string;
  old_value: string | null;
  new_value: string | null;
  changed_at: number;
}

export interface MealFeedback {
  id: string;
  household_id: string;
  date: string;
  rating: number | null;
  notes: string | null;
  tags: string | null;          // JSON-encoded string[]
  meal_snapshot: string | null; // JSON snapshot of meal at feedback creation time
  created_at: number;
  updated_at: number;
}

// ── MCP protocol types ───────────────────────────────────────────────────

export interface McpRequest {
  jsonrpc: "2.0";
  id?: string | number;
  method: string;
  params?: unknown;
}

export type McpResponse = McpSuccessResponse | McpErrorResponse;

export interface McpSuccessResponse {
  jsonrpc: "2.0";
  id: string | number | null;
  result: unknown;
}

export interface McpErrorResponse {
  jsonrpc: "2.0";
  id: string | number | null;
  error: {
    code: number;
    message: string;
    data?: unknown;
  };
}

export interface ToolResult {
  content: Array<{ type: "text"; text: string }>;
  isError?: boolean;
}

export interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: {
    type: "object";
    properties: Record<string, unknown>;
    required?: string[];
  };
}
