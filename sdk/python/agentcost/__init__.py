"""agentcost Python SDK — report LLM usage and gate agent spending.

Reads/writes the same local store as the agentcost CLI
(~/.agentcost/store.jsonl, sessions.json). Respects the AGENTCOST_HOME
environment variable so multiple tools share one store.

Examples:
    from agentcost import report_usage, check_session

    report_usage(model="gpt-4o", input_tokens=1000, output_tokens=500,
                 project="alpha", session_id="ses_xxx")
    status = check_session("ses_xxx")
    if not status["ok"]:
        raise SystemExit("session over budget")
"""

from __future__ import annotations

import json
import os
import time
from pathlib import Path
from typing import Any, Dict, List, Optional
from urllib.request import urlopen


def _home() -> Path:
    override = os.environ.get("AGENTCOST_HOME")
    if override:
        return Path(override)
    return Path.home() / ".agentcost"


def _store_path() -> Path:
    return _home() / "store.jsonl"


def _sessions_path() -> Path:
    return _home() / "sessions.json"


def _load_json(path: Path, fallback: Any) -> Any:
    try:
        return json.loads(path.read_text("utf-8"))
    except (FileNotFoundError, json.JSONDecodeError):
        return fallback


def _save_json(path: Path, value: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, indent=2) + "\n", "utf-8")


def _find_session(session_id: str) -> Optional[Dict[str, Any]]:
    for session in _load_json(_sessions_path(), []):
        if session.get("id") == session_id:
            return session
    return None


BUILTIN_PRICING = {
    "gpt-4o": (2.5, 10.0),
    "gpt-4o-mini": (0.15, 0.6),
    "o1": (15.0, 60.0),
    "o1-mini": (1.1, 4.4),
    "gpt-4.1": (2.0, 8.0),
    "gpt-4.1-mini": (0.4, 1.6),
    "gpt-4.1-nano": (0.1, 0.4),
    "claude-3-7-sonnet": (3.0, 15.0),
    "claude-3-5-sonnet": (3.0, 15.0),
    "claude-3-5-haiku": (0.8, 4.0),
    "claude-3-opus": (15.0, 75.0),
    "deepseek-chat": (0.27, 1.1),
    "deepseek-reasoner": (0.55, 2.19),
    "gemini-2.0-flash": (0.1, 0.4),
    "gemini-2.5-pro": (1.25, 10.0),
    "gemini-1.5-pro": (1.25, 5.0),
    "grok-2": (2.0, 10.0),
    "grok-beta": (5.0, 15.0),
    "mistral-large": (2.0, 6.0),
    "mistral-small": (0.2, 0.6),
    "llama-3.3-70b": (0.59, 0.79),
    "llama-3.1-8b": (0.05, 0.08),
}


def _pricing_path() -> Path:
    return _home() / "pricing.json"


def _resolve_cost(model: str, input_tokens: int, output_tokens: int) -> Optional[float]:
    overrides = _load_json(_pricing_path(), {})
    entry = overrides.get(model)
    if entry and isinstance(entry, dict):
        inp = float(entry.get("inputPerMillion", 0))
        out = float(entry.get("outputPerMillion", 0))
        return (input_tokens / 1_000_000) * inp + (output_tokens / 1_000_000) * out
    pricing = BUILTIN_PRICING.get(model)
    if not pricing:
        return None
    inp, out = pricing
    return (input_tokens / 1_000_000) * inp + (output_tokens / 1_000_000) * out


class UnknownSessionError(Exception):
    pass


class BlockedSessionError(Exception):
    pass


def report_usage(
    model: str,
    input_tokens: int,
    output_tokens: int,
    project: Optional[str] = None,
    agent: Optional[str] = None,
    session_id: Optional[str] = None,
    task: Optional[str] = None,
    kind: Optional[str] = None,
    tool_calls: Optional[int] = None,
    latency_ms: Optional[int] = None,
    context_window: Optional[int] = None,
    cost: Optional[float] = None,
    ts: Optional[str] = None,
) -> Dict[str, Any]:
    """Append one usage entry to the shared store. Raises on unknown/blocked sessions."""
    if session_id is not None:
        session = _find_session(session_id)
        if session is None:
            raise UnknownSessionError(f"Session '{session_id}' not found.")
        if session.get("blocked"):
            raise BlockedSessionError(f"Session '{session_id}' is blocked by the kill switch.")

    resolved_cost = cost if cost is not None else _resolve_cost(model, input_tokens, output_tokens)
    entry = {
        "ts": ts or time.strftime("%Y-%m-%dT%H:%M:%S.000Z", time.gmtime()),
        "model": model,
        "provider": "unknown",
        "inputTokens": int(input_tokens),
        "outputTokens": int(output_tokens),
        "cost": resolved_cost,
        "project": project,
        "agent": agent,
        "sessionId": session_id,
        "task": task,
        "kind": kind,
        "toolCalls": tool_calls,
        "latencyMs": latency_ms,
        "contextWindow": context_window,
    }
    _store_path().parent.mkdir(parents=True, exist_ok=True)
    with _store_path().open("a", encoding="utf-8") as handle:
        handle.write(json.dumps(entry, separators=(",", ":")) + "\n")
    return entry


def create_session(project: str, limit: float) -> Dict[str, Any]:
    """Start an ephemeral session with a spending limit; returns the session dict."""
    import secrets

    session = {
        "id": "ses_" + secrets.token_urlsafe(12).replace("-", "").replace("_", ""),
        "project": project,
        "limit": float(limit),
        "startedAt": time.strftime("%Y-%m-%dT%H:%M:%S.000Z", time.gmtime()),
    }
    sessions = _load_json(_sessions_path(), [])
    sessions.append(session)
    _save_json(_sessions_path(), sessions)
    return session


def end_session(session_id: str) -> Optional[Dict[str, Any]]:
    sessions = _load_json(_sessions_path(), [])
    for session in sessions:
        if session.get("id") == session_id:
            session["endedAt"] = time.strftime("%Y-%m-%dT%H:%M:%S.000Z", time.gmtime())
            _save_json(_sessions_path(), sessions)
            return session
    return None


def _session_spend(session_id: str) -> float:
    total = 0.0
    try:
        for line in _store_path().read_text("utf-8").splitlines():
            if not line.strip():
                continue
            try:
                entry = json.loads(line)
            except json.JSONDecodeError:
                continue
            if entry.get("sessionId") == session_id:
                total += float(entry.get("cost") or 0)
    except FileNotFoundError:
        pass
    return total


def check_session(session_id: str) -> Dict[str, Any]:
    """Agent-readable session status with `ok`, `status`, `reason` keys."""
    session = _find_session(session_id)
    if session is None:
        raise UnknownSessionError(f"Session '{session_id}' not found.")
    limit = float(session.get("limit", 0))
    spent = _session_spend(session_id)
    percent = (spent / limit * 100) if limit else (float("inf") if spent else 0.0)
    level = "ok"
    if percent >= 100:
        level = "over"
    elif percent >= 80:
        level = "warning"
    blocked = bool(session.get("blocked"))
    over = percent >= 100
    return {
        "ok": not over and not blocked,
        "reason": "session blocked by kill switch" if blocked else (
            "session over limit" if over else "within limit"
        ),
        "status": {
            "id": session_id,
            "project": session.get("project"),
            "limit": limit,
            "spent": spent,
            "percent": percent,
            "remaining": max(0, limit - spent),
            "level": level,
            "active": session.get("endedAt") is None,
            "blocked": blocked,
        },
    }


def _post_json(url: str, payload: Dict[str, Any], timeout: int = 10) -> None:
    data = json.dumps(payload).encode("utf-8")
    request = urlopen(url, data=data, timeout=timeout)  # noqa: S310 - user-provided alert webhook
    request.close()


def report_usage_http(server_url: str, entry: Dict[str, Any]) -> Dict[str, Any]:
    """Report usage to an agentcost server's store (experimental push endpoint)."""
    _post_json(server_url.rstrip("/") + "/api/store/push", entry)
    return entry


__all__ = [
    "report_usage",
    "create_session",
    "end_session",
    "check_session",
    "UnknownSessionError",
    "BlockedSessionError",
]