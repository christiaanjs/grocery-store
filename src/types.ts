export type { User, Household, PantryItem, MealIngredient, MealEntry, MealEntryData } from "../types/shared.ts";

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
