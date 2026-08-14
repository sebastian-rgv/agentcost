# agentcost

A complete CLI for estimating and tracking AI agent (LLM) costs.

Built with strict TypeScript, ESM, Node >= 18. No runtime dependencies beyond `commander` and `picocolors`.

## Install

```bash
npm install -g agentcost
# or run without installing:
npx agentcost --help
```

## Commands

### `agentcost estimate`

Estimate the USD cost of a single LLM call.

```
Usage: agentcost estimate [options]

Options:
  --model <model>    model name (e.g. gpt-4o)
  --input <tokens>   number of input tokens
  --output <tokens>  number of output tokens
  --json             output machine-readable JSON
  -h, --help         display help
```

Example:

```bash
$ agentcost estimate --model gpt-4o --input 1000 --output 500
Model     gpt-4o
Provider  OpenAI
Input     $0.0025
          1,000 tokens
Output    $0.0050
          500 tokens
Total     $0.0075
```

If the model does not exist in the pricing database you get a clear error with closest matches:

```bash
$ agentcost estimate --model gpt-4 --input 1000 --output 500
Model 'gpt-4' not found in the pricing database.
Did you mean: gpt-4o, gpt-4.1, gpt-4.1-mini?
Use 'agentcost models' to list all available models.
```

Machine-readable output with `--json`:

```bash
$ agentcost estimate --model gpt-4o --input 1000 --output 500 --json
{"model":"gpt-4o","provider":"OpenAI","inputTokens":1000,"outputTokens":500,"inputCost":0.0025,"outputCost":0.005,"totalCost":0.0075}
```

### `agentcost track <file>`

Parse a JSONL usage log and report costs per model. Both OpenAI (`usage.prompt_tokens`, `usage.completion_tokens`) and Anthropic (`usage.input_tokens`, `usage.output_tokens`) formats are auto-detected per line, and can be mixed in the same file.

```
Usage: agentcost track [options] <file>

Options:
  --json  output machine-readable JSON
  -h, --help  display help
```

Example input (`usage.jsonl`):

```json
{"model":"gpt-4o","usage":{"prompt_tokens":1000,"completion_tokens":500,"total_tokens":1500}}
{"model":"claude-3-5-sonnet","usage":{"input_tokens":2000,"output_tokens":800}}
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

Models without a known price are shown with `n/a` cost and reported as a warning on stderr. Unparseable lines are skipped and counted.

### `agentcost models`

List all models and their prices per 1M tokens.

```
Usage: agentcost models [options]

Options:
  --provider <name>  filter by provider (e.g. OpenAI)
  --json             output machine-readable JSON
  -h, --help         display help
```

Example:

```bash
$ agentcost models --provider Anthropic
Model                   Provider   Input $/1M  Output $/1M
----------------------  ---------  ----------  -----------
claude-3-5-haiku        Anthropic  0.8         4
claude-3-5-sonnet       Anthropic  3           15
claude-3-7-sonnet       Anthropic  3           15
claude-3-opus           Anthropic  15          75
```

`agentcost models --provider xAI` (all xAI models) or `agentcost models --json` for machine-readable output.

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