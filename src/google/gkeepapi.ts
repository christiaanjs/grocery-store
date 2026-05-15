// Minimal port of gkeepapi for creating grocery list notes in Google Keep.
import type { GroceryItem } from "../../types/shared.ts";

const KEEP_API_URL = "https://www.googleapis.com/notes/v1/changes";

function tsString(nowMs: number): string {
  // Keep API uses microsecond precision: 2024-01-01T00:00:00.000000Z
  return new Date(nowMs).toISOString().replace(/(\.\d{3})Z$/, "$1000Z");
}

function generateNodeId(nowMs: number): string {
  const r1 = Math.floor(Math.random() * 0xffffffff)
    .toString(16)
    .padStart(8, "0");
  const r2 = Math.floor(Math.random() * 0xffffffff)
    .toString(16)
    .padStart(8, "0");
  return `${nowMs.toString(16)}.${r1}${r2}`;
}

function makeTimestamps(ts: string) {
  return { kind: "notes#timestamps", created: ts, updated: ts, userEdited: ts };
}

function makeNodeSettings() {
  return {
    newListItemPlacement: "BOTTOM",
    graveyardState: "COLLAPSED",
    checkedListItemsPolicy: "GRAVEYARD",
  };
}

function formatItem(item: GroceryItem): string {
  if (item.quantity !== undefined && item.unit) return `${item.name} (${item.quantity} ${item.unit})`;
  if (item.quantity !== undefined) return `${item.name} (${item.quantity})`;
  return item.name;
}

export async function createGroceryList(
  authToken: string,
  title: string,
  items: GroceryItem[],
): Promise<{ nodeId: string; url: string }> {
  const nowMs = Date.now();
  const ts = tsString(nowMs);
  const sessionId = `s--${nowMs}--${Math.floor(1000000000 + Math.random() * 9000000000)}`;
  const listId = generateNodeId(nowMs);

  const nodes: unknown[] = [
    {
      id: listId,
      kind: "notes#node",
      type: "LIST",
      parentId: "root",
      sortValue: 5000000000,
      text: "",
      timestamps: makeTimestamps(ts),
      nodeSettings: makeNodeSettings(),
      annotationsGroup: { kind: "notes#annotationsGroup" },
      color: "DEFAULT",
      isArchived: false,
      isPinned: false,
      title,
      collaborators: [],
    },
  ];

  let sortValue = 9000000000;
  for (const item of items) {
    nodes.push({
      id: generateNodeId(nowMs),
      kind: "notes#node",
      type: "LIST_ITEM",
      parentId: listId,
      sortValue,
      text: formatItem(item),
      timestamps: makeTimestamps(ts),
      nodeSettings: makeNodeSettings(),
      annotationsGroup: { kind: "notes#annotationsGroup" },
      parentServerId: null,
      superListItemId: null,
      checked: false,
    });
    sortValue -= 10000;
  }

  const payload = {
    nodes,
    clientTimestamp: ts,
    requestHeader: {
      clientSessionId: sessionId,
      clientPlatform: "ANDROID",
      clientVersion: { major: "9", minor: "9", build: "9", revision: "9" },
      capabilities: [
        { type: "NC" }, { type: "PI" }, { type: "LB" }, { type: "AN" },
        { type: "SH" }, { type: "DR" }, { type: "TR" }, { type: "IN" },
        { type: "SNB" }, { type: "MI" }, { type: "CO" },
      ],
    },
  };

  const res = await fetch(KEEP_API_URL, {
    method: "POST",
    headers: {
      Authorization: `OAuth ${authToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    throw new Error(`Keep API error: ${res.status} ${await res.text()}`);
  }

  const data = (await res.json()) as {
    nodes?: Array<{ id: string; serverId?: string; type?: string }>;
  };

  // The API returns one LIST node in the response. Prefer serverId (the
  // server-assigned ID); fall back to id in case the server overwrites the
  // client-generated id field instead of populating serverId separately.
  const listNode = data.nodes?.find(n => n.type === "LIST");
  if (!listNode) {
    console.error("[gkeepapi] No LIST node in response nodes:", JSON.stringify(data.nodes));
  } else if (!listNode.serverId) {
    console.warn("[gkeepapi] LIST node has no serverId, falling back to id field:", listNode.id);
  }
  const nodeId = listNode?.serverId ?? listNode?.id ?? listId;
  return { nodeId, url: `https://keep.google.com/u/0/#NOTE/${nodeId}` };
}
