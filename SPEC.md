# agentcost — CLI de costos de agentes AI

Crea un CLI completo en TypeScript/Node llamado `agentcost` para estimar y trackear costos de agentes AI (LLM calls).

## Stack (decidido, no cambiar)
- TypeScript estricto, Node >= 18, ESM
- CLI parsing: `commander`
- Output con color: `picocolors`
- Build: `tsup` (bundle a CJS + ESM, bin `agentcost`)
- Tests: `vitest`
- Sin otras dependencias runtime

## Estructura
```
src/
  index.ts            # entrypoint bin
  cli.ts              # commander setup
  pricing.ts          # base de datos de precios de modelos
  estimate.ts         # comando estimate
  track.ts            # comando track (parsea logs)
  models.ts           # comando models (lista modelos)
  types.ts
test/
  pricing.test.ts
  estimate.test.ts
  track.test.ts
README.md
package.json
tsconfig.json
tsup.config.ts
vitest.config.ts
.gitignore
```

## Comandos
1. `agentcost estimate --model gpt-4o --input 1000 --output 500`
   - Calcula costo en USD de una llamada: input_tokens/1M * precio_input + output_tokens/1M * precio_output
   - Flags: `--input`, `--output`, `--model` (requeridos), `--json` (output machine-readable)
   - Si el modelo no existe en la base, error claro listando modelos cercanos

2. `agentcost track <file>`
   - Parsear archivos de uso en formato JSONL de OpenAI (campos usage.prompt_tokens, usage.completion_tokens, model) y Anthropic (usage.input_tokens, usage.output_tokens, model)
   - Detectar formato automáticamente por campos
   - Output: tabla por modelo (llamadas, input total, output total, costo) + total general
   - Flag `--json`

3. `agentcost models`
   - Lista todos los modelos con precios por 1M tokens (input/output)
   - Flag `--json`, flag `--provider <name>` para filtrar

## Base de precios (pricing.ts) — incluir al menos:
- OpenAI: gpt-4o (2.50/10.00), gpt-4o-mini (0.15/0.60), o1 (15/60), o1-mini (1.10/4.40), gpt-4.1 (2/8), gpt-4.1-mini (0.40/1.60), gpt-4.1-nano (0.10/0.40)
- Anthropic: claude-3-7-sonnet (3/15), claude-3-5-sonnet (3/15), claude-3-5-haiku (0.80/4), claude-3-opus (15/75)
- DeepSeek: deepseek-chat (0.27/1.10), deepseek-reasoner (0.55/2.19)
- Google: gemini-2.0-flash (0.10/0.40), gemini-2.5-pro (1.25/10), gemini-1.5-pro (1.25/5)
- xAI: grok-2 (2/10), grok-beta (5/15)
- Mistral: mistral-large (2/6), mistral-small (0.20/0.60)
- Meta: llama-3.3-70b (0.59/0.79 via provider), llama-3.1-8b (0.05/0.08)
- Formato: `{ model: { provider, inputPerMillion, outputPerMillion } }`

## Detalles de calidad
- Tipado estricto sin `any` sueltos
- Errores claros en español? NO — todo output en inglés (es proyecto open source)
- Tablas alineadas con padding, colores: modelos en cyan, costos en green, totales en bold
- `--json` siempre stdout parseable (nada de logs mezclados)
- Tests para: cálculo de estimate, parsing de ambos formatos de log, lista de modelos
- README con: qué es, install (npm i -g / npx), uso de cada comando, ejemplos de salida, cómo contribuir con precios
- package.json: name `agentcost`, bin `{ "agentcost": "./dist/index.js" }`, scripts: build (tsup), test (vitest run), typecheck (tsc --noEmit), prepublishOnly
- .gitignore: node_modules, dist, *.log

Escribe TODO el código. No dejes TODOs ni placeholders. Debe compilar y pasar tests.
