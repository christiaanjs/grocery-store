import type { ToolDefinition, ToolResult } from "../../types.ts";
import {
  deletePreference,
  getPreferenceHistory,
  listPreferences,
  setPreference,
} from "../../db/queries.ts";

export const PREFERENCE_TOOLS: ToolDefinition[] = [
  {
    name: "preferences_list",
    description:
      "List household preferences and requirements (dietary restrictions, allergies, dislikes, cooking style, etc.). Optionally filter by key and include full change history.",
    inputSchema: {
      type: "object",
      properties: {
        key: {
          type: "string",
          description: "Filter to a specific preference key. If omitted, all preferences are returned.",
        },
        include_history: {
          type: "boolean",
          description: "If true, include the full change history alongside the current preferences.",
        },
      },
    },
  },
  {
    name: "preferences_set",
    description:
      "Set or update a household preference or requirement. Every change is recorded in history so it can be reviewed later.",
    inputSchema: {
      type: "object",
      properties: {
        key: {
          type: "string",
          description:
            "Preference identifier, e.g. 'dietary', 'allergy', 'disliked_ingredients', 'cooking_style'.",
        },
        value: {
          type: "string",
          description: "Preference value, e.g. 'vegetarian', 'nut-free', 'no coriander', 'quick weeknight meals'.",
        },
        notes: {
          type: "string",
          description: "Optional context or clarification for this preference.",
        },
      },
      required: ["key", "value"],
    },
  },
  {
    name: "preferences_delete",
    description: "Remove a household preference. The deletion is recorded in history.",
    inputSchema: {
      type: "object",
      properties: {
        key: {
          type: "string",
          description: "The preference key to remove.",
        },
      },
      required: ["key"],
    },
  },
];

export async function handlePreferenceTool(
  name: string,
  args: Record<string, unknown>,
  db: D1Database,
  householdId: string,
): Promise<ToolResult> {
  switch (name) {
    case "preferences_list": {
      const key = typeof args["key"] === "string" ? args["key"] : undefined;
      const includeHistory = args["include_history"] === true;

      const prefs = await listPreferences(db, householdId, key);

      if (includeHistory) {
        const history = await getPreferenceHistory(db, householdId, key);
        return {
          content: [{ type: "text", text: JSON.stringify({ preferences: prefs, history }, null, 2) }],
        };
      }

      if (prefs.length === 0) {
        return {
          content: [{
            type: "text",
            text: key ? `No preference found for key: ${key}` : "No preferences set",
          }],
        };
      }

      return { content: [{ type: "text", text: JSON.stringify(prefs, null, 2) }] };
    }

    case "preferences_set": {
      if (typeof args["key"] !== "string" || args["key"].trim() === "") {
        return { content: [{ type: "text", text: "key is required and must be a non-empty string" }], isError: true };
      }
      if (typeof args["value"] !== "string" || args["value"].trim() === "") {
        return { content: [{ type: "text", text: "value is required and must be a non-empty string" }], isError: true };
      }
      const notes = typeof args["notes"] === "string" ? args["notes"] : undefined;
      const pref = await setPreference(db, householdId, args["key"], args["value"], notes);
      return { content: [{ type: "text", text: JSON.stringify(pref, null, 2) }] };
    }

    case "preferences_delete": {
      if (typeof args["key"] !== "string") {
        return { content: [{ type: "text", text: "key is required" }], isError: true };
      }
      const deleted = await deletePreference(db, householdId, args["key"]);
      return {
        content: [{
          type: "text",
          text: deleted
            ? `Deleted preference: ${args["key"]}`
            : `No preference found for key: ${args["key"]}`,
        }],
      };
    }

    default:
      return { content: [{ type: "text", text: `Unknown tool: ${name}` }], isError: true };
  }
}
