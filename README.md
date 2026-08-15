# agentcost

A complete CLI + SDK for estimating, tracking, **routing** and **limiting** AI agent (LLM) costs.

Built with strict TypeScript, ESM, Node >= 18. Runtime dependencies: `commander`, `picocolors` and `js-tiktoken` (real token counting).

## Install

```bash
npm install -g agentcost
# or run without installing:
npx agentcost --help
```

## Commands

| Command | Description |
| --- | --- |
| `estimate` | Estimate the USD cost of a single LLM call |
| `track` | Parse a usage log (`.jsonl`/`.ndjson`/`.log`) and report costs per model |
| `models` | List all models and their prices per 1M tokens |
| `tokens` | Count tokens in a text using the model's tokenizer |
| `pricing` | Sync/reset local price overrides |
| `report` | Aggregate costs, export client invoices, emit OpenTelemetry metrics |
| `budget` | Manage monthly budgets per project |
| `watch` | Watch a directory for usage logs and print calls live |
| `live` | Live terminal dashboard of usage logs |
| `session` | Start/end/list ephemeral agent sessions with spending limits |
| `check` | Agent-readable session status (`$2.30 / $5.00 (46%, remaining $2.70)`) |
| `route` | Pick the cheapest model that meets a quality tier + budget |
| `policy` | Pin allowed models per task type and quality tier |
| `optimize` | Suggest model changes per project from real store data |
| `alerts` | Slack/Telegram/webhook alerts at 80% and 100% of budget |
| `server` | HTTP server + web dashboard (opencost/kubecost style) |

All paths that use `~/.agentcost` respect the `AGENTCOST_HOME` environment variable.

### `agentcost estimate`

Estimate the USD cost of a single LLM call, either with explicit token counts or by counting tokens from text.

```
Usage: agentcost estimate [options]

Options:
  --model <model>       model name (e.g. gpt-4o)
  --input <tokens>      number of input tokens
  --output <tokens>     number of output tokens
  --input-text <text>   input text to count tokens from (instead of --input)
  --output-text <text>  output text to count tokens from (instead of --output)
  --json                output machine-readable JSON
  -h, --help            display help
```

Example:

```bash
$ agentcost estimate --model gpt-4o --input 1000 --output 500
Model     gpt-4o
Provider  OpenAI
Input     $0.0025
          1,000 tokens
Output    $0.005
          500 tokens
Total     $0.0075
```

With text (tokens are counted automatically with `js-tiktoken`):

```bash
$ agentcost estimate --model gpt-4o --input-text "Hello world" --output-text "world"
```

If the model does not exist in the pricing database you get a clear error with closest matches:

```bash
$ agentcost estimate --model gpt-4 --input 1000 --output 500
Model 'gpt-4' not found in the pricing database.
Did you mean: gpt-4o, gpt-4.1, gpt-4.1-mini?
Use 'agentcost models' to list all available models.
```

### `agentcost tokens`

Count tokens with real tokenizers via `js-tiktoken`. Encoding mapping: `o1`/`gpt-4o`/`gpt-4o-mini`/`gpt-4.1` → `o200k_base`, `claude` models → `cl100k_base` (approximation), anything else → `o200k_base` with a warning on stderr.

```
Usage: agentcost tokens [options] <text>

Options:
  --model <model>  model name (e.g. gpt-4o) (default: "gpt-4o")
  --json           output machine-readable JSON
```

```bash
$ agentcost tokens "Hello world" --model gpt-4o
2 tokens (o200k_base)

$ agentcost tokens "Hello" --model claude-3-5-sonnet --json
{"tokens":1,"model":"claude-3-5-sonnet","encoding":"cl100k_base"}
```

### `agentcost track <file>`

Parse a usage log and report costs per model. Detects formats per line:

- OpenAI: `usage.prompt_tokens` / `usage.completion_tokens`
- Anthropic: `usage.input_tokens` / `usage.output_tokens`
- Usage events (`{"type":"usage"}`) with top-level `prompt_tokens`/`completion_tokens`, `input_tokens`/`output_tokens`, or camelCase variants
- `total_tokens` is accepted as extra metadata

```
Usage: agentcost track [options] <file>

Options:
  --format <format>  log format: auto, openai or anthropic (default: "auto")
  --save             save parsed calls to the local store
  --project <name>   tag saved entries with a project name
  --agent <name>     tag saved entries with an agent name
  --session <id>     tag saved entries with a session id
  --json             output machine-readable JSON
```

Example input (`usage.jsonl`), mixing formats:

```json
{"model":"gpt-4o","usage":{"prompt_tokens":1000,"completion_tokens":500,"total_tokens":1500}}
{"type":"usage","model":"claude-3-5-sonnet","input_tokens":2000,"output_tokens":800}
```

Example output:

```bash
$ agentcost track usage.jsonl
Model             Calls  Input  Output  Cost
----------------  -----  -----  ------  ----------
gpt-4o                1  1,000     500   $0.0075
claude-3-5-sonnet     1  2,000     800   $0.0180
Total                 2  3,000   1,300   $0.0255
```

Unparseable lines are counted in `skipped` and reported as a warning on stderr. Use `--format openai` or `--format anthropic` to only parse a single format, and `--save` to persist calls to `~/.agentcost/store.jsonl`.

### `agentcost models`

List all models and their prices per 1M tokens.

```
Usage: agentcost models [options]

Options:
  --provider <name>     filter by provider (e.g. OpenAI)
  --pricing-file <path> load a local pricing JSON file
  --json                output machine-readable JSON
```

### `agentcost pricing`

Manage local price overrides. `estimate`, `track` and `models` show a `*` next to any price that comes from an override.

```
Usage: agentcost pricing sync [options]    Download a pricing JSON and save local overrides
Usage: agentcost pricing reset             Remove local price overrides
```

```bash
$ agentcost pricing sync
Saved 24 price override(s) to ~/.agentcost/pricing.json
Models: gpt-4o, gpt-4.1, ...
```

The registry JSON has the shape:

```json
{
  "gpt-4o": {
    "provider": "OpenAI",
    "inputPerMillion": 2.5,
    "outputPerMillion": 10,
    "updatedAt": "2026-08-14T00:00:00.000Z"
  }
}
```

`pricing sync --url` accepts a public HTTP(S) URL (defaults to a public example gist — see "Pricing registry" below) or a local file path. If the network/file fails you get a clear error and nothing is modified. `pricing reset` deletes the local overrides.

### `agentcost report`

Aggregate costs from the local store.

```
Usage: agentcost report [options]

Options:
  --period <period>  period: today, week, month or all (default: "week")
  --project <name>   filter by project
  --agent <name>     filter by agent
  --top <n>          show the top N most expensive models
  --json             output machine-readable JSON
```

Reports totals, per-model, per-project and per-agent breakdowns, a day-by-day trend for the last 7 days, and prints budget warnings automatically.

### `agentcost budget`

Manage monthly budgets per project.

```
Usage: agentcost budget set --project <name> --monthly <amount>
Usage: agentcost budget list
Usage: agentcost budget check
```

```bash
$ agentcost budget set --project alpha --monthly 50
Budget set for 'alpha': $50/month.

$ agentcost budget list
Project  Monthly  Spent     Percent
-------  -------  -------  ----------
alpha    $50      $12.50    25.0%

$ agentcost budget check
```

Budgets warn at 80% of the monthly budget and `budget check` exits with code `1` when any project is over 100%.

### `agentcost watch`

Watch a directory for new/modified usage logs (`.jsonl`, `.ndjson`, `.log`) and print each call live. Colors: green under `$0.01`, yellow under `$0.10`, red at `$0.10` or more.

```
Usage: agentcost watch [options]

Options:
  --dir <dir>        directory to watch (default: current directory)
  --interval <int>   poll interval, e.g. 5s or 2000ms (default: "5s")
  --save             save captured calls to the local store
```

Files already seen are skipped using a hash+offset state stored in `~/.agentcost/watch-state.json`. Ctrl+C stops cleanly with `watch stopped, N calls captured`.

### `agentcost live`

Same as `watch`, but with a live terminal dashboard refreshed every 2 seconds (total, calls, per model, calls/minute, top agent/project). Ctrl+C prints the final summary as a report. When the terminal is not a TTY it falls back to `watch`.

## Agentic sessions and limits

### `agentcost session`

Ephemeral sessions with a hard spending limit. Usage tagged with a session id is
counted automatically from the store.

```
Usage: agentcost session start --project <name> --limit <amount>
Usage: agentcost session end [--id <id>]
Usage: agentcost session list [--active] [--json]
Usage: agentcost session reset --id <id>
```

```bash
$ agentcost session start --project alpha --limit $5
Session started: ses_OsqvWtpqi_PmIsn- (project 'alpha', limit $5).
```

`session end` closes the most recently started active session when `--id` is omitted.

### `agentcost check`

Human- and agent-readable session status. Designed to be parsed by agents.

```
Usage: agentcost check [options]

Options:
  --session <id>     session id to check
  --json             output machine-readable JSON
  --exit-if-over     exit 1 when the session is over its limit
  --kill             open the kill switch (block the session) when over
```

```bash
$ agentcost check --session ses_x
session ses_x (alpha)
spent $2.30 / $5  (46.0%, remaining $2.70)
state: active

$ agentcost check --session ses_x --json
{"session":{"id":"ses_x",...,"spent":2.3,"percent":46,...},"ok":true,"reason":"within limit"}
```

`--exit-if-over` is the exit-code blocker: CI or an agent can call
`check --session X --exit-if-over` before each turn and stop when it returns `1`.
`--kill` is the real circuit breaker: it marks the session **blocked** on disk, and
`track --save --session` and the SDK refuse any further usage for that session
until `session reset --id` unblocks it.

## Model routing

### `agentcost route`

Returns the cheapest model that meets a quality tier and (optionally) a budget.
Quality tiers: `low` < `medium` < `high` < `critical`.

```
Usage: agentcost route [options]

Options:
  --task <description>  task description (e.g. 'refactor the auth module')
  --quality <tier>      quality tier: low, medium, high or critical
  --max-cost <amount>   max blended price per 1M tokens in USD
  --session <id>        respect this session's budget (auto-downgrade at 80%)
  --json                output machine-readable JSON
```

```bash
$ agentcost route --task "refactor the auth module" --quality high --json
{"task":"refactor the auth module","taskType":"coding","requestedQuality":"high",
 "model":"deepseek-reasoner","provider":"DeepSeek","tier":"high",...}
```

Task descriptions are classified automatically (`coding`, `writing`, `planning`,
`review`, `classification`, `research`, `general`). Quality metadata per model
(tier, speed, context, modalities, benchmark score) lives in `src/quality.ts`.

**Budget awareness:** when `--session` is passed and the session is at >= 80% of
its limit, the router downgrades the tier automatically, so the agent keeps
working with cheaper models instead of being blocked.

### `agentcost policy`

Pin allowed/denied models per task type and quality tier. The router never returns
a model outside these rules.

```
Usage: agentcost policy set --task <type> --quality <tier> --allow "m1,m2" [--deny "m3"]
Usage: agentcost policy list [--json]
Usage: agentcost policy remove --task <type> --quality <tier>
```

```bash
$ agentcost policy set --task coding --quality high --allow "gpt-4o,claude-3-7-sonnet"
Policy set: 'coding' + quality 'high' allows [gpt-4o, claude-3-7-sonnet].
```

## Optimizer (learning from real data)

### `agentcost optimize`

Analyzes the local store and suggests cheaper model swaps per project using real
spend, plus detects expensive loops.

```
Usage: agentcost optimize --project <name> [--json]
```

Detected loop patterns (all based on store data, not guesses):

- **Retry storms** — consecutive `kind: "retry"`/`"error"` calls to the same model.
- **Tool-call storms** — many calls to the same model inside a rolling 60s window.
- **Context pressure** — calls using >= 80% of the model's context window.

Suggestions include the observed average cost/call and the estimated saving, so
you can act on numbers. Record failures from your apps by tagging entries with
`kind: "retry"`/`"error"` (via `track --save` on log lines with a `kind` field, or
the SDK).

## Alerts and kill switch

### `agentcost alerts`

Alert channels fire once per threshold at 80% and 100% of a session limit or a
project's monthly budget (`check` and `budget check` both trigger them).

```
Usage: agentcost alerts set [--slack <url>] [--telegram-token <t> --telegram-chat <c>] [--webhook <url>] [--disable]
Usage: agentcost alerts list
Usage: agentcost alerts clear
Usage: agentcost alerts test [--level warning|over]
```

```bash
$ agentcost alerts set --slack https://hooks.slack.com/services/T000/B000/XXX --webhook https://myapp/webhook
Alerts enabled: Slack, webhook
```

## Ecosystem and integrations

### Web dashboard and server (opencost/kubecost style)

```
Usage: agentcost server [--host 0.0.0.0] [--port 8080] [--peers url1,url2]
```

- Dashboard: `http://localhost:8080/dashboard`
- JSON APIs: `/api/store`, `/api/sessions`, `/api/report`, `/api/policies`, `/api/alerts`, `/api/peers`, `/api/store/push`, `/health`
- Multi-machine: run one server per machine and aggregate their reports with `--peers`.

### OpenTelemetry

`agentcost report --otel-endpoint http://collector:4318` emits cost, token and
call metrics (OTLP/HTTP JSON) with tags (`project`, `model`, `provider`,
`session`): `agentcost.cost.total`, `agentcost.calls`, `agentcost.tokens.input`,
`agentcost.tokens.output`, plus per-model variants.

### Client billing export

```
Usage: agentcost report --export-client "<client>" [--json]
```

Outputs a CSV invoice (totals, by project, by agent, line items) ready for
freelance billing. Add `--json` for a parseable structure.

### JS SDK

`agentcost` also ships as a library at `@agentcost/sdk`:

```ts
import { sdk } from "agentcost/sdk";

const session = sdk.createSession("alpha", 5);
sdk.reportUsage({ model: "gpt-4o", inputTokens: 1000, outputTokens: 500, sessionId: session.id });
const { ok, status } = sdk.checkSession(session.id);
if (!ok) process.exit(1);

const model = sdk.route("refactor the auth module", "high", { sessionId: session.id }).model;
```

`reportUsage` rejects unknown sessions and sessions blocked by the kill switch.

### Python SDK

`./sdk/python` provides the same `report_usage`, `create_session`, `end_session`
and `check_session` helpers against the shared store:

```bash
pip install -e ./sdk/python
```

```python
from agentcost import report_usage, create_session, check_session
session = create_session("alpha", 5.0)
report_usage(model="gpt-4o", input_tokens=1000, output_tokens=500, session_id=session["id"])
if not check_session(session["id"])["ok"]:
    raise SystemExit("session over budget")
```

### Agentic playbook

`docs/playbook.md` contains ready-to-paste system prompts that make any agent
use `check`/`route` and self-limit (session start → route → check per turn →
kill switch).

## Pricing registry

The default registry URL for `pricing sync` is a public example gist:

```
https://gist.githubusercontent.com/agentcost/pricing/raw/pricing.json
```

You can point to any JSON URL or a local file with `--url`. If the network fails, `pricing sync` reports a clear error and leaves your local overrides untouched.

## Pricing database

Included providers and models (input/output per 1M tokens, USD):

| Provider  | Model                          | Input  | Output |
| --------- | ------------------------------ | ------ | ------ |
| OpenAI    | gpt-4o                         | 2.50   | 10.00  |
| OpenAI    | gpt-4o-mini                    | 0.15   | 0.60   |
| OpenAI    | o1                             | 15.00  | 60.00  |
| OpenAI    | o1-mini                        | 1.10   | 4.40   |
| OpenAI    | gpt-4.1                        | 2.00   | 8.00   |
| OpenAI    | gpt-4.1-mini                   | 0.40   | 1.60   |
| OpenAI    | gpt-4.1-nano                   | 0.10   | 0.40   |
| Anthropic | claude-3-7-sonnet              | 3.00   | 15.00  |
| Anthropic | claude-3-5-sonnet              | 3.00   | 15.00  |
| Anthropic | claude-3-5-haiku               | 0.80   | 4.00   |
| Anthropic | claude-3-opus                  | 15.00  | 75.00  |
| DeepSeek  | deepseek-chat                  | 0.27   | 1.10   |
| DeepSeek  | deepseek-reasoner              | 0.55   | 2.19   |
| Google    | gemini-2.0-flash               | 0.10   | 0.40   |
| Google    | gemini-2.5-pro                 | 1.25   | 10.00  |
| Google    | gemini-1.5-pro                 | 1.25   | 5.00   |
| xAI       | grok-2                         | 2.00   | 10.00  |
| xAI       | grok-beta                      | 5.00   | 15.00  |
| Mistral   | mistral-large                  | 2.00   | 6.00   |
| Mistral   | mistral-small                  | 0.20   | 0.60   |
| Meta      | llama-3.3-70b (via provider)   | 0.59   | 0.79   |
| Meta      | llama-3.1-8b                   | 0.05   | 0.08   |

## Model quality tiers

Quality metadata used by `route` and `optimize` lives in `src/quality.ts`:

| Tier | Example models | Use for |
| --- | --- | --- |
| `low` | gpt-4.1-nano, llama-3.1-8b | classification, extraction, drafts |
| `medium` | gpt-4o-mini, claude-3-5-haiku, deepseek-chat | summarization, first-pass writing |
| `high` | gpt-4o, claude-3-7-sonnet, deepseek-reasoner | coding, planning, reasoning |
| `critical` | o1, claude-3-opus | production-grade reasoning, hard analysis |

Each model also records `speed`, `context` (window in tokens), `modalities`
and a `benchmark` score, so the router can pick the cheapest model that still
meets the requested tier.

## How to contribute prices

Model IDs with date/provider suffixes are matched automatically (e.g. `gpt-4o-2024-08-06` resolves to `gpt-4o`, `azure:gpt-4o` resolves to `gpt-4o`).

Prices live in `src/pricing.ts` in the shape:

```ts
{
  "model-name": {
    provider: "ProviderName",
    inputPerMillion: 2.5,
    outputPerMillion: 10,
  },
}
```

To add or update a model:

1. Edit `src/pricing.ts` and add/update the entry with the current USD price per 1M tokens.
2. Add a test in `test/pricing.test.ts` asserting the new price.
3. Run `npm test`, `npm run typecheck`, and `npm run build`.
4. Open a pull request.

## Local store and data

All state lives under `~/.agentcost` (override with `AGENTCOST_HOME`):

| File | Purpose |
| --- | --- |
| `store.jsonl` | Append-only usage entries written by `track --save`, `watch --save`, `live --save` and the SDKs |
| `budget.json` | Project budgets set with `budget set` |
| `sessions.json` | Ephemeral sessions created with `session start` |
| `policy.json` | Model routing policies set with `policy set` |
| `alerts.json` | Alert channels configured with `alerts set` |
| `alerts-state.json` | Fired-threshold bookkeeping (so alerts fire once per crossing) |
| `pricing.json` | Local price overrides written by `pricing sync` |
| `watch-state.json` | Hash+offset bookkeeping for `watch`/`live` |

## Development

```bash
npm install
npm test        # run vitest
npm run typecheck
npm run build   # bundle with tsup (CJS + ESM, bin agentcost)
npm link        # optional: use the 'agentcost' bin locally
```

## License

MIT