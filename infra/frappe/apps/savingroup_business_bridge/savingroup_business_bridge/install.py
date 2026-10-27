"""Site changes the bridge needs: custom fields, the gateway role and its permissions.

Everything here is additive and idempotent, so ``bench migrate`` can run it
again after an upgrade of ERPNext or Frappe CRM.
"""

import frappe
from frappe.custom.doctype.custom_field.custom_field import create_custom_fields

GATEWAY_ROLE = "Savingroup Gateway"

# Roles the gateway user carries. Standard ERPNext and Frappe CRM roles enforce
# document permissions; the bridge role only unlocks the bridge's own doctypes.
GATEWAY_ROLES = [
    GATEWAY_ROLE,
    "Sales User",
    "Sales Manager",
    "Stock User",
    "Stock Manager",
    "Item Manager",
    # Item Price (selling prices) is owned by the master-data roles in ERPNext.
    "Sales Master Manager",
    "Accounts User",
    "Accounts Manager",
]


def _actor_fields(prefix: str, label: str, insert_after: str | None = None) -> list[dict]:
    return [
        {
            "fieldname": f"{prefix}_user",
            "label": f"Savingroup {label} (user)",
            "fieldtype": "Data",
            "read_only": 1,
            "no_copy": 1,
            "allow_on_submit": 1,
            "insert_after": insert_after,
        },
        {
            "fieldname": f"{prefix}_bot",
            "label": f"Savingroup {label} (bot)",
            "fieldtype": "Data",
            "read_only": 1,
            "no_copy": 1,
            "allow_on_submit": 1,
        },
    ]


def _common(doctype_tab: str | None = None) -> list[dict]:
    return [
        {
            "fieldname": "savingroup_section",
            "label": "Savingroup",
            "fieldtype": "Section Break",
            "collapsible": 1,
            "insert_after": doctype_tab,
        },
        {
            "fieldname": "savingroup_operation_id",
            "label": "Savingroup Operation",
            "fieldtype": "Data",
            "read_only": 1,
            "no_copy": 1,
            "allow_on_submit": 1,
        },
        {
            "fieldname": "savingroup_legacy_id",
            "label": "Savingroup Legacy Id",
            "fieldtype": "Data",
            "read_only": 1,
            "no_copy": 1,
            "allow_on_submit": 1,
        },
        *_actor_fields("savingroup_created_by", "created by"),
    ]


def _text(fieldname: str, label: str, fieldtype: str = "Small Text") -> dict:
    return {"fieldname": fieldname, "label": label, "fieldtype": fieldtype, "allow_on_submit": 1}


def _link(fieldname: str, label: str, options: str) -> dict:
    return {
        "fieldname": fieldname,
        "label": label,
        "fieldtype": "Link",
        "options": options,
        "allow_on_submit": 1,
    }


CUSTOM_FIELDS = {
    "CRM Organization": [
        *_common(),
        _text("savingroup_phone", "Savingroup Phone", "Data"),
        _text("savingroup_notes", "Savingroup Notes"),
    ],
    "Contact": [
        *_common(),
        _link("savingroup_organization", "Savingroup Organization", "CRM Organization"),
        _text("savingroup_notes", "Savingroup Notes"),
    ],
    "CRM Lead": [
        *_common(),
        _text("savingroup_title", "Savingroup Title", "Data"),
        {"fieldname": "savingroup_value", "label": "Savingroup Estimated Value", "fieldtype": "Currency"},
        _text("savingroup_notes", "Savingroup Notes"),
        _link("savingroup_contact", "Savingroup Contact", "Contact"),
        _link("savingroup_organization", "Savingroup Organization", "CRM Organization"),
        _link("savingroup_deal", "Savingroup Deal", "CRM Deal"),
        *_actor_fields("savingroup_assignee", "assignee"),
    ],
    "CRM Deal": [
        *_common(),
        _text("savingroup_title", "Savingroup Title", "Data"),
        _text("savingroup_notes", "Savingroup Notes"),
        _text("savingroup_stage_reason", "Savingroup Stage Reason", "Data"),
        *_actor_fields("savingroup_owner", "owner"),
    ],
    "CRM Task": [
        *_common(),
        {
            "fieldname": "savingroup_kind",
            "label": "Savingroup Kind",
            "fieldtype": "Select",
            "options": "\ncall\nemail\nmeeting\nnote\nfollow_up",
        },
        _link("savingroup_contact", "Savingroup Contact", "Contact"),
        _link("savingroup_organization", "Savingroup Organization", "CRM Organization"),
        {"fieldname": "savingroup_completed_at", "label": "Savingroup Completed At", "fieldtype": "Datetime"},
        *_actor_fields("savingroup_assignee", "assignee"),
    ],
    "Item": [*_common()],
    "Customer": [*_common()],
    "Sales Order": [
        *_common(),
        _link("savingroup_deal", "Savingroup Deal", "CRM Deal"),
        _link("savingroup_contact", "Savingroup Contact", "Contact"),
        _text("savingroup_notes", "Savingroup Notes"),
        {
            "fieldname": "savingroup_approval_status",
            "label": "Savingroup Approval",
            "fieldtype": "Select",
            "options": "\ndraft\npending_approval\napproved\ncancelled",
            "allow_on_submit": 1,
        },
        {
            "fieldname": "savingroup_approval_requested_at",
            "label": "Savingroup Approval Requested At",
            "fieldtype": "Datetime",
            "allow_on_submit": 1,
        },
        {
            "fieldname": "savingroup_approved_at",
            "label": "Savingroup Approved At",
            "fieldtype": "Datetime",
            "allow_on_submit": 1,
        },
        {
            "fieldname": "savingroup_confirmed_at",
            "label": "Savingroup Confirmed At",
            "fieldtype": "Datetime",
            "allow_on_submit": 1,
        },
        {
            "fieldname": "savingroup_cancelled_at",
            "label": "Savingroup Cancelled At",
            "fieldtype": "Datetime",
            "allow_on_submit": 1,
        },
        *_actor_fields("savingroup_approved_by", "approved by"),
    ],
    "Sales Invoice": [
        *_common(),
        _text("savingroup_notes", "Savingroup Notes"),
        *_actor_fields("savingroup_approved_by", "approved by"),
    ],
    "Delivery Note": [*_common()],
    "Stock Entry": [*_common(), _text("savingroup_reason", "Savingroup Reason", "Data")],
    "Payment Entry": [*_common(), _text("savingroup_note", "Savingroup Note", "Data")],
}


def ensure_custom_fields():
    # Field order: the first field of each block names the one it follows; the
    # rest chain after each other. Frappe needs insert_after on every field.
    for doctype, fields in CUSTOM_FIELDS.items():
        previous = None
        for field in fields:
            if not field.get("insert_after"):
                field["insert_after"] = previous
            previous = field["fieldname"]
    create_custom_fields(CUSTOM_FIELDS, ignore_validate=True, update=True)


def ensure_roles():
    if not frappe.db.exists("Role", GATEWAY_ROLE):
        frappe.get_doc(
            {"doctype": "Role", "role_name": GATEWAY_ROLE, "desk_access": 1, "is_custom": 1}
        ).insert(ignore_permissions=True)


def after_install():
    from savingroup_business_bridge.workspace import ensure_workspace

    ensure_roles()
    ensure_custom_fields()
    frappe.db.commit()
    ensure_workspace()


def after_migrate():
    from savingroup_business_bridge.workspace import ensure_workspace

    ensure_roles()
    ensure_custom_fields()
    ensure_workspace()
