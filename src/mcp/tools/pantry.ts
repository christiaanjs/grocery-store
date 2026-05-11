import type { ToolDefinition, ToolResult } from "../../types.ts";
import { deletePantryItem, listPantryItems, markPantryItemsOut, upsertPantryItem } from "../../db/queries.ts";

export const PANTRY_TOOLS: ToolDefinition[] = [
  {
    name: "pantry_list",
    description: "List all pantry items, optionally filtered by category or in_stock status",
    inputSchema: {
      type: "object",
      properties: {
        category: { type: "string", description: "Filter by category (e.g. produce, dairy, pantry)" },
        in_stock: {
          type: "boolean",
          description: "If true, return only in-stock items; if false, only out-of-stock",
        },
      },
    },
  },
  {
    name: "pantry_update",
    description: "Update a pantry item's details or stock status (creates it if it doesn't exist)",
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string", description: "Item name" },
        category: { type: "string", description: "Category (produce, dairy, pantry, etc.)" },
        quantity: { type: "number", description: "Quantity on hand" },
        unit: { type: "string", description: "Unit of measure (g, ml, count, etc.)" },
        in_stock: { type: "boolean", description: "Whether the item is in stock" },
      },
      required: ["name"],
    },
  },
  {
    name: "pantry_mark_out",
    description: "Mark one or more items as out of stock",
    inputSchema: {
      type: "object",
      properties: {
        names: {
          type: "array",
          items: { type: "string" },
          description: "Names of items to mark as out of stock",
        },
      },
      required: ["names"],
    },
  },
  {
    name: "pantry_delete",
    description: "Permanently delete a pantry item by name",
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string", description: "Name of the item to delete" },
      },
      required: ["name"],
    },
  },
  {
    name: "pantry_bulk_update",
    description: "Update multiple pantry items at once (e.g. after a grocery shop)",
    inputSchema: {
      type: "object",
      properties: {
        items: {
          type: "array",
          items: {
            type: "object",
            properties: {
              name: { type: "string" },
              category: { type: "string" },
              quantity: { type: "number" },
              unit: { type: "string" },
              in_stock: { type: "boolean" },
            },
            required: ["name"],
          },
        },
      },
      required: ["items"],
    },
  },
];

export async function handlePantryTool(
  name: string,
  args: Record<string, unknown>,
  db: D1Database,
  householdId: string,
): Promise<ToolResult> {
  switch (name) {
    case "pantry_list": {
      const category = typeof args["category"] === "string" ? args["category"] : undefined;
      const inStock = typeof args["in_stock"] === "boolean" ? args["in_stock"] : undefined;
      const items = await listPantryItems(db, householdId, { category, inStock });
      return { content: [{ type: "text", text: JSON.stringify(items, null, 2) }] };
    }

    case "pantry_update": {
      if (typeof args["name"] !== "string") {
        return { content: [{ type: "text", text: "name is required" }], isError: true };
      }
      const item = await upsertPantryItem(db, householdId, {
        name: args["name"],
        category: typeof args["category"] === "string" ? args["category"] : undefined,
        quantity: typeof args["quantity"] === "number" ? args["quantity"] : undefined,
        unit: typeof args["unit"] === "string" ? args["unit"] : undefined,
        inStock: typeof args["in_stock"] === "boolean" ? args["in_stock"] : undefined,
      });
      return { content: [{ type: "text", text: JSON.stringify(item, null, 2) }] };
    }

    case "pantry_mark_out": {
      if (!Array.isArray(args["names"])) {
        return { content: [{ type: "text", text: "names must be an array" }], isError: true };
      }
      const names = (args["names"] as unknown[]).filter((n): n is string => typeof n === "string");
      const count = await markPantryItemsOut(db, householdId, names);
      return { content: [{ type: "text", text: JSON.stringify({ marked_out: count }) }] };
    }

    case "pantry_delete": {
      if (typeof args["name"] !== "string") {
        return { content: [{ type: "text", text: "name is required" }], isError: true };
      }
      const deleted = await deletePantryItem(db, householdId, args["name"]);
      return { content: [{ type: "text", text: JSON.stringify({ deleted }) }] };
    }

    case "pantry_bulk_update": {
      if (!Array.isArray(args["items"])) {
        return { content: [{ type: "text", text: "items must be an array" }], isError: true };
      }
      const updates = (args["items"] as unknown[]).filter(
        (i): i is Record<string, unknown> => typeof i === "object" && i !== null,
      );
      const results = await Promise.all(
        updates
          .filter((i) => typeof i["name"] === "string")
          .map((i) =>
            upsertPantryItem(db, householdId, {
              name: i["name"] as string,
              category: typeof i["category"] === "string" ? i["category"] : undefined,
              quantity: typeof i["quantity"] === "number" ? i["quantity"] : undefined,
              unit: typeof i["unit"] === "string" ? i["unit"] : undefined,
              inStock: typeof i["in_stock"] === "boolean" ? i["in_stock"] : undefined,
            }),
          ),
      );
      return { content: [{ type: "text", text: JSON.stringify(results, null, 2) }] };
    }

    default:
      return { content: [{ type: "text", text: `Unknown tool: ${name}` }], isError: true };
  }
}
