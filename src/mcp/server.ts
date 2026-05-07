import type { Env, McpRequest, McpResponse } from "../types.ts";
import { getOrCreateHousehold } from "../db/queries.ts";
import { FEEDBACK_TOOLS, handleFeedbackTool } from "./tools/feedback.ts";
import { MEAL_TOOLS, handleMealTool } from "./tools/meals.ts";
import { PANTRY_TOOLS, handlePantryTool } from "./tools/pantry.ts";
import { PREFERENCE_TOOLS, handlePreferenceTool } from "./tools/preferences.ts";

const ALL_TOOLS = [...PANTRY_TOOLS, ...MEAL_TOOLS, ...PREFERENCE_TOOLS, ...FEEDBACK_TOOLS];
const PROTOCOL_VERSION = "2024-11-05";

export async function handleMcp(request: Request, env: Env, userId: string): Promise<Response> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json(
      { jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } },
      { status: 400 },
    );
  }

  const req = body as McpRequest;

  // Notifications have no id — acknowledge without a body
  if (req.id === undefined) {
    return new Response(null, { status: 202 });
  }

  try {
    const result = await dispatch(req, env, userId);
    return Response.json(result);
  } catch {
    return Response.json({
      jsonrpc: "2.0",
      id: req.id ?? null,
      error: { code: -32603, message: "Internal error" },
    });
  }
}

async function dispatch(req: McpRequest, env: Env, userId: string): Promise<McpResponse> {
  const id = req.id ?? null;

  switch (req.method) {
    case "initialize": {
      const params = req.params as { protocolVersion?: string } | undefined;
      return {
        jsonrpc: "2.0",
        id,
        result: {
          protocolVersion: params?.protocolVersion ?? PROTOCOL_VERSION,
          capabilities: { tools: {} },
          serverInfo: { name: "grocery-store", version: "0.0.1" },
        },
      };
    }

    case "tools/list":
      return { jsonrpc: "2.0", id, result: { tools: ALL_TOOLS } };

    case "tools/call": {
      const params = req.params as { name?: unknown; arguments?: unknown } | undefined;
      if (typeof params?.name !== "string") {
        return { jsonrpc: "2.0", id, error: { code: -32602, message: "Invalid params: name is required" } };
      }

      const args =
        typeof params.arguments === "object" && params.arguments !== null
          ? (params.arguments as Record<string, unknown>)
          : {};

      const householdId = await getOrCreateHousehold(env.DB, userId);

      const isPantryTool = PANTRY_TOOLS.some((t) => t.name === params.name);
      const isMealTool = MEAL_TOOLS.some((t) => t.name === params.name);
      const isPreferenceTool = PREFERENCE_TOOLS.some((t) => t.name === params.name);
      const isFeedbackTool = FEEDBACK_TOOLS.some((t) => t.name === params.name);

      if (!isPantryTool && !isMealTool && !isPreferenceTool && !isFeedbackTool) {
        return { jsonrpc: "2.0", id, error: { code: -32601, message: `Unknown tool: ${params.name}` } };
      }

      let toolResult;
      if (isPantryTool) {
        toolResult = await handlePantryTool(params.name, args, env.DB, householdId);
      } else if (isMealTool) {
        toolResult = await handleMealTool(params.name, args, env.DB, householdId);
      } else if (isPreferenceTool) {
        toolResult = await handlePreferenceTool(params.name, args, env.DB, householdId);
      } else {
        toolResult = await handleFeedbackTool(params.name, args, env.DB, householdId);
      }

      return { jsonrpc: "2.0", id, result: toolResult };
    }

    default:
      return { jsonrpc: "2.0", id, error: { code: -32601, message: `Method not found: ${req.method}` } };
  }
}
