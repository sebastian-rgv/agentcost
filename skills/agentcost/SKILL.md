---
name: agentcost
description: |-
  Self-manage and query your own LLM spending with the agentcost CLI. Use when you
  are a coding agent that must report, budget, route or limit its LLM calls: after
  making an LLM call, before an expensive turn, when choosing a model, or whenever
  the user asks "cuánto gasté", "costo de la sesión", "agentcost", "budget",
  "session cost", "model cost", "route a model", "kill switch", "check session".
---

# agentcost — agentic cost management for AI agents

Use the `agentcost` CLI to record, query, route and limit your own LLM spending.
Everything is stored locally in JSON files under `~/.agentcost` (or
`$AGENTCOST_HOME`); the main database is `store.jsonl`, one line per LLM call.

## Contract (4 commands, all parseable)

Always use `--json` to read output, and honor exit codes:

| Step | Command |
| --- | --- |
| 1. Open a budgeted session | `agentcost session start --project <project> --limit $<amount>` → returns a `ses_...` id; **save it**. |
| 2. Record every LLM call | `agentcost track <log> --save --session <id> --project <project>` (or the SDK: `reportUsage(model, inputTokens, outputTokens, sessionId, ...)`). |
| 3. Query your cost before every expensive turn | `agentcost check --session <id> --json`. |
| 4. Pick models via the router | `agentcost route --task "<what you will do>" --quality <tier> --session <id> --json` → use the `model` field. |

## Workflow (obligatory)

1. **Start**: if the task is long or costly, open a session and keep the id.
2. **Each LLM call**: tag it with the session id (log line + `--session`, or SDK `sessionId`).
3. **Before an expensive turn** (>5 calls or large context):
   ```
   agentcost check --session <id> --json
   ```
   - `status.percent >= 80` → use lower-tier models (pass `--session` to `route` and it downgrades automatically).
   - `ok == false` (over limit or blocked) → **STOP making LLM calls**. Tell the user the budget ran out and suggest `agentcost session reset --id <id>` or a higher limit.
4. **Choose models with route, never by hand**:
   ```
   agentcost route --task "<task>" --quality <low|medium|high|critical> --session <id> --json
   ```
5. **Finish**: `agentcost session end --id <id>`.

## Self-service queries

| Need | Command |
| --- | --- |
| Spend of one session | `agentcost check --session <id> --json` |
| All sessions + spend | `agentcost session list --json` |
| Totals by model/project/agent | `agentcost report --period all --json` |
| Cheapest model meeting quality | `agentcost route --task "..." --quality X --session <id> --json` |
| Waste / optimization suggestions | `agentcost optimize --project X --json` |
| Block myself on over-budget | `agentcost check --session <id> --exit-if-over --kill` |
| Configure budget alerts | `agentcost alerts set --slack <url> --webhook <url>` |
| Web dashboard | `agentcost server --port 8080` → `/dashboard` |

## Constraints

- NEVER pick a model yourself: read `model` from `route` output.
- NEVER continue calling the LLM when `check` reports `ok: false`.
- If `route` downgrades the tier (`downgraded: true`), accept it — the session is near its limit.
- If `check` returns a blocked session, use `session reset --id` only after user approval.

## Data locations

- Sessions: `sessions.json`; budgets: `budget.json`; policies: `policy.json`;
  alerts: `alerts.json`; price overrides: `pricing.json`.
- Session spend is computed live from `store.jsonl` (sum of `cost` by `sessionId`), never cached.