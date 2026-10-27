"""Site administration for the Operator: any doctype the gateway user may touch.

Everything runs with the gateway user's own permissions (``ignore_permissions``
is never set), so a bot can do exactly what the site's roles grant it and the
grant is a one-time role change on the site. On top of that, a blocklist keeps
identity, credential and code-execution doctypes and methods out of reach
whatever the roles say: the Operator administers the business, not the site's
security boundary.
"""

import json

import frappe
from frappe.utils import cint

from savingroup_business_bridge.errors import throw
from savingroup_business_bridge.handlers.common import as_dict, external, text

ADMIN_ROLE = "System Manager"

# Lower-cased. Identity and permissions, credentials and integrations with
# stored secrets, anything that executes code or changes the schema, and the
# bridge's own records.
BLOCKED_DOCTYPES = frozenset(
    name.lower()
    for name in (
        "User",
        "User Type",
        "Role",
        "Has Role",
        "Role Profile",
        "Module Profile",
        "User Permission",
        "DocPerm",
        "Custom DocPerm",
        "DocShare",
        "DocType",
        "Custom Role",
        "System Settings",
        "Session Default Settings",
        "Domain Settings",
        "Server Script",
        "Client Script",
        "System Console",
        "Scheduled Job Type",
        "Scheduled Job Log",
        "Installed Application",
        "Installed Applications",
        "Data Import",
        "Data Import Legacy",
        "Package",
        "Package Import",
        "Package Release",
        "OAuth Client",
        "OAuth Bearer Token",
        "OAuth Authorization Code",
        "OAuth Provider Settings",
        "Connected App",
        "Token Cache",
        "Social Login Key",
        "LDAP Settings",
        "LDAP Group Mapping",
        "Google Settings",
        "Dropbox Settings",
        "S3 Backup Settings",
        "Email Account",
        "Email Domain",
        "Savingroup Bridge Settings",
        "Savingroup Operation",
    )
)

BLOCKED_METHOD_PREFIXES = (
    "frappe.auth",
    "frappe.sessions",
    "frappe.installer",
    "frappe.utils.password",
    "frappe.integrations.",
    "frappe.www.login",
    "frappe.core.doctype.user.",
    "frappe.core.doctype.user_type",
    "frappe.core.doctype.role",
    "frappe.core.doctype.user_permission",
    "frappe.core.doctype.server_script",
    "frappe.core.doctype.system_settings",
    "frappe.core.doctype.session_default",
    "frappe.core.doctype.data_import",
    "frappe.core.doctype.doctype.",
    "frappe.core.page.permission_manager",
    "frappe.desk.page.setup_wizard",
    "frappe.desk.doctype.system_console",
    "frappe.email.doctype.email_account",
    # Deletion has its own gated action; a method call must not sidestep it.
    "frappe.client.delete",
    "frappe.model.delete_doc",
    "savingroup_business_bridge.",
)

# Layout-only field types a bot never fills in.
LAYOUT_FIELDTYPES = {"Section Break", "Column Break", "Tab Break", "HTML", "Fold", "Heading", "Button"}

# Set by the site, never by a payload.
PROTECTED_VALUE_KEYS = ("doctype", "docstatus", "owner", "creation", "modified", "modified_by", "idx")


def is_admin() -> bool:
    return ADMIN_ROLE in frappe.get_roles()


def _require_admin():
    if not is_admin():
        throw(
            "permission_denied",
            "Site administration needs the gateway user to hold System Manager. Grant it once with "
            "`bench --site <site> execute savingroup_business_bridge.setup.grant_admin --kwargs \"{'email': '<gateway email>'}\"`.",
        )


def _doctype(payload) -> str:
    doctype = text(payload, "doctype")
    if not doctype:
        throw("invalid_input", "doctype is required.")
    if doctype.lower() in BLOCKED_DOCTYPES:
        throw("permission_denied", f"{doctype} is not administrable through Savingroup.")
    if not frappe.db.exists("DocType", doctype):
        throw("not_found", f"DocType {doctype} not found.")
    return doctype


def _name(payload) -> str:
    name = text(payload, "name")
    if not name:
        throw("invalid_input", "name is required.")
    return name


def _values(payload) -> dict:
    values = payload.get("values")
    if not isinstance(values, dict):
        throw("invalid_input", "values must be an object of field values.")
    values = dict(values)
    for key in PROTECTED_VALUE_KEYS:
        values.pop(key, None)
    return values


def _check(doc, ptype: str):
    if not doc.has_permission(ptype):
        throw("permission_denied", f"The gateway user may not {ptype} {doc.doctype} {doc.name}.")


def _load(doctype: str, payload):
    meta = frappe.get_meta(doctype)
    if meta.issingle:
        return frappe.get_doc(doctype)
    name = _name(payload)
    if not frappe.db.exists(doctype, name):
        throw("not_found", f"{doctype} {name} not found.")
    return frappe.get_doc(doctype, name)


def _jsonable(value):
    return json.loads(frappe.as_json(value))


def _result(doc) -> dict:
    return {"doctype": doc.doctype, "name": doc.name, "document": as_dict(doc)}


def _limit(params, fallback=50) -> int:
    try:
        value = int(params.get("limit") or fallback)
    except (TypeError, ValueError):
        value = fallback
    return max(1, min(value, 200))


# --- writes (through ``execute``: idempotent, recorded) -------------------------


def document_insert(p, ctx, operation_id):
    _require_admin()
    doctype = _doctype(p)
    values = _values(p)
    meta = frappe.get_meta(doctype)
    if meta.issingle:
        throw("invalid_state", f"{doctype} is a single document; use admin.document.update.")
    doc = frappe.get_doc({"doctype": doctype, **values})
    if meta.has_field("savingroup_operation_id"):
        doc.savingroup_operation_id = operation_id
    doc.insert()
    if cint(p.get("submit")):
        if not meta.is_submittable:
            throw("invalid_state", f"{doctype} is not submittable.")
        doc.submit()
    return _result(doc), external(doc)


def document_update(p, ctx, operation_id):
    _require_admin()
    doctype = _doctype(p)
    values = _values(p)
    doc = _load(doctype, p)
    _check(doc, "write")
    doc.update(values)
    doc.save()
    return _result(doc), external(doc)


def document_submit(p, ctx, operation_id):
    _require_admin()
    doctype = _doctype(p)
    doc = _load(doctype, p)
    if not doc.meta.is_submittable:
        throw("invalid_state", f"{doctype} is not submittable.")
    if doc.docstatus != 0:
        throw("invalid_state", f"{doctype} {doc.name} is not a draft.")
    _check(doc, "submit")
    doc.submit()
    return _result(doc), external(doc)


def document_cancel(p, ctx, operation_id):
    _require_admin()
    doctype = _doctype(p)
    doc = _load(doctype, p)
    if doc.docstatus != 1:
        throw("invalid_state", f"{doctype} {doc.name} is not submitted.")
    _check(doc, "cancel")
    doc.cancel()
    return _result(doc), external(doc)


def document_delete(p, ctx, operation_id):
    _require_admin()
    doctype = _doctype(p)
    doc = _load(doctype, p)
    if doc.meta.issingle:
        throw("invalid_state", f"{doctype} is a single document and cannot be deleted.")
    _check(doc, "delete")
    frappe.delete_doc(doctype, doc.name)
    return {"doctype": doctype, "name": doc.name, "deleted": True}, {"doctype": doctype, "name": doc.name}


def _check_method(method: str, args: dict):
    lowered = method.lower()
    if any(lowered.startswith(prefix) for prefix in BLOCKED_METHOD_PREFIXES):
        throw("permission_denied", f"{method} is not callable through Savingroup.")
    for candidate in (args.get("doctype"), args.get("dt"), args.get("parenttype")):
        if isinstance(candidate, str) and candidate.lower() in BLOCKED_DOCTYPES:
            throw("permission_denied", f"{candidate} is not administrable through Savingroup.")
    doc = args.get("doc")
    if isinstance(doc, str):
        try:
            doc = json.loads(doc)
        except ValueError:
            doc = None
    if isinstance(doc, dict) and str(doc.get("doctype", "")).lower() in BLOCKED_DOCTYPES:
        throw("permission_denied", f"{doc.get('doctype')} is not administrable through Savingroup.")


def method_call(p, ctx, operation_id):
    _require_admin()
    method = text(p, "method")
    if not method:
        throw("invalid_input", "method is required.")
    args = p.get("args") or {}
    if not isinstance(args, dict):
        throw("invalid_input", "args must be an object of keyword arguments.")
    _check_method(method, args)
    try:
        fn = frappe.get_attr(method)
    except (ImportError, AttributeError, ModuleNotFoundError):
        throw("not_found", f"Method {method} not found.")
    try:
        frappe.is_whitelisted(fn)
    except frappe.PermissionError:
        throw("permission_denied", f"{method} is not whitelisted.")
    result = frappe.call(fn, **args)
    return {"method": method, "result": _jsonable(result)}, None


# --- reads (through ``query``) --------------------------------------------------


def doctypes(params, company=None):
    _require_admin()
    filters = {"istable": 0}
    module = text(params, "module")
    if module:
        filters["module"] = module
    q = text(params, "q")
    if q:
        filters["name"] = ["like", f"%{q}%"]
    limit = _limit(params)
    rows = frappe.get_all(
        "DocType",
        filters=filters,
        fields=["name", "module", "is_submittable", "issingle", "istable", "custom"],
        order_by="name asc",
        limit_page_length=limit * 4,
    )
    out = []
    for row in rows:
        if row.name.lower() in BLOCKED_DOCTYPES or not frappe.has_permission(row.name, "read"):
            continue
        out.append(
            {
                "name": row.name,
                "module": row.module,
                "isSubmittable": bool(row.is_submittable),
                "isSingle": bool(row.issingle),
                "isChild": bool(row.istable),
                "custom": bool(row.custom),
            }
        )
        if len(out) >= limit:
            break
    return out


def doctype(params, company=None):
    _require_admin()
    name = _doctype(params)
    if not frappe.has_permission(name, "read"):
        throw("permission_denied", f"The gateway user may not read {name}.")
    meta = frappe.get_meta(name)
    fields = [
        {
            "fieldname": field.fieldname,
            "label": field.label or None,
            "fieldtype": field.fieldtype,
            "options": field.options or None,
            "required": bool(field.reqd),
            "readOnly": bool(field.read_only),
            "default": None if field.default is None else str(field.default),
        }
        for field in meta.fields
        if field.fieldtype not in LAYOUT_FIELDTYPES
    ]
    permissions = {
        ptype: bool(frappe.has_permission(name, ptype))
        for ptype in ("read", "write", "create", "delete", "submit", "cancel")
    }
    workflow = None
    workflow_name = frappe.db.get_value("Workflow", {"document_type": name, "is_active": 1}, "name")
    if workflow_name:
        wf = frappe.get_doc("Workflow", workflow_name)
        workflow = {
            "name": wf.name,
            "states": [row.state for row in wf.states],
            "transitions": [
                {"state": row.state, "action": row.action, "nextState": row.next_state} for row in wf.transitions
            ],
        }
    return {
        "doctype": name,
        "module": meta.module,
        "isSubmittable": bool(meta.is_submittable),
        "isSingle": bool(meta.issingle),
        "naming": meta.autoname or None,
        "fields": fields,
        "permissions": permissions,
        "workflow": workflow,
    }


def documents(params, company=None):
    _require_admin()
    name = _doctype(params)
    meta = frappe.get_meta(name)
    if meta.issingle:
        doc = frappe.get_doc(name)
        _check(doc, "read")
        return [as_dict(doc)]
    fields = params.get("fields") or ["*"]
    if not isinstance(fields, list) or not all(isinstance(f, str) for f in fields):
        throw("invalid_input", "fields must be a list of field names.")
    filters = params.get("filters")
    if isinstance(filters, list):
        filters = [list(f) for f in filters]
    elif filters is not None and not isinstance(filters, dict):
        throw("invalid_input", "filters must be an object or a list of [field, operator, value].")
    rows = frappe.get_list(
        name,
        filters=filters,
        fields=fields,
        order_by=text(params, "orderBy") or None,
        limit_start=cint(params.get("offset")),
        limit_page_length=_limit(params),
    )
    return _jsonable(rows)


def document(params, company=None):
    _require_admin()
    name = _doctype(params)
    doc = _load(name, params)
    _check(doc, "read")
    return as_dict(doc)
