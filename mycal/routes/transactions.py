from fastapi import APIRouter, HTTPException, Query
from typing import Optional
from ..db import get_conn
from ..models import TransactionIn, TransactionPatch
from ..categorizer import categorize

router = APIRouter(prefix="/api/transactions", tags=["transactions"])


def _row_to_dict(r) -> dict:
    return {k: r[k] for k in r.keys()}


@router.get("")
def list_transactions(
    year: Optional[int] = None,
    month: Optional[int] = None,
    day: Optional[int] = None,
    category: Optional[str] = None,
    direction: Optional[str] = None,
    q: Optional[str] = None,
    page: int = 1,
    page_size: int = 50,
):
    where = []
    args: list = []
    if year and month:
        where.append("period = ?")
        args.append(f"{year:04d}-{month:02d}")
    elif year:
        where.append("substr(period,1,4) = ?")
        args.append(f"{year:04d}")
    if day and year and month:
        where.append("substr(tx_time,1,10) = ?")
        args.append(f"{year:04d}-{month:02d}-{day:02d}")
    if category:
        where.append("category = ?")
        args.append(category)
    if direction:
        where.append("direction = ?")
        args.append(direction)
    if q:
        where.append("(counterparty LIKE ? OR product LIKE ? OR notes LIKE ?)")
        like = f"%{q}%"
        args.extend([like, like, like])
    sql = "SELECT * FROM transactions"
    if where:
        sql += " WHERE " + " AND ".join(where)
    sql += " ORDER BY tx_time DESC, id DESC LIMIT ? OFFSET ?"
    args.extend([page_size, (page - 1) * page_size])

    count_sql = "SELECT COUNT(*) AS n FROM transactions" + (" WHERE " + " AND ".join(where) if where else "")
    with get_conn() as conn:
        total = conn.execute(count_sql, args[:-2] if where else []).fetchone()["n"]
        rows = conn.execute(sql, args).fetchall()
    return {"total": total, "items": [_row_to_dict(r) for r in rows]}


@router.post("")
def create_transaction(payload: TransactionIn):
    period = payload.tx_time[:7]
    cat = payload.category or categorize(payload.counterparty or "", payload.product or "", payload.tx_type or "", payload.direction)
    with get_conn() as conn:
        cur = conn.execute(
            """INSERT INTO transactions
               (tx_time, tx_type, counterparty, product, amount, direction,
                pay_method, status, category, source, notes, period)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'manual', ?, ?)""",
            (payload.tx_time, payload.tx_type, payload.counterparty, payload.product,
             payload.amount, payload.direction, payload.pay_method, payload.status,
             cat, payload.notes, period),
        )
        new_id = cur.lastrowid
    return {"id": new_id}


@router.patch("/{tx_id}")
def update_transaction(tx_id: int, payload: TransactionPatch):
    fields = payload.model_dump(exclude_none=True)
    if not fields:
        return {"updated": 0}
    if "tx_time" in fields:
        fields["period"] = fields["tx_time"][:7]
    sets = ", ".join(f"{k} = ?" for k in fields)
    sets += ", updated_at = datetime('now','localtime')"
    args = list(fields.values()) + [tx_id]
    with get_conn() as conn:
        cur = conn.execute(f"UPDATE transactions SET {sets} WHERE id = ?", args)
        if cur.rowcount == 0:
            raise HTTPException(404, "not found")
    return {"updated": 1}


@router.delete("/{tx_id}")
def delete_transaction(tx_id: int):
    with get_conn() as conn:
        cur = conn.execute("DELETE FROM transactions WHERE id = ?", (tx_id,))
        if cur.rowcount == 0:
            raise HTTPException(404, "not found")
    return {"deleted": 1}
