"""Document (multi-account) management endpoints."""
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from .. import db, docs

router = APIRouter(prefix="/api/documents", tags=["documents"])


class CreateIn(BaseModel):
    name: str = Field(..., min_length=1, max_length=64)


class RenameIn(BaseModel):
    name: str = Field(..., min_length=1, max_length=64)


def _doc_pub(d: dict) -> dict:
    return {
        "id": d["id"],
        "name": d["name"],
        "created_at": d.get("created_at"),
        "opened_at": d.get("opened_at"),
    }


@router.get("")
def list_documents():
    current = docs.current_doc()
    return {
        "current_id": current["id"] if current else None,
        "items": [_doc_pub(d) for d in docs.list_docs()],
    }


@router.post("")
def create_document(payload: CreateIn):
    """Create a new (empty, encrypted) document and switch to it."""
    try:
        d = docs.create_doc(payload.name, make_current=True)
    except ValueError as e:
        raise HTTPException(400, str(e))
    db.reload_for_active_doc()
    return _doc_pub(d)


@router.post("/{doc_id}/open")
def switch_document(doc_id: str):
    try:
        d = docs.switch_doc(doc_id)
    except ValueError as e:
        raise HTTPException(404, str(e))
    db.reload_for_active_doc()
    return _doc_pub(d)


@router.patch("/{doc_id}")
def rename_document(doc_id: str, payload: RenameIn):
    try:
        d = docs.rename_doc(doc_id, payload.name)
    except ValueError as e:
        raise HTTPException(400, str(e))
    return _doc_pub(d)


@router.delete("/{doc_id}")
def delete_document(doc_id: str):
    try:
        docs.delete_doc(doc_id)
    except ValueError as e:
        raise HTTPException(400, str(e))
    # If the deleted one was current, registry already promoted another
    db.reload_for_active_doc()
    return {"deleted": doc_id, "current_id": docs.current_doc()["id"]}
