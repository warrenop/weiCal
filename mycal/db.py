"""Encrypted SQLite store. The encryption key lives in the OS keyring
(macOS Keychain / libsecret / Windows Credential Manager), not on disk. This
means:

- No password prompt: app auto-unlocks at start using the same OS user's
  Keychain.
- The encrypted `mycal.db` file alone is useless — without the corresponding
  Keychain entry, sqlite3 can't open it (`file is not a database`).
- If you log into a different macOS user account, you can't access the data.
- The Keychain entry is gated by macOS login password / FileVault.
"""
import os
import secrets
import sys
from contextlib import contextmanager
from pathlib import Path

import keyring
import sqlcipher3 as sqlite3  # API-compatible with stdlib sqlite3


# ---------- data dir ----------

def _default_data_dir() -> Path:
    if sys.platform == "darwin":
        return Path.home() / "Library" / "Application Support" / "mycal"
    if sys.platform.startswith("win"):
        base = os.environ.get("LOCALAPPDATA") or (Path.home() / "AppData" / "Local")
        return Path(base) / "mycal"
    base = os.environ.get("XDG_DATA_HOME") or (Path.home() / ".local" / "share")
    return Path(base) / "mycal"


DATA_DIR = Path(os.environ.get("MYCAL_DATA_DIR")).expanduser() if os.environ.get("MYCAL_DATA_DIR") else _default_data_dir()
DB_PATH = DATA_DIR / "mycal.db"

# Keychain coordinates
KEYRING_SERVICE = "mycal"
KEYRING_USERNAME = "db-encryption-key"


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

-- Monthly budget configuration. One row per category. The pseudo-category
-- "_total" represents the overall monthly budget.
CREATE TABLE IF NOT EXISTS budgets (
    category   TEXT PRIMARY KEY,
    amount     REAL NOT NULL CHECK (amount >= 0),
    created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
"""


# ---------- key management ----------

def _get_or_create_key() -> str:
    """Read the encryption key from the OS keyring. Creates a fresh random
    key on first run."""
    key = keyring.get_password(KEYRING_SERVICE, KEYRING_USERNAME)
    if key:
        return key
    key = secrets.token_urlsafe(48)  # ≥ 256 bits of entropy
    keyring.set_password(KEYRING_SERVICE, KEYRING_USERNAME, key)
    return key


# ---------- connection ----------

_conn: sqlite3.Connection | None = None


def open_db() -> None:
    """Open (and lazily create) the encrypted database. Idempotent. Called
    once at app startup from `app.py:create_app`."""
    global _conn
    if _conn is not None:
        return
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    key = _get_or_create_key()
    conn = sqlite3.connect(DB_PATH, check_same_thread=False)
    conn.row_factory = sqlite3.Row
    # PRAGMA key must precede any other statement on a SQLCipher connection.
    safe = key.replace("'", "''")
    conn.execute(f"PRAGMA key = '{safe}'")
    # Verify the key matches an existing db, or create schema for a new one.
    try:
        conn.execute("SELECT count(*) FROM sqlite_master").fetchone()
    except sqlite3.DatabaseError as e:
        # Keychain entry doesn't match the db on disk. Most likely: the user
        # cleared Keychain or copied a db from another machine. Bail loudly.
        raise RuntimeError(
            f"无法打开加密数据库: {e}. 可能原因: Keychain 中的密钥与 "
            f"{DB_PATH} 不匹配。如要重置，请删除 db 文件并重新启动。"
        ) from e
    conn.executescript(SCHEMA)
    conn.commit()
    _conn = conn


def close_db() -> None:
    global _conn
    if _conn is not None:
        try:
            _conn.close()
        finally:
            _conn = None


def reset_all() -> None:
    """Destructive: delete the db file AND the Keychain key. Next start of the
    app will create a brand-new empty encrypted db with a fresh key."""
    close_db()
    try:
        DB_PATH.unlink()
    except FileNotFoundError:
        pass
    try:
        keyring.delete_password(KEYRING_SERVICE, KEYRING_USERNAME)
    except keyring.errors.PasswordDeleteError:
        pass


@contextmanager
def get_conn():
    if _conn is None:
        open_db()  # lazy fallback in case caller forgot
    try:
        yield _conn
        _conn.commit()
    except Exception:
        _conn.rollback()
        raise


# Back-compat shim for old callers.
def init_db() -> None:
    open_db()
