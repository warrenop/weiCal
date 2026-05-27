"""Parse WeChat Pay monthly bill (CSV or XLSX) and insert into the database with dedup."""
import csv
import io
import re
from typing import Iterable

from openpyxl import load_workbook

from .categorizer import categorize
from .db import get_conn

HEADER_KEY = "交易时间"  # First column of the actual header row.


def _to_iso(tx_time: str) -> str:
    s = (tx_time or "").strip()
    return s.replace("/", "-")


def _amount(raw: str) -> float:
    if raw is None:
        return 0.0
    if isinstance(raw, (int, float)):
        return float(raw)
    s = re.sub(r"[¥￥,\s]", "", str(raw))
    return float(s) if s else 0.0


def _direction(raw: str) -> str:
    s = (raw or "").strip()
    if s == "支出":
        return "expense"
    if s == "收入":
        return "income"
    return "neutral"


def _normalize(raw_row: dict) -> dict | None:
    """Convert a raw header→value dict into a transactions row."""
    r = {(k or "").strip(): (v.strip() if isinstance(v, str) else v) for k, v in raw_row.items()}
    tx_time = _to_iso(str(r.get("交易时间", "") or ""))
    if not tx_time:
        return None
    direction = _direction(r.get("收/支", ""))
    amount = _amount(r.get("金额(元)") or r.get("金额") or "0")
    counterparty = r.get("交易对方", "") or ""
    product = r.get("商品", "") or ""
    tx_type = r.get("交易类型", "") or ""
    wx_tx_id = (r.get("交易单号", "") or "") or None
    return {
        "tx_time": tx_time,
        "tx_type": tx_type,
        "counterparty": counterparty,
        "product": product,
        "amount": amount,
        "direction": direction,
        "pay_method": r.get("支付方式", "") or "",
        "status": r.get("当前状态", "") or "",
        "wx_tx_id": wx_tx_id,
        "category": categorize(counterparty, product, tx_type, direction),
        "source": "wechat_csv",
        "notes": r.get("备注", "") or "",
        "period": tx_time[:7],
    }


def _parse_csv(raw_bytes: bytes) -> Iterable[dict]:
    text = None
    for enc in ("utf-8-sig", "utf-8", "gbk"):
        try:
            text = raw_bytes.decode(enc)
            break
        except UnicodeDecodeError:
            continue
    if text is None:
        raise ValueError("无法解码 CSV（尝试了 utf-8 / gbk）")

    lines = text.splitlines()
    offset = next((i for i, ln in enumerate(lines) if ln.startswith(HEADER_KEY)), 0)
    body = "\n".join(lines[offset:])
    return csv.DictReader(io.StringIO(body))


def _parse_xlsx(raw_bytes: bytes) -> Iterable[dict]:
    wb = load_workbook(io.BytesIO(raw_bytes), read_only=True, data_only=True)
    ws = wb.active
    header: list[str] | None = None
    for row in ws.iter_rows(values_only=True):
        cells = ["" if c is None else (c if isinstance(c, str) else str(c)) for c in row]
        if header is None:
            if cells and cells[0].strip().startswith(HEADER_KEY):
                header = [c.strip() for c in cells]
            continue
        if not any(cells):
            continue
        yield dict(zip(header, cells))


def _looks_like_xlsx(raw_bytes: bytes, file_name: str) -> bool:
    if file_name.lower().endswith((".xlsx", ".xlsm")):
        return True
    # xlsx files are zip archives — magic bytes "PK\x03\x04".
    return raw_bytes[:4] == b"PK\x03\x04"


def parse_wechat_bill(raw_bytes: bytes, file_name: str = "") -> list[dict]:
    raw_rows = _parse_xlsx(raw_bytes) if _looks_like_xlsx(raw_bytes, file_name) else _parse_csv(raw_bytes)
    return [n for n in (_normalize(r) for r in raw_rows) if n]


def import_wechat_bill(raw_bytes: bytes, file_name: str) -> dict:
    rows = parse_wechat_bill(raw_bytes, file_name)
    inserted = skipped = failed = 0
    period_start = period_end = None
    if rows:
        times = sorted(r["tx_time"] for r in rows)
        period_start, period_end = times[0][:10], times[-1][:10]

    with get_conn() as conn:
        for row in rows:
            try:
                cur = conn.execute(
                    """INSERT OR IGNORE INTO transactions
                       (tx_time, tx_type, counterparty, product, amount, direction,
                        pay_method, status, wx_tx_id, category, source, notes, period)
                       VALUES (:tx_time, :tx_type, :counterparty, :product, :amount, :direction,
                               :pay_method, :status, :wx_tx_id, :category, :source, :notes, :period)""",
                    row,
                )
                if cur.rowcount == 1:
                    inserted += 1
                else:
                    skipped += 1
            except Exception:
                failed += 1
        conn.execute(
            """INSERT INTO import_logs (file_name, period_start, period_end, inserted, skipped, failed)
               VALUES (?, ?, ?, ?, ?, ?)""",
            (file_name, period_start, period_end, inserted, skipped, failed),
        )

    return {
        "inserted": inserted,
        "skipped": skipped,
        "failed": failed,
        "period_start": period_start,
        "period_end": period_end,
        "total": len(rows),
    }


# Back-compat aliases for existing route callers.
parse_wechat_csv = parse_wechat_bill
import_wechat_csv = import_wechat_bill
