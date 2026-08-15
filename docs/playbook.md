# agentcost Playbook — auto-limitado para agentes

System prompts listos para pegar en cualquier agente (CLI, MCP, CI) para que use
`check`/`route` y se auto-limite sin intervención humana.

## 1. Reglas de oro

1. Antes de empezar una tarea larga, arranca sesión: `agentcost session start --project X --limit $5` y conserva el `sessionId`.
2. Cada llamada LLM que hagas, etiquétala con `--session <id>` (o `track --save --session <id>`).
3. Antes de cada turno caro, consulta `agentcost check --session <id> --json`.
   - Si `ok` es `false`, **para** (no más llamadas al LLM) y reporta al humano.
4. Nunca elijas el modelo "a mano": usa `agentcost route --task "..." --quality <nivel> --session <id> --json`.
5. Si estás al 80% del presupuesto, baja el tier (el router ya lo hace solo cuando le pasas `--session`).

## 2. Prompt de inicio de agente

```
Eres un agente que DEBE limitar su gasto de LLM.

GESTIÓN DE SESIÓN:
1. Ejecuta: agentcost session start --project <proyecto> --limit $<presupuesto>
   → guarda el sessionId en tu estado.
2. Para elegir modelo, ejecuta:
   agentcost route --task "<qué vas a hacer>" --quality <low|medium|high|critical> --session <sessionId> --json
   → usa el campo "model" devuelto. Nunca uses otro modelo salvo autorización explícita.
3. Después de CADA llamada LLM, reporta el uso:
   agentcost track <log> --save --session <sessionId> --project <proyecto>
   o vía SDK: reportUsage(model, input_tokens, output_tokens, session_id=..., ...)

CHECKPOINTS OBLIGATORIOS:
- Antes de cada turno que implique > 5 llamadas LLM o > 20k tokens de contexto:
  agentcost check --session <sessionId> --json
  - Si status.percent >= 80: usa SOLO modelos de tier inferior (o deja que route --session lo haga).
  - Si ok == false (over o blocked): DETENTE. Responde al usuario que el presupuesto se agotó
    y sugiere subir el límite o resetear: agentcost session reset --id <sessionId>.

PROHIBIDO:
- Continuar llamando al LLM cuando check reporta ok == false.
- Elegir un modelo de tier superior al que route recomienda.
- Ignorar alertas de presupuesto.

Al terminar: agentcost session end --id <sessionId>
```

## 3. Prompt para CI

```
La CI usa agentcost check --exit-if-over para bloquear pasos que exceden el
presupuesto. Si un paso falla por límite agotado:
- Revisa si el aumento es legítimo (más tokens de contexto, nuevo feature).
- Si NO es legítimo, optimiza: agentcost optimize --project <proyecto> y aplica los cambios sugeridos.
```

## 4. Prompt para agentes que usan SDK (JS/TS)

```ts
import { sdk } from "@agentcost/sdk";

const session = sdk.createSession("alpha", 5);
sdk.reportUsage({ model: "gpt-4o", inputTokens: 1000, outputTokens: 500, sessionId: session.id });
const { ok, status } = sdk.checkSession(session.id);
if (!ok) process.exit(1); // circuito abierto: detente

const model = sdk.route("refactor the auth module", "high", { sessionId: session.id }).model;
```

## 5. Cheat sheet para el agente

| Situación | Comando |
| --- | --- |
| Quiero arrancar a medir | `agentcost session start --project X --limit 5` |
| ¿Cuánto llevo gastado? | `agentcost check --session <id> --json` |
| ¿Qué modelo uso? | `agentcost route --task "..." --quality high --session <id> --json` |
| ¿Estoy a punto de pasarme? | `agentcost check --session <id> --exit-if-over` (exit 1 = al límite) |
| Quiero que me bloqueen al pasarme | `agentcost check --session <id> --kill` |
| Avisar por Slack/Telegram al 80%/100% | `agentcost alerts set --slack <url> --webhook <url>` |
| Recomendaciones con datos reales | `agentcost optimize --project X` |
| Facturar a un cliente | `agentcost report --export-client "cliente"` |
| Dashboard web | `agentcost server --port 8080` → `/dashboard` |

## 6. Auto-limitado por exit codes

`agentcost` está diseñado para que el agente pueda parsear todo con `--json` y
bloquearse por exit code:

- `check --exit-if-over` → `exit 1` cuando el gasto >= 100% del límite.
- `check --kill` → además marca la sesión como **blocked** (circuit breaker). El SDK
  y `track --save` rechazan llamadas a sesiones bloqueadas con `BlockedSessionError`.
- `budget check` → `exit 1` cuando un proyecto pasa el presupuesto mensual.
- `route` → nunca devuelve un modelo fuera de política (allow/deny por `policy`).