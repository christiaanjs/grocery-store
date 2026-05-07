### Config to use with Claude Desktop locally

```json
{
  "grocery-store": {
    "command": "npx",
    "args": [
      "mcp-remote",
      "http://localhost:8787/mcp",
      "--header",
      "X-Dev-Token:${DEV_AUTH_TOKEN}"
    ],
    "env": {
      "DEV_AUTH_TOKEN": "..."
    }
  }
}
```

### Skill creator prompt

```
/skill-creator build a skill to use the grocery-store tool to assist with meal planning for a week or a provided day or time period. Ask about user preferences and constraints. Consider what groceries are in stock, ask ask about updating them if it seems necessary. Focus more on what is in stock than specific quantities unless prompted. If the user asks for a plan for several days or more (or suggests you do this) look at extending what is in stock with a grocery list for extra items. Consider generating a HTML widget to show the plan (and grocery list if one was created).
```
