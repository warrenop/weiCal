"""Budget configuration + status (monthly, per category).

The pseudo-category `_total` represents the overall monthly budget. All other
keys are real expense categories (餐饮 / 交通 / ...).
"""
from datetime import datetime
from typing import Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from ..categorizer import ALL_CATEGORIES, CATEGORY_COLORS
from ..db import get_conn

router = APIRouter(prefix="/api/budgets", tags=["budgets"])

# Status thresholds
WARN_PCT = 70.0
OVER_PCT = 100.0


class BudgetIn(BaseModel):
    amount: float = Field(..., ge=0, le=1_000_000)


def _expense_category_keys() -> list[str]:
    """Real expense categories (excluding income)."""
    return [c for c in ALL_CATEGORIES if c != "收入"]


def _classify(percent: float) -> str:
    if percent >= OVER_PCT:
        return "over"
    if percent >= WARN_PCT:
        return "warn"
    return "ok"


@router.get("")
def list_budgets():
    """All configured budgets."""
    with get_conn() as conn:
        rows = conn.execute(
            "SELECT category, amount FROM budgets ORDER BY category"
        ).fetchall()
    return [{"category": r["category"], "amount": r["amount"]} for r in rows]


@router.put("/{category}")
def upsert_budget(category: str, payload: BudgetIn):
    category = category.strip()
    if not category:
        raise HTTPException(400, "分类不能为空")
    if category != "_total" and category not in _expense_category_keys():
        raise HTTPException(400, f"未知分类: {category}")
    with get_conn() as conn:
        conn.execute(
            """INSERT INTO budgets (category, amount) VALUES (?, ?)
               ON CONFLICT(category) DO UPDATE SET
                 amount = excluded.amount,
                 updated_at = datetime('now','localtime')""",
            (category, payload.amount),
        )
    return {"category": category, "amount": payload.amount}


@router.delete("/{category}")
def delete_budget(category: str):
    with get_conn() as conn:
        cur = conn.execute("DELETE FROM budgets WHERE category = ?", (category,))
        if cur.rowcount == 0:
            raise HTTPException(404, "未配置该分类预算")
    return {"deleted": category}


@router.get("/status")
def budget_status(year: Optional[int] = None, month: Optional[int] = None):
    """Per-category spending vs budget for a given month.

    Returns a row for every configured budget plus a `_total` summary row.
    """
    now = datetime.now()
    year = year or now.year
    month = month or now.month
    period = f"{year:04d}-{month:02d}"

    with get_conn() as conn:
        bg_rows = conn.execute("SELECT category, amount FROM budgets").fetchall()
        spent_rows = conn.execute(
            """SELECT category, SUM(amount) AS s
               FROM transactions
               WHERE period = ? AND direction = 'expense'
               GROUP BY category""",
            (period,),
        ).fetchall()
        total_row = conn.execute(
            """SELECT COALESCE(SUM(amount), 0) AS s
               FROM transactions WHERE period = ? AND direction = 'expense'""",
            (period,),
        ).fetchone()

    spent = {r["category"]: r["s"] for r in spent_rows}
    total_spent = total_row["s"] or 0.0

    out = []
    for r in bg_rows:
        cat = r["category"]
        budget = r["amount"]
        used = total_spent if cat == "_total" else (spent.get(cat) or 0.0)
        percent = round(used / budget * 100, 1) if budget > 0 else 0.0
        out.append({
            "category": cat,
            "budget": budget,
            "spent": round(used, 2),
            "remaining": round(budget - used, 2),
            "percent": percent,
            "status": _classify(percent),
            "color": CATEGORY_COLORS.get(cat),  # None for "_total"
        })

    # Sort: _total first, then by percent desc (worst budgets surface)
    out.sort(key=lambda x: (x["category"] != "_total", -x["percent"]))
    return {"period": period, "items": out}


@router.get("/alerts")
def budget_alerts():
    """Current month over-budget items only (for header / dashboard badges)."""
    now = datetime.now()
    res = budget_status(year=now.year, month=now.month)
    return [it for it in res["items"] if it["status"] in ("warn", "over")]
