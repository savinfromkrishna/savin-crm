"""Shared helpers for action handlers."""

import frappe
from frappe.utils import now_datetime

from savingroup_business_bridge.errors import throw


def actor_fields(context, operation_id: str, prefix: str = "savingroup_created_by") -> dict:
    actor = context.get("actor") or {}
    return {
        f"{prefix}_user": actor.get("user_id") or None,
        f"{prefix}_bot": actor.get("bot_id") or None,
        "savingroup_operation_id": operation_id,
    }


def stamp_fields(context, prefix: str) -> dict:
    actor = context.get("actor") or {}
    return {f"{prefix}_user": actor.get("user_id") or None, f"{prefix}_bot": actor.get("bot_id") or None}


def is_bot(context) -> bool:
    return bool((context.get("actor") or {}).get("bot_id"))


def policy(context, key: str, default=False) -> bool:
    return bool((context.get("policy") or {}).get(key, default))


def default(context, key: str, fallback: str) -> str:
    return (context.get("defaults") or {}).get(key) or fallback


def require(doctype: str, name, label: str | None = None):
    name = str(name or "").strip()
    if not name or not frappe.db.exists(doctype, name):
        throw("not_found", f"{label or doctype} {name or ''} not found.".replace("  ", " "))
    return frappe.get_doc(doctype, name)


def as_dict(doc) -> dict:
    return doc.as_dict(convert_dates_to_str=True, no_private_properties=True)


def external(doc) -> dict:
    return {"doctype": doc.doctype, "name": doc.name}


def now_str() -> str:
    return now_datetime().strftime("%Y-%m-%d %H:%M:%S.%f")


def text(payload, key: str, default=None):
    value = payload.get(key)
    if value is None:
        return default
    value = str(value).strip()
    return value if value else default


def number(payload, key: str, default=None):
    value = payload.get(key)
    if value is None or value == "":
        return default
    try:
        return float(value)
    except (TypeError, ValueError):
        throw("invalid_input", f"{key} must be a number.")


def date_part(value):
    """ISO datetime or date string → YYYY-MM-DD (or None)."""
    if not value:
        return None
    return str(value)[:10]


def datetime_part(value):
    """ISO datetime → naive 'YYYY-MM-DD HH:MM:SS' in UTC (or None)."""
    if not value:
        return None
    text_value = str(value).replace("T", " ").replace("Z", "")
    if "+" in text_value[10:]:
        text_value = text_value[: text_value.index("+", 10)]
    return text_value[:19]
