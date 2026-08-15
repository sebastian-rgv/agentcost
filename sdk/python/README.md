# agentcost Python SDK

Report LLM usage and gate agent spending from Python. Reads and writes the same
local store as the `agentcost` CLI (`~/.agentcost/store.jsonl`, `sessions.json`),
so everything you report is visible in `agentcost report`, `optimize`, sessions,
budgets and the web dashboard. Respects `AGENTCOST_HOME`.

## Install

```bash
pip install -e ./sdk/python
```

## Usage

```python
from agentcost import report_usage, create_session, check_session, BlockedSessionError

session = create_session("alpha", 5.0)          # same as `agentcost session start`
print(session["id"])

try:
    report_usage(
        model="gpt-4o",
        input_tokens=1000,
        output_tokens=500,
        project="alpha",
        session_id=session["id"],
        task="refactor auth",
    )
except BlockedSessionError as error:
    print("kill switch is open:", error)

status = check_session(session["id"])
print(f"${status['status']['spent']:.2f} / ${status['status']['limit']:.2f}")
if not status["ok"]:
    raise SystemExit(status["reason"])
```

Costs are computed from the built-in pricing table (or `~/.agentcost/pricing.json`
overrides). Pass `cost=` to report a custom price, e.g. from the provider's own
usage payload.