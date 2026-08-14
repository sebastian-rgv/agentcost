# agentcost

A complete CLI for estimating and tracking AI agent (LLM) costs.

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
| `report` | Aggregate costs from the local store |
| `budget` | Manage monthly budgets per project |
| `watch` | Watch a directory for usage logs and print calls live |
| `live` | Live terminal dashboard of usage logs |

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
| `store.jsonl` | Append-only usage entries written by `track --save`, `watch --save` and `live --save` |
| `budget.json` | Project budgets set with `budget set` |
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