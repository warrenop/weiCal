from fastapi import APIRouter, UploadFile, File, HTTPException
from datetime import datetime
from ..db import get_conn
from ..importer import import_bill, preview_bill

router = APIRouter(prefix="/api/imports", tags=["imports"])


async def _do_upload(file: UploadFile) -> dict:
    raw = await file.read()
    if not raw:
        raise HTTPException(400, "empty file")
    try:
        return import_bill(raw, file.filename or "upload.csv")
    except ValueError as e:
        raise HTTPException(400, str(e))


@router.post("/preview")
async def preview(file: UploadFile = File(...)):
    """Parse a bill WITHOUT importing — returns stats + dedup estimate +
    sample rows for the import wizard's confirmation step."""
    raw = await file.read()
    if not raw:
        raise HTTPException(400, "empty file")
    try:
        return preview_bill(raw, file.filename or "upload.csv")
    except ValueError as e:
        raise HTTPException(400, str(e))


@router.post("/bill")
async def upload_bill(file: UploadFile = File(...)):
    """Auto-detects WeChat / Alipay bill format and imports."""
    return await _do_upload(file)


@router.post("/wechat")
async def upload_wechat_compat(file: UploadFile = File(...)):
    """Backward-compat alias; same auto-detection as /bill."""
    return await _do_upload(file)


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
