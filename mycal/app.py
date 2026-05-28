import sys
from pathlib import Path

from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles

from . import __version__, db
from .categorizer import ALL_CATEGORIES, CATEGORY_COLORS
from .routes import budgets, imports, summary, transactions


def _web_dir() -> Path:
    """Locate the web/ assets dir. In a PyInstaller-frozen build the assets
    are unpacked under sys._MEIPASS at runtime."""
    if getattr(sys, "frozen", False) and hasattr(sys, "_MEIPASS"):
        return Path(sys._MEIPASS) / "web"
    return Path(__file__).resolve().parent.parent / "web"


WEB_DIR = _web_dir()


class NoCacheStatic(StaticFiles):
    """StaticFiles + Cache-Control: no-store. Local app — caching just
    causes stale HTML/CSS/JS after edits."""

    async def get_response(self, path, scope):
        response = await super().get_response(path, scope)
        response.headers["Cache-Control"] = "no-store"
        return response


def create_app() -> FastAPI:
    db.open_db()  # auto-unlock via Keychain at startup
    app = FastAPI(title="微记账本 (mycal)", version="0.3.0")
    app.include_router(transactions.router)
    app.include_router(summary.router)
    app.include_router(imports.router)
    app.include_router(budgets.router)

    @app.get("/api/meta")
    def meta():
        return {
            "categories": ALL_CATEGORIES,
            "colors": CATEGORY_COLORS,
            "version": __version__,
            "repo": "warrenop/weiCal",
        }

    @app.post("/api/admin/reset")
    def reset_all():
        """Destroy everything: db file + Keychain key. Use with caution.
        Next request re-creates an empty encrypted db with a fresh key."""
        db.reset_all()
        return {"ok": True}

    app.mount("/", NoCacheStatic(directory=WEB_DIR, html=True), name="web")
    return app


app = create_app()
