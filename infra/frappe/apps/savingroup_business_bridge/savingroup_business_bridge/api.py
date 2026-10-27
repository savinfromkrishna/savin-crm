"""Whitelisted surface for the Savingroup gateway.

Everything runs as the authenticated gateway user, so ERPNext and Frappe CRM
permissions apply. ``execute`` is idempotent per ``operation_id``: the first
call does the work and records the outcome in ``Savingroup Operation`` within the
same transaction; later calls with the same id return that outcome.
"""

import json

import frappe
from frappe.utils import cint

from savingroup_business_bridge import __version__
from savingroup_business_bridge.errors import SavingroupBusinessError, throw, translate
from savingroup_business_bridge.handlers import HANDLERS
from savingroup_business_bridge.handlers.admin import is_admin
from savingroup_business_bridge.handlers.queries import QUERIES

PROTOCOL_VERSION = 1
MAX_OPERATION_ID = 140


def _parse(value, name: str) -> dict:
    if value is None or value == "":
        return {}
    if isinstance(value, str):
        try:
            value = json.loads(value)
        except ValueError:
            throw("invalid_input", f"{name} must be JSON.")
    if not isinstance(value, dict):
        throw("invalid_input", f"{name} must be an object.")
    return value


def _app_versions() -> dict:
    versions = {}
    for app in frappe.get_installed_apps():
        try:
            versions[app] = str(frappe.get_attr(f"{app}.__version__"))
        except Exception:
            versions[app] = ""
    return versions


@frappe.whitelist(methods=["POST", "GET"])
def ping():
    return {
        "ok": True,
        "site": frappe.local.site,
        "user": frappe.session.user,
        "apps": _app_versions(),
        "bridge_version": __version__,
        "protocol_version": PROTOCOL_VERSION,
        "companies": frappe.get_all("Company", pluck="name"),
        # True once setup.grant_admin ran: the admin.* actions are then available.
        "admin": is_admin(),
    }


def _load_operation(operation_id: str):
    row = frappe.db.get_value(
        "Savingroup Operation",
        {"operation_id": operation_id},
        ["status", "result", "external_doctype", "external_name", "error_code", "error_message"],
        as_dict=True,
    )
    if not row:
        return {"found": False}
    external = (
        {"doctype": row.external_doctype, "name": row.external_name} if row.external_doctype else None
    )
    if row.status == "Succeeded":
        return {
            "found": True,
            "status": "succeeded",
            "result": json.loads(row.result or "{}"),
            "external": external,
        }
    return {
        "found": True,
        "status": "failed",
        "external": external,
        "error": {"code": row.error_code or "unavailable", "message": row.error_message or ""},
    }


@frappe.whitelist(methods=["POST"])
def get_operation(operation_id):
    operation_id = str(operation_id or "").strip()
    if not operation_id:
        throw("invalid_input", "operation_id is required.")
    return _load_operation(operation_id)


def _record(operation_id, action, version, payload, context, status, result=None, external=None, error=None):
    actor = (context or {}).get("actor") or {}
    doc = frappe.get_doc(
        {
            "doctype": "Savingroup Operation",
            "operation_id": operation_id,
            "action": action,
            "action_version": cint(version) or 1,
            "status": status,
            "external_doctype": (external or {}).get("doctype"),
            "external_name": (external or {}).get("name"),
            "actor_user": actor.get("user_id"),
            "actor_bot": actor.get("bot_id"),
            "run_id": actor.get("run_id"),
            "request": frappe.as_json(payload),
            "result": frappe.as_json(result) if result is not None else None,
            "error_code": (error or {}).get("code"),
            "error_message": (error or {}).get("message"),
        }
    )
    doc.flags.ignore_permissions = True
    doc.insert()


@frappe.whitelist(methods=["POST"])
def execute(operation_id, action, payload=None, context=None, version=1, protocol_version=1):
    if cint(protocol_version) != PROTOCOL_VERSION:
        throw("unavailable", f"Bridge protocol {protocol_version} is not supported.")
    operation_id = str(operation_id or "").strip()
    if not operation_id or len(operation_id) > MAX_OPERATION_ID:
        throw("invalid_input", "operation_id is required.")
    handler = HANDLERS.get(action)
    if handler is None:
        throw("invalid_input", f"Unknown action {action}.")
    payload = _parse(payload, "payload")
    context = frappe._dict(_parse(context, "context"))

    existing = _load_operation(operation_id)
    if existing["found"]:
        if existing["status"] == "succeeded":
            return {
                "status": "succeeded",
                "replayed": True,
                "result": existing["result"],
                "external": existing.get("external"),
            }
        error = existing.get("error") or {}
        raise SavingroupBusinessError(error.get("code") or "conflict", error.get("message") or "")

    try:
        result, external = handler(payload, context, operation_id)
        _record(operation_id, action, version, payload, context, "Succeeded", result=result, external=external)
    except frappe.DuplicateEntryError:
        # Two requests raced on the same operation id; the other one committed.
        frappe.db.rollback()
        replay = _load_operation(operation_id)
        if replay["found"] and replay["status"] == "succeeded":
            return {
                "status": "succeeded",
                "replayed": True,
                "result": replay["result"],
                "external": replay.get("external"),
            }
        raise SavingroupBusinessError("conflict", "The operation is already being processed.")
    except Exception as exc:
        business = translate(exc)
        frappe.db.rollback()
        try:
            _record(
                operation_id,
                action,
                version,
                payload,
                context,
                "Failed",
                error={"code": business.code, "message": business.business_message},
            )
            frappe.db.commit()
        except Exception:
            frappe.db.rollback()
        frappe.clear_messages()
        frappe.msgprint(business.args[0], indicator="red", raise_exception=False)
        raise business

    return {"status": "succeeded", "replayed": False, "result": result, "external": external}


@frappe.whitelist(methods=["POST"])
def query(kind, params=None, company=None):
    runner = QUERIES.get(kind)
    if runner is None:
        throw("invalid_input", f"Unknown query {kind}.")
    try:
        return runner(_parse(params, "params"), company)
    except SavingroupBusinessError:
        raise
    except Exception as exc:
        business = translate(exc)
        frappe.clear_messages()
        frappe.msgprint(business.args[0], indicator="red", raise_exception=False)
        raise business


@frappe.whitelist(methods=["POST"])
def configure_webhook(url, secret, enabled=1):
    url = str(url or "").strip()
    if not url.startswith(("http://", "https://")):
        throw("invalid_input", "url must be an http(s) URL.")
    if not secret or len(str(secret)) < 8:
        throw("invalid_input", "secret is too short.")
    settings = frappe.get_single("Savingroup Bridge Settings")
    settings.webhook_url = url
    settings.webhook_secret = str(secret)
    settings.events_enabled = cint(enabled)
    settings.save()
    frappe.clear_cache(doctype="Savingroup Bridge Settings")
    return {"ok": True, "url": url}
