# agentcost v1.1 + v2 — Especificación de mejoras

Extiende el proyecto existente (ya hay src/{index,cli,pricing,estimate,track,models,types}.ts, tests con vitest, build con tsup). NO rompas lo que ya funciona: todos los tests existentes deben seguir pasando.

## Nuevas dependencias (permitidas)
- `js-tiktoken` para token counting real (con fallback si no soporta el modelo: estimación chars/4)
- Nada más runtime. Todo lo demás con stdlib de Node.

## 1. Token counting real — comando `tokens`
- `agentcost tokens "texto" [--model gpt-4o]` → cuenta tokens con js-tiktoken usando el encoding del modelo (mapa modelo→encoding: o1/gpt-4o/gpt-4.1 → o200k_base, gpt-4o-mini → o200k_base, claude → cl100k_base aproximado, default o200k_base)
- Si el modelo no tiene encoding conocido, usa o200k_base y muestra warning a stderr
- `--json` para salida parseable: `{tokens, model, encoding}`
- Integrar en `estimate`: si el usuario pasa `--input-text "..."` y `--output-text "..."`, contar tokens automáticamente en vez de pedir `--input`/`--output`

## 2. Pricing sync — comando `pricing`
- `agentcost pricing sync [--url <registry-url>]` → descarga un JSON de precios (formato: `{ "model": { "provider", "inputPerMillion", "outputPerMillion", "updatedAt" } }`) y lo guarda en `~/.agentcost/pricing.json` (overrides locales)
- Default URL: apunta a un gist/raw de ejemplo (poner URL pública de ejemplo en el README; si falla la red, error claro y no romper)
- `agentcost pricing reset` → borra los overrides locales
- Al resolver precios: primero overrides locales, luego built-in. `estimate`/`track`/`models` muestran un asterisco `*` si el precio viene de override
- `models` gana flag `--pricing-file <path>` para cargar un JSON local

## 3. Más formatos de log en `track`
- Ya soporta JSONL OpenAI y Anthropic. Agregar:
  - Líneas con `{"type":"usage"}` (formato OpenClaw/agentes)
  - Campos alternativos: `prompt_tokens`/`completion_tokens` (OpenAI), `input_tokens`/`output_tokens` (Anthropic), `total_tokens`
  - `--format auto|openai|anthropic` para forzar formato
  - Soporte para archivos `.ndjson`, `.jsonl`, `.log` con detección por extensión y contenido
- Si una línea no parsea, warning a stderr y contar en `skipped` (ya existe ese campo)

## 4. Store local + comando `report`
- Guardar uso en `~/.agentcost/store.jsonl` (append, una entrada por llamada: `{ts, model, provider, inputTokens, outputTokens, cost, project?, agent?, sessionId?}`)
- `agentcost track <file> --save` → además de mostrar, guarda en el store
- `agentcost report [--period today|week|month|all] [--project X] [--agent Y] [--json]` → agrega del store: total por modelo, por proyecto, por agente, total general, tendencia día a día (últimos 7 días)
- `agentcost report --top 5` → top 5 modelos más caros

## 5. Presupuestos — comando `budget`
- `agentcost budget set --project X --monthly 50` → guarda presupuesto en `~/.agentcost/budget.json`
- `agentcost budget list` → lista presupuestos y consumo actual del store (porcentaje)
- `agentcost budget check` → exit 0 si todo dentro, exit 1 si algún proyecto pasó 100%, warning al 80%
- `agentcost report` muestra warnings de presupuesto automáticamente

## 6. Watch daemon — comando `watch`
- `agentcost watch [--dir DIR] [--interval 5s] [--save]` → monitorea DIR (default: cwd) por archivos nuevos/modificados con extensiones .jsonl/.ndjson/.log, parsea con la misma lógica de track, muestra cada llamada en vivo (modelo, tokens, costo, color verde si < $0.01, amarillo < $0.10, rojo >= $0.10), y con `--save` los guarda en el store
- Evitar re-procesar archivos ya vistos: mantener hash de archivo+offset en `~/.agentcost/watch-state.json`
- Ctrl+C limpio (SIGINT → mensaje "watch stopped, N calls captured")

## 7. TUI live — comando `live`
- `agentcost live [--dir DIR]` → lo mismo que watch pero con dashboard en terminal: tabla que se refresca cada 2s (usar ANSI escape codes `\x1b[H\x1b[J`, sin dependencias), mostrando: total acumulado, llamadas, por modelo, por minuto, top agente/proyecto
- Al salir (Ctrl+C), imprimir el resumen final como report
- Si la terminal no es TTY (no process.stdout.isTTY), degradar a watch normal

## 8. Detalles de calidad
- Tipado estricto, sin `any`
- Errores claros en inglés, exit codes correctos (1 = error, 0 = ok, budget check usa 1 para over-budget)
- Tests nuevos:
  - tokens: conteo de una frase conocida (gpt-4o), fallback
  - pricing: sync con archivo local, reset, override aplicado
  - track: formatos nuevos (usage type, ndjson), --format forzado
  - report: agregación con store temporal (usar env AGENTCOST_HOME para apuntar a dir temporal en tests)
  - budget: set/list/check con porcentajes
  - watch: procesa archivo nuevo sin re-procesar el mismo (usar AGENTCOST_HOME temporal)
- AGENTCOST_HOME env var: todas las rutas de ~/.agentcost deben respetar esta variable (clave para tests y para usuarios)
- README: documentar los comandos nuevos con ejemplos

## Estructura sugerida (puedes ajustar)
```
src/
  index.ts, cli.ts, pricing.ts, estimate.ts, track.ts, models.ts, types.ts (existentes, extender)
  tokens.ts        # nuevo
  store.ts         # nuevo: store.jsonl + budget.json + helpers AGENTCOST_HOME
  report.ts        # nuevo
  budget.ts        # nuevo
  watch.ts         # nuevo (lógica compartida con live)
  live.ts          # nuevo (TUI)
  format.ts        # nuevo: detectores de formato de log
test/ (agregar tests nuevos)
```

Escribe TODO el código. Los tests existentes deben seguir pasando. Corre typecheck, tests y build hasta que todo pase.
