from typing import Optional, Literal
from pydantic import BaseModel, Field

Direction = Literal["expense", "income", "neutral"]


class TransactionIn(BaseModel):
    tx_time: str = Field(..., description="ISO8601 e.g. 2026-05-26 14:30:00")
    tx_type: Optional[str] = None
    counterparty: Optional[str] = None
    product: Optional[str] = None
    amount: float
    direction: Direction = "expense"
    pay_method: Optional[str] = None
    status: Optional[str] = "支付成功"
    category: Optional[str] = None
    notes: Optional[str] = None


class TransactionPatch(BaseModel):
    tx_time: Optional[str] = None
    counterparty: Optional[str] = None
    product: Optional[str] = None
    amount: Optional[float] = None
    direction: Optional[Direction] = None
    category: Optional[str] = None
    notes: Optional[str] = None


class TransactionOut(BaseModel):
    id: int
    tx_time: str
    tx_type: Optional[str]
    counterparty: Optional[str]
    product: Optional[str]
    amount: float
    direction: str
    pay_method: Optional[str]
    status: Optional[str]
    wx_tx_id: Optional[str]
    category: str
    source: str
    notes: Optional[str]
    period: str
