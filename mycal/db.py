"""Encrypted SQLite store, multi-document aware.

The currently active document is determined by `docs.current_doc()`. Its
SQLCipher key lives in the system Keychain. Switching documents tears down
the active connection and opens the next one.
"""
from contextlib import contextmanager
from pathlib import Path

import sqlcipher3 as sqlite3  # API-compatible with stdlib sqlite3

from . import docs
from .paths import DATA_DIR


# ---------- schema ----------

SCHEMA = """
CREATE TABLE IF NOT EXISTS transactions (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    tx_time         TEXT    NOT NULL,
    tx_type         TEXT,
    counterparty    TEXT,
    product         TEXT,
    amount          REAL    NOT NULL,
    direction       TEXT    NOT NULL,
    pay_method      TEXT,
    status          TEXT,
    wx_tx_id        TEXT,
    category        TEXT    NOT NULL DEFAULT '其他',
    source          TEXT    NOT NULL DEFAULT 'manual',
    notes           TEXT,
    period          TEXT    NOT NULL,
    created_at      TEXT    NOT NULL DEFAULT (datetime('now','localtime')),
    updated_at      TEXT    NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_tx_wxid ON transactions(wx_tx_id) WHERE wx_tx_id IS NOT NULL AND wx_tx_id <> '';
CREATE INDEX IF NOT EXISTS idx_tx_period ON transactions(period);
CREATE INDEX IF NOT EXISTS idx_tx_time   ON transactions(tx_time);
CREATE INDEX IF NOT EXISTS idx_tx_cat    ON transactions(category);

CREATE TABLE IF NOT EXISTS import_logs (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    file_name       TEXT,
    period_start    TEXT,
    period_end      TEXT,
    inserted        INTEGER NOT NULL DEFAULT 0,
    skipped         INTEGER NOT NULL DEFAULT 0,
    failed          INTEGER NOT NULL DEFAULT 0,
    imported_at     TEXT    NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS budgets (
    category   TEXT PRIMARY KEY,
    amount     REAL NOT NULL CHECK (amount >= 0),
    created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS budget_overrides (
    category   TEXT NOT NULL,
    period     TEXT NOT NULL,
    amount     REAL NOT NULL CHECK (amount >= 0),
    created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
    PRIMARY KEY (category, period)
);
CREATE INDEX IF NOT EXISTS idx_bg_overrides_period ON budget_overrides(period);
"""


# ---------- connection state ----------

_conn: sqlite3.Connection | None = None
_open_doc_id: str | None = None


def _open_for(doc: dict) -> sqlite3.Connection:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    db_path = DATA_DIR / doc["file"]
    key = docs.get_key_for(doc)
    conn = sqlite3.connect(db_path, check_same_thread=False)
    conn.row_factory = sqlite3.Row
    safe = key.replace("'", "''")
    conn.execute(f"PRAGMA key = '{safe}'")
    try:
        conn.execute("SELECT count(*) FROM sqlite_master").fetchone()
    except sqlite3.DatabaseError as e:
        conn.close()
        raise RuntimeError(
            f"无法打开加密数据库 {db_path.name}: {e}. "
            "Keychain 中的密钥可能与该 db 文件不匹配。"
        ) from e
    conn.executescript(SCHEMA)
    # Backfill: import_logs.source column was added in 0.6.1; ALTER fails
    # if the column already exists, which is fine.
    try:
        conn.execute("ALTER TABLE import_logs ADD COLUMN source TEXT")
    except sqlite3.OperationalError:
        pass
    conn.commit()
    return conn


def open_db() -> None:
    """Open (or re-open) the currently-active document. Idempotent — calling
    when the same doc is already open is a no-op."""
    global _conn, _open_doc_id
    doc = docs.current_doc() or docs.ensure_default_exists()
    if _conn is not None and _open_doc_id == doc["id"]:
        return
    if _conn is not None:
        try:
            _conn.close()
        finally:
            _conn = None
    _conn = _open_for(doc)
    _open_doc_id = doc["id"]


def close_db() -> None:
    global _conn, _open_doc_id
    if _conn is not None:
        try:
            _conn.close()
        finally:
            _conn = None
    _open_doc_id = None


def reload_for_active_doc() -> dict:
    """Called by routes after `docs.switch_doc()` to bring the connection up
    to date. Returns the new active doc."""
    close_db()
    open_db()
    return docs.current_doc()


def reset_active() -> None:
    """Nuke the active document's db file (Keychain key stays — file recreated
    next time and re-encrypts under the same key)."""
    global _conn, _open_doc_id
    doc = docs.current_doc()
    close_db()
    if doc:
        try:
            (DATA_DIR / doc["file"]).unlink()
        except FileNotFoundError:
            pass


@contextmanager
def get_conn():
    if _conn is None:
        open_db()
    try:
        yield _conn
        _conn.commit()
    except Exception:
        _conn.rollback()
        raise


# ---------- back-compat ----------

def init_db() -> None:  # used by older callers; no-op now
    open_db()


# Convenience: expose the active db file path (used by /api/admin)
@property
def DB_PATH() -> Path:
    doc = docs.current_doc()
    return DATA_DIR / doc["file"] if doc else DATA_DIR / "no-doc.db"
