from fastapi import APIRouter, UploadFile, File, HTTPException
from datetime import datetime
from ..db import get_conn
from ..importer import import_wechat_csv

router = APIRouter(prefix="/api/imports", tags=["imports"])


@router.post("/wechat")
async def upload_wechat(file: UploadFile = File(...)):
    raw = await file.read()
    if not raw:
        raise HTTPException(400, "empty file")
    try:
        result = import_wechat_csv(raw, file.filename or "upload.csv")
    except ValueError as e:
        raise HTTPException(400, str(e))
    return result


@router.get("/status")
def status():
    today = datetime.now().strftime("%Y-%m")
    with get_conn() as conn:
        last = conn.execute(
            "SELECT * FROM import_logs ORDER BY imported_at DESC LIMIT 1"
        ).fetchone()
        cur_month_rows = conn.execute(
            "SELECT COUNT(*) AS n FROM transactions WHERE period = ?", (today,)
        ).fetchone()["n"]
    return {
        "current_period": today,
        "current_period_rows": cur_month_rows,
        "last_import": dict(last) if last else None,
    }


@router.get("/logs")
def logs(limit: int = 50):
    with get_conn() as conn:
        rows = conn.execute(
            "SELECT * FROM import_logs ORDER BY imported_at DESC LIMIT ?", (limit,)
        ).fetchall()
    return [dict(r) for r in rows]
