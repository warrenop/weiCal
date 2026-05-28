"""Multi-document registry.

Each document is an independent SQLCipher database file plus its own
encryption key in the system keychain. The user sees them as "accounts" or
"ledgers" (个人 / 家庭 / 工作 / …), only one is **active** at a time.

The registry lives at `<DATA_DIR>/documents.json` and looks like:

    {
      "current": "<doc_id>",
      "documents": [
        {
          "id": "abcdef…",
          "name": "默认",
          "file": "abcdef.db",
          "keychain_key": "doc-abcdef",
          "created_at": "2026-…",
          "opened_at": "2026-…"
        },
        ...
      ]
    }

`id` is a short uuid hex (stable; used as filename and keychain entry).
`name` is the user-facing label (Chinese / emoji / anything).

Legacy migration: the very first run after upgrading from <0.6.0 will see
an existing `mycal.db` + the old keychain entry `db-encryption-key`. It
registers that as a "legacy" document so nothing is lost.
"""
import json
import os
import secrets
import uuid
from datetime import datetime
from pathlib import Path
from typing import Optional, TypedDict

import keyring

from .paths import DATA_DIR, DOCS_REGISTRY


KEYRING_SERVICE = "mycal"
LEGACY_KEYCHAIN_NAME = "db-encryption-key"   # what v<0.6 used
LEGACY_DB_FILENAME = "mycal.db"
KEY_FALLBACK_DIR = DATA_DIR / "keys"


# ---------- key storage (system keyring with file fallback) ----------
#
# Prefer the OS keychain (macOS Keychain / Windows Credential Manager / Linux
# Secret Service). But on headless Linux — servers, minimal installs, CI — no
# Secret Service / D-Bus session exists and `keyring` raises. In that case we
# fall back to a 0600 key file next to the data dir so the app still works.
# (Less secure than the keychain, but only used when no keychain is available;
# protect it with disk encryption / FS permissions.)

def _keyfile(name: str) -> Path:
    return KEY_FALLBACK_DIR / f"{name}.key"


def _key_get(name: str) -> Optional[str]:
    try:
        v = keyring.get_password(KEYRING_SERVICE, name)
        if v:
            return v
    except Exception:
        pass
    p = _keyfile(name)
    if p.exists():
        return p.read_text(encoding="utf-8").strip()
    return None


def _key_set(name: str, value: str) -> None:
    try:
        keyring.set_password(KEYRING_SERVICE, name, value)
        return
    except Exception:
        pass
    KEY_FALLBACK_DIR.mkdir(parents=True, exist_ok=True)
    p = _keyfile(name)
    p.write_text(value, encoding="utf-8")
    try:
        os.chmod(p, 0o600)
    except OSError:
        pass


def _key_delete(name: str) -> None:
    try:
        keyring.delete_password(KEYRING_SERVICE, name)
    except Exception:
        pass
    try:
        _keyfile(name).unlink()
    except FileNotFoundError:
        pass


class Document(TypedDict):
    id: str
    name: str
    file: str
    keychain_key: str
    created_at: str
    opened_at: Optional[str]


# ---------- registry I/O ----------

def _now() -> str:
    return datetime.now().isoformat(timespec="seconds")


def _load() -> dict:
    """Read the registry from disk, performing legacy migration on the fly
    when needed. Always returns a fully-formed dict."""
    if DOCS_REGISTRY.exists():
        return json.loads(DOCS_REGISTRY.read_text(encoding="utf-8"))

    # Maybe migrate from pre-0.6 single-file layout
    legacy_db = DATA_DIR / LEGACY_DB_FILENAME
    if legacy_db.exists():
        doc: Document = {
            "id": "legacy",
            "name": "默认",
            "file": LEGACY_DB_FILENAME,
            "keychain_key": LEGACY_KEYCHAIN_NAME,
            "created_at": _now(),
            "opened_at": _now(),
        }
        reg = {"current": "legacy", "documents": [doc]}
        _save(reg)
        return reg

    # Fresh install
    return {"current": None, "documents": []}


def _save(reg: dict) -> None:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    DOCS_REGISTRY.write_text(
        json.dumps(reg, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )


def _by_id(reg: dict, doc_id: str) -> Optional[Document]:
    for d in reg["documents"]:
        if d["id"] == doc_id:
            return d
    return None


def _new_id() -> str:
    """Short stable identifier — 12 hex chars is collision-safe at this scale."""
    return uuid.uuid4().hex[:12]


# ---------- public API ----------

def list_docs() -> list[Document]:
    return _load()["documents"]


def current_doc() -> Optional[Document]:
    reg = _load()
    cur_id = reg.get("current")
    if not cur_id:
        return None
    return _by_id(reg, cur_id)


def ensure_default_exists() -> Document:
    """Called on first need-to-open if registry is empty. Creates the very
    first document so the app has something to talk to."""
    reg = _load()
    if reg["documents"]:
        cur = _by_id(reg, reg["current"]) if reg["current"] else reg["documents"][0]
        if not reg["current"]:
            reg["current"] = cur["id"]
            _save(reg)
        return cur
    return create_doc("默认", make_current=True)


def create_doc(name: str, *, make_current: bool = True) -> Document:
    name = name.strip()
    if not name:
        raise ValueError("名称不能为空")
    reg = _load()
    if any(d["name"] == name for d in reg["documents"]):
        raise ValueError(f"已存在同名文档「{name}」")

    doc_id = _new_id()
    keychain_key = f"doc-{doc_id}"
    # Pre-mint the encryption key so the DB layer can pick it up
    _key_set(keychain_key, secrets.token_urlsafe(48))

    doc: Document = {
        "id": doc_id,
        "name": name,
        "file": f"{doc_id}.db",
        "keychain_key": keychain_key,
        "created_at": _now(),
        "opened_at": _now() if make_current else None,
    }
    reg["documents"].append(doc)
    if make_current or not reg.get("current"):
        reg["current"] = doc_id
    _save(reg)
    return doc


def switch_doc(doc_id: str) -> Document:
    reg = _load()
    doc = _by_id(reg, doc_id)
    if not doc:
        raise ValueError(f"文档不存在: {doc_id}")
    doc["opened_at"] = _now()
    reg["current"] = doc_id
    _save(reg)
    return doc


def rename_doc(doc_id: str, new_name: str) -> Document:
    new_name = new_name.strip()
    if not new_name:
        raise ValueError("名称不能为空")
    reg = _load()
    doc = _by_id(reg, doc_id)
    if not doc:
        raise ValueError(f"文档不存在: {doc_id}")
    if any(d["name"] == new_name and d["id"] != doc_id for d in reg["documents"]):
        raise ValueError(f"已存在同名文档「{new_name}」")
    doc["name"] = new_name
    _save(reg)
    return doc


def delete_doc(doc_id: str) -> None:
    reg = _load()
    doc = _by_id(reg, doc_id)
    if not doc:
        raise ValueError(f"文档不存在: {doc_id}")
    if len(reg["documents"]) == 1:
        raise ValueError("至少保留一个文档")

    # Remove db file + keychain entry
    db_path = DATA_DIR / doc["file"]
    try:
        db_path.unlink()
    except FileNotFoundError:
        pass
    _key_delete(doc["keychain_key"])

    reg["documents"] = [d for d in reg["documents"] if d["id"] != doc_id]
    if reg["current"] == doc_id:
        reg["current"] = reg["documents"][0]["id"]
    _save(reg)


def get_key_for(doc: Document) -> str:
    """Fetch the SQLCipher key for `doc` from the keychain (or file fallback),
    minting one if missing."""
    key = _key_get(doc["keychain_key"])
    if key:
        return key
    key = secrets.token_urlsafe(48)
    _key_set(doc["keychain_key"], key)
    return key
