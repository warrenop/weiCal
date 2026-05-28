"""Budget configuration + status (monthly, per category).

The pseudo-category `_total` represents the overall monthly budget.

Two layers:
- `budgets` table holds the **default** amount per category (applies to every month).
- `budget_overrides` table holds **per-month** overrides that take precedence
  for that specific (category, period).

PUT/DELETE accept an optional `?period=YYYY-MM` query param:
  - omitted → operate on the default
  - present → operate on the per-month override
"""
from datetime import datetime
from typing import Optional

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel, Field

from ..categorizer import ALL_CATEGORIES, CATEGORY_COLORS
from ..db import get_conn

router = APIRouter(prefix="/api/budgets", tags=["budgets"])

WARN_PCT = 70.0
OVER_PCT = 100.0


class BudgetIn(BaseModel):
    amount: float = Field(..., ge=0, le=1_000_000)


def _expense_category_keys() -> list[str]:
    return [c for c in ALL_CATEGORIES if c != "收入"]


def _classify(percent: float) -> str:
    if percent >= OVER_PCT:
        return "over"
    if percent >= WARN_PCT:
        return "warn"
    return "ok"


def _validate_category(cat: str) -> None:
    if not cat:
        raise HTTPException(400, "分类不能为空")
    if cat != "_total" and cat not in _expense_category_keys():
        raise HTTPException(400, f"未知分类: {cat}")


def _validate_period(period: str) -> None:
    try:
        y, m = period.split("-")
        if not (1 <= int(m) <= 12) or len(y) != 4:
            raise ValueError
    except Exception:
        raise HTTPException(400, "period 格式必须是 YYYY-MM")


@router.get("")
def list_budgets():
    """All default budgets."""
    with get_conn() as conn:
        rows = conn.execute(
            "SELECT category, amount FROM budgets ORDER BY category"
        ).fetchall()
    return [{"category": r["category"], "amount": r["amount"]} for r in rows]


@router.get("/overrides")
def list_overrides(period: Optional[str] = None):
    """All overrides, optionally filtered by period."""
    with get_conn() as conn:
        if period:
            _validate_period(period)
            rows = conn.execute(
                "SELECT category, period, amount FROM budget_overrides WHERE period = ?",
                (period,),
            ).fetchall()
        else:
            rows = conn.execute(
                "SELECT category, period, amount FROM budget_overrides ORDER BY period DESC, category"
            ).fetchall()
    return [dict(r) for r in rows]


@router.put("/{category}")
def upsert_budget(
    category: str,
    payload: BudgetIn,
    period: Optional[str] = Query(None, description="设为 YYYY-MM 则创建/更新本月覆盖；省略则更新默认值"),
):
    category = category.strip()
    _validate_category(category)
    with get_conn() as conn:
        if period:
            _validate_period(period)
            conn.execute(
                """INSERT INTO budget_overrides (category, period, amount) VALUES (?, ?, ?)
                   ON CONFLICT(category, period) DO UPDATE SET
                     amount = excluded.amount,
                     updated_at = datetime('now','localtime')""",
                (category, period, payload.amount),
            )
        else:
            conn.execute(
                """INSERT INTO budgets (category, amount) VALUES (?, ?)
                   ON CONFLICT(category) DO UPDATE SET
                     amount = excluded.amount,
                     updated_at = datetime('now','localtime')""",
                (category, payload.amount),
            )
    return {"category": category, "amount": payload.amount,
            "scope": "override" if period else "default",
            "period": period}


@router.delete("/{category}")
def delete_budget(
    category: str,
    period: Optional[str] = Query(None, description="设为 YYYY-MM 则只删除本月覆盖；省略则删除默认值"),
):
    """Delete the default budget, or just the override for a specific month."""
    with get_conn() as conn:
        if period:
            _validate_period(period)
            cur = conn.execute(
                "DELETE FROM budget_overrides WHERE category = ? AND period = ?",
                (category, period),
            )
            if cur.rowcount == 0:
                raise HTTPException(404, "本月无覆盖")
        else:
            cur = conn.execute("DELETE FROM budgets WHERE category = ?", (category,))
            if cur.rowcount == 0:
                raise HTTPException(404, "未配置该分类预算")
    return {"deleted": category, "scope": "override" if period else "default"}


@router.get("/status")
def budget_status(year: Optional[int] = None, month: Optional[int] = None):
    """Per-category spending vs effective budget for a given month.

    Effective budget = override (if any) else default. Returns:
      - `amount`         — the effective amount used for percentage math
      - `default_amount` — the underlying default (may differ from amount when overridden)
      - `is_override`    — true if an override is in effect for this period
    """
    now = datetime.now()
    year = year or now.year
    month = month or now.month
    period = f"{year:04d}-{month:02d}"

    with get_conn() as conn:
        defaults = {r["category"]: r["amount"] for r in
                    conn.execute("SELECT category, amount FROM budgets").fetchall()}
        overrides = {r["category"]: r["amount"] for r in
                     conn.execute(
                         "SELECT category, amount FROM budget_overrides WHERE period = ?",
                         (period,),
                     ).fetchall()}
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

    # Categories to surface: union of defaults + overrides for this month
    cats = set(defaults.keys()) | set(overrides.keys())
    out = []
    for cat in cats:
        default_amt = defaults.get(cat)
        override_amt = overrides.get(cat)
        effective = override_amt if override_amt is not None else default_amt
        if effective is None:
            continue
        used = total_spent if cat == "_total" else (spent.get(cat) or 0.0)
        percent = round(used / effective * 100, 1) if effective > 0 else 0.0
        out.append({
            "category": cat,
            "budget": effective,
            "default_amount": default_amt,
            "is_override": override_amt is not None,
            "spent": round(used, 2),
            "remaining": round(effective - used, 2),
            "percent": percent,
            "status": _classify(percent),
            "color": CATEGORY_COLORS.get(cat),
        })
    out.sort(key=lambda x: (x["category"] != "_total", -x["percent"]))
    return {"period": period, "items": out}


@router.get("/alerts")
def budget_alerts():
    """Current month over/warn items (Overview KPI badge)."""
    now = datetime.now()
    res = budget_status(year=now.year, month=now.month)
    return [it for it in res["items"] if it["status"] in ("warn", "over")]
