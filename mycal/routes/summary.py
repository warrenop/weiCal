from fastapi import APIRouter
from datetime import date
from ..db import get_conn
from ..categorizer import CATEGORY_COLORS

router = APIRouter(prefix="/api/summary", tags=["summary"])


def _prev_period(year: int, month: int) -> str:
    if month == 1:
        return f"{year - 1:04d}-12"
    return f"{year:04d}-{month - 1:02d}"


@router.get("")
def overview(year: int, month: int):
    period = f"{year:04d}-{month:02d}"
    prev = _prev_period(year, month)
    with get_conn() as conn:
        def agg(p):
            r = conn.execute(
                """SELECT
                       COALESCE(SUM(CASE WHEN direction='expense' THEN amount END),0) AS expense,
                       COALESCE(SUM(CASE WHEN direction='income'  THEN amount END),0) AS income,
                       COUNT(*) AS n
                   FROM transactions WHERE period = ?""",
                (p,),
            ).fetchone()
            return {"expense": r["expense"], "income": r["income"], "count": r["n"]}

        cur = agg(period)
        prv = agg(prev)
    cur["net"] = cur["income"] - cur["expense"]
    cur["period"] = period
    cur["prev_expense"] = prv["expense"]
    cur["expense_change"] = (
        (cur["expense"] - prv["expense"]) / prv["expense"] if prv["expense"] else None
    )
    return cur


@router.get("/categories")
def categories(year: int, month: int):
    period = f"{year:04d}-{month:02d}"
    with get_conn() as conn:
        rows = conn.execute(
            """SELECT category, SUM(amount) AS amount, COUNT(*) AS n
               FROM transactions
               WHERE period = ? AND direction = 'expense'
               GROUP BY category
               ORDER BY amount DESC""",
            (period,),
        ).fetchall()
    total = sum(r["amount"] for r in rows) or 1
    return [
        {
            "category": r["category"],
            "amount": r["amount"],
            "count": r["n"],
            "percent": round(r["amount"] / total * 100, 2),
            "color": CATEGORY_COLORS.get(r["category"], "#999"),
        }
        for r in rows
    ]


@router.get("/daily")
def daily(year: int, month: int):
    period = f"{year:04d}-{month:02d}"
    with get_conn() as conn:
        rows = conn.execute(
            """SELECT substr(tx_time,1,10) AS d,
                      COALESCE(SUM(CASE WHEN direction='expense' THEN amount END),0) AS expense,
                      COALESCE(SUM(CASE WHEN direction='income'  THEN amount END),0) AS income
               FROM transactions
               WHERE period = ?
               GROUP BY d
               ORDER BY d""",
            (period,),
        ).fetchall()
    return [{"date": r["d"], "expense": r["expense"], "income": r["income"]} for r in rows]


@router.get("/top")
def top_counterparties(year: int, month: int, limit: int = 5):
    period = f"{year:04d}-{month:02d}"
    with get_conn() as conn:
        rows = conn.execute(
            """SELECT COALESCE(NULLIF(counterparty,''),'(未知)') AS name,
                      SUM(amount) AS amount, COUNT(*) AS n
               FROM transactions
               WHERE period = ? AND direction = 'expense'
               GROUP BY name
               ORDER BY amount DESC
               LIMIT ?""",
            (period, limit),
        ).fetchall()
    return [{"name": r["name"], "amount": r["amount"], "count": r["n"]} for r in rows]


@router.get("/periods")
def available_periods():
    with get_conn() as conn:
        rows = conn.execute(
            "SELECT DISTINCT period FROM transactions ORDER BY period DESC"
        ).fetchall()
    return [r["period"] for r in rows]


@router.get("/cashflow")
def yearly_cashflow(year: int):
    """12 rows (Jan~Dec) of {income, expense, count_*} for the requested year.
    Months with no transactions are filled with zeros so the chart axis is stable."""
    with get_conn() as conn:
        rows = conn.execute(
            """SELECT period,
                      COALESCE(SUM(CASE WHEN direction='income'  THEN amount END), 0) AS income,
                      COALESCE(SUM(CASE WHEN direction='expense' THEN amount END), 0) AS expense,
                      COALESCE(SUM(CASE WHEN direction='income'  THEN 1 END), 0)      AS income_count,
                      COALESCE(SUM(CASE WHEN direction='expense' THEN 1 END), 0)      AS expense_count
               FROM transactions
               WHERE substr(period,1,4) = ?
               GROUP BY period""",
            (f"{year:04d}",),
        ).fetchall()
    by_period = {r["period"]: r for r in rows}
    out = []
    for m in range(1, 13):
        p = f"{year:04d}-{m:02d}"
        r = by_period.get(p)
        out.append({
            "period": p,
            "month": m,
            "income": (r["income"] if r else 0),
            "expense": (r["expense"] if r else 0),
            "net": ((r["income"] - r["expense"]) if r else 0),
            "income_count": (r["income_count"] if r else 0),
            "expense_count": (r["expense_count"] if r else 0),
        })
    return out


@router.get("/income/sources")
def income_sources(year: int, month: int | None = None, limit: int = 20):
    """Top income counterparties for a year (or a specific month within it)."""
    if month is not None:
        where, args = "period = ?", (f"{year:04d}-{month:02d}",)
    else:
        where, args = "substr(period,1,4) = ?", (f"{year:04d}",)
    with get_conn() as conn:
        rows = conn.execute(
            f"""SELECT COALESCE(NULLIF(counterparty,''),'(未知)') AS name,
                       SUM(amount) AS amount, COUNT(*) AS count
                FROM transactions
                WHERE {where} AND direction='income'
                GROUP BY name
                ORDER BY amount DESC
                LIMIT ?""",
            (*args, limit),
        ).fetchall()
    total = sum(r["amount"] for r in rows) or 1
    return [
        {"name": r["name"], "amount": r["amount"], "count": r["count"],
         "percent": round(r["amount"] / total * 100, 2)}
        for r in rows
    ]
