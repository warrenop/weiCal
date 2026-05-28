"""Shared filesystem-path helpers. Lives in its own module so both `db.py`
and `docs.py` can import without circularity."""
import os
import sys
from pathlib import Path


def _default_data_dir() -> Path:
    if sys.platform == "darwin":
        return Path.home() / "Library" / "Application Support" / "mycal"
    if sys.platform.startswith("win"):
        base = os.environ.get("LOCALAPPDATA") or (Path.home() / "AppData" / "Local")
        return Path(base) / "mycal"
    base = os.environ.get("XDG_DATA_HOME") or (Path.home() / ".local" / "share")
    return Path(base) / "mycal"


DATA_DIR: Path = (
    Path(os.environ["MYCAL_DATA_DIR"]).expanduser()
    if os.environ.get("MYCAL_DATA_DIR")
    else _default_data_dir()
)

DOCS_REGISTRY = DATA_DIR / "documents.json"
