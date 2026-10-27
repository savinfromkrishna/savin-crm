"""Typed business errors the gateway can map without parsing prose.

The message body is a JSON envelope ``{"code": ..., "message": ...}``. Frappe
puts it into ``_server_messages`` and reports the class name as ``exc_type``;
the TypeScript client reads the envelope first and falls back to the type.
"""

import json

import frappe

CODES = (
    "invalid_input",
    "not_found",
    "permission_denied",
    "conflict",
    "invalid_state",
    "insufficient_stock",
    "unavailable",
)


class SavingroupBusinessError(frappe.ValidationError):
    def __init__(self, code: str, message: str):
        if code not in CODES:
            code = "unavailable"
        self.code = code
        self.business_message = message
        envelope = {"code": code, "message": message}
        # One line, so it survives as the last line of a traceback; and on the
        # response itself, which Frappe keeps alongside its own error fields.
        super().__init__(json.dumps(envelope, separators=(",", ":")))
        try:
            frappe.local.response["_savingroup_error"] = envelope
        except Exception:
            pass


def throw(code: str, message: str):
    raise SavingroupBusinessError(code, message)


def first_message() -> str:
    """The most recent user-facing message Frappe queued, as plain text."""
    for entry in reversed(frappe.local.message_log or []):
        text = entry.get("message") if isinstance(entry, dict) else None
        if text:
            return frappe.utils.strip_html(str(text)).strip()
    return ""


def translate(exc: BaseException) -> SavingroupBusinessError:
    """Map a Frappe/ERPNext exception onto a business error."""
    if isinstance(exc, SavingroupBusinessError):
        return exc
    message = first_message() or str(exc) or exc.__class__.__name__
    name = exc.__class__.__name__
    if name == "NegativeStockError":
        return SavingroupBusinessError("insufficient_stock", message)
    if isinstance(exc, frappe.DoesNotExistError):
        return SavingroupBusinessError("not_found", message)
    if isinstance(exc, frappe.PermissionError):
        return SavingroupBusinessError("permission_denied", message)
    if isinstance(exc, (frappe.DuplicateEntryError, frappe.UniqueValidationError)):
        return SavingroupBusinessError("conflict", message)
    if isinstance(exc, getattr(frappe, "TimestampMismatchError", ())) or isinstance(
        exc, getattr(frappe, "LinkExistsError", ())
    ):
        return SavingroupBusinessError("conflict", message)
    if isinstance(exc, frappe.ValidationError):
        return SavingroupBusinessError("invalid_input", message)
    return SavingroupBusinessError("unavailable", message)
