// Worker environment bindings
export interface Env {
  DB: D1Database;
  DEV_TOKEN: string;
  DEV_USER_ID: string;
  ENABLE_OAUTH: string;
  GITHUB_CLIENT_ID: string;
  GITHUB_CLIENT_SECRET: string;
  JWT_SECRET: string;
  ALLOWED_ORIGIN: string;
}

// ── Database row types ────────────────────────────────────────────────────

export interface User {
  id: string;
  email: string | null;
  household_id: string;
  created_at: number;
}

export interface Household {
  id: string;
  name: string;
  created_at: number;
}

export interface PantryItem {
  id: string;
  household_id: string;
  name: string;
  category: string | null;
  quantity: number | null;
  unit: string | null;
  in_stock: 0 | 1;
  updated_at: number;
}

export interface MealIngredient {
  name: string;
  quantity?: number;
  unit?: string;
}

export interface MealEntry {
  id: string;
  household_id: string;
  date: string;          // ISO date
  name: string;
  ingredients: string | null;  // JSON-encoded MealIngredient[]
  steps: string | null;        // JSON-encoded string[]
  created_at: number;
}

export interface MealEntryData {
  date: string;
  name: string;
  ingredients?: MealIngredient[];
  steps?: string[];
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
