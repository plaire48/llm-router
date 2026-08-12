from __future__ import annotations

import asyncio
import sqlite3
import time
from dataclasses import asdict, dataclass
from pathlib import Path

_SCHEMA = """
CREATE TABLE IF NOT EXISTS calls (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    started_at REAL NOT NULL,
    duration_ms INTEGER,
    profile TEXT NOT NULL,
    provider TEXT NOT NULL,
    upstream_model TEXT NOT NULL,
    stream INTEGER NOT NULL,
    status INTEGER,
    ok INTEGER NOT NULL,
    error_code TEXT,
    error_message TEXT,
    prompt_tokens INTEGER,
    completion_tokens INTEGER,
    total_tokens INTEGER,
    request_body TEXT,
    response_body TEXT
);
CREATE INDEX IF NOT EXISTS idx_calls_started_at ON calls(started_at DESC);
CREATE INDEX IF NOT EXISTS idx_calls_profile ON calls(profile);
"""

_LIST_COLUMNS = (
    "id, started_at, duration_ms, profile, provider, upstream_model, stream, "
    "status, ok, error_code, error_message, prompt_tokens, completion_tokens, total_tokens"
)


@dataclass
class CallRecord:
    started_at: float
    profile: str
    provider: str
    upstream_model: str
    stream: bool
    duration_ms: int | None = None
    status: int | None = None
    ok: bool = False
    error_code: str | None = None
    error_message: str | None = None
    prompt_tokens: int | None = None
    completion_tokens: int | None = None
    total_tokens: int | None = None
    request_body: str | None = None
    response_body: str | None = None


class UsageStore:
    def __init__(self, path: str | Path) -> None:
        self.path = Path(path)
        self.path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
        self._connection = sqlite3.connect(self.path, check_same_thread=False)
        self._connection.row_factory = sqlite3.Row
        self._connection.execute("PRAGMA journal_mode=WAL")
        self._connection.executescript(_SCHEMA)
        self._connection.commit()
        self._lock = asyncio.Lock()

    def close(self) -> None:
        self._connection.close()

    async def record(self, record: CallRecord) -> None:
        payload = asdict(record)
        payload["stream"] = int(record.stream)
        payload["ok"] = int(record.ok)
        columns = ", ".join(payload)
        placeholders = ", ".join(f":{name}" for name in payload)
        async with self._lock:
            self._connection.execute(
                f"INSERT INTO calls ({columns}) VALUES ({placeholders})",
                payload,
            )
            self._connection.commit()

    async def summary(self, days: int) -> list[dict]:
        since = time.time() - days * 86400
        async with self._lock:
            rows = self._connection.execute(
                """
                SELECT date(started_at, 'unixepoch', 'localtime') AS day,
                       profile,
                       provider,
                       upstream_model,
                       COUNT(*) AS calls,
                       SUM(COALESCE(prompt_tokens, 0)) AS prompt_tokens,
                       SUM(COALESCE(completion_tokens, 0)) AS completion_tokens,
                       SUM(COALESCE(total_tokens, 0)) AS total_tokens,
                       SUM(CASE WHEN ok = 0 THEN 1 ELSE 0 END) AS errors
                FROM calls
                WHERE started_at >= ?
                GROUP BY day, profile, provider, upstream_model
                ORDER BY day DESC, profile ASC, upstream_model ASC
                """,
                (since,),
            ).fetchall()
        return [dict(row) for row in rows]

    async def calls(self, limit: int, offset: int, profile: str | None) -> list[dict]:
        async with self._lock:
            rows = self._connection.execute(
                f"""
                SELECT {_LIST_COLUMNS}
                FROM calls
                WHERE (:profile IS NULL OR profile = :profile)
                ORDER BY started_at DESC, id DESC
                LIMIT :limit OFFSET :offset
                """,
                {"profile": profile, "limit": limit, "offset": offset},
            ).fetchall()
        return [dict(row) for row in rows]

    async def call(self, call_id: int) -> dict | None:
        async with self._lock:
            row = self._connection.execute(
                "SELECT * FROM calls WHERE id = ?", (call_id,)
            ).fetchone()
        return dict(row) if row is not None else None
