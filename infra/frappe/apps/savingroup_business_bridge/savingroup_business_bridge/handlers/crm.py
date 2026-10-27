"""CRM actions on Frappe CRM doctypes."""

import frappe

from savingroup_business_bridge.errors import throw
from savingroup_business_bridge.handlers.common import (
    actor_fields,
    as_dict,
    datetime_part,
    date_part,
    external,
    now_str,
    number,
    require,
    text,
)

LEAD_STATUS = {
    "new": "New",
    "contacted": "Contacted",
    "qualified": "Qualified",
    "unqualified": "Unqualified",
    "converted": "Converted",
}
DEAL_STATUS = {
    "qualification": "Qualification",
    "proposal": "Proposal/Quotation",
    "negotiation": "Negotiation",
    "won": "Won",
    "lost": "Lost",
}
CLOSED_DEAL_STATUSES = {"Won", "Lost"}
LOST_LEAD_STATUSES = ("Unqualified", "Junk")


def _status_exists(doctype: str, name: str) -> str:
    """Frappe CRM statuses are Link fields; fall back to the first of the right type."""
    if frappe.db.exists(doctype, name):
        return name
    fallback = frappe.get_all(doctype, pluck="name", limit=1)
    return fallback[0] if fallback else name


# --- companies ---------------------------------------------------------------


def company_create(p, ctx, operation_id):
    name = text(p, "name")
    if not name:
        throw("invalid_input", "name is required.")
    if frappe.db.exists("CRM Organization", name):
        throw("conflict", f"Company {name} already exists.")
    doc = frappe.get_doc(
        {
            "doctype": "CRM Organization",
            "organization_name": name,
            "website": text(p, "domain"),
            "savingroup_phone": text(p, "phone"),
            "savingroup_notes": text(p, "notes"),
            **actor_fields(ctx, operation_id),
        }
    ).insert()
    return {"organization": as_dict(doc)}, external(doc)


def company_update(p, ctx, operation_id):
    doc = require("CRM Organization", text(p, "id"), "Company")
    new_name = text(p, "name")
    if new_name and new_name != doc.name:
        if frappe.db.exists("CRM Organization", new_name):
            throw("conflict", f"Company {new_name} already exists.")
        frappe.rename_doc("CRM Organization", doc.name, new_name, force=True, show_alert=False)
        doc = frappe.get_doc("CRM Organization", new_name)
        doc.organization_name = new_name
    if "domain" in p:
        doc.website = text(p, "domain")
    if "phone" in p:
        doc.savingroup_phone = text(p, "phone")
    if "notes" in p:
        doc.savingroup_notes = text(p, "notes")
    doc.save()
    return {"organization": as_dict(doc)}, external(doc)


# --- contacts ----------------------------------------------------------------


def _set_contact_email(doc, email):
    doc.set("email_ids", [])
    if email:
        doc.append("email_ids", {"email_id": email, "is_primary": 1})


def _set_contact_phone(doc, phone):
    doc.set("phone_nos", [])
    if phone:
        doc.append("phone_nos", {"phone": phone, "is_primary_mobile_no": 1})


def _link_contact_organization(doc, organization):
    doc.set("links", [])
    doc.savingroup_organization = organization
    doc.company_name = organization
    if organization:
        doc.append("links", {"link_doctype": "CRM Organization", "link_name": organization})


def contact_create(p, ctx, operation_id):
    organization = text(p, "companyId")
    if organization:
        require("CRM Organization", organization, "Company")
    doc = frappe.get_doc(
        {
            "doctype": "Contact",
            "first_name": text(p, "firstName"),
            "last_name": text(p, "lastName", ""),
            "designation": text(p, "title"),
            "savingroup_notes": text(p, "notes"),
            **actor_fields(ctx, operation_id),
        }
    )
    email = text(p, "email")
    _set_contact_email(doc, email.lower() if email else None)
    _set_contact_phone(doc, text(p, "phone"))
    _link_contact_organization(doc, organization)
    doc.insert()
    return {"contact": as_dict(doc)}, external(doc)


def contact_update(p, ctx, operation_id):
    doc = require("Contact", text(p, "id"))
    if text(p, "firstName"):
        doc.first_name = text(p, "firstName")
    if "lastName" in p and p.get("lastName") is not None:
        doc.last_name = str(p.get("lastName")).strip()
    if "title" in p:
        doc.designation = text(p, "title")
    if "notes" in p:
        doc.savingroup_notes = text(p, "notes")
    if "email" in p:
        email = text(p, "email")
        _set_contact_email(doc, email.lower() if email else None)
    if "phone" in p:
        _set_contact_phone(doc, text(p, "phone"))
    if "companyId" in p:
        organization = text(p, "companyId")
        if organization:
            require("CRM Organization", organization, "Company")
        _link_contact_organization(doc, organization)
    doc.save()
    return {"contact": as_dict(doc)}, external(doc)


# --- leads -------------------------------------------------------------------


def _ensure_lead_source(source):
    if not source:
        return None
    if frappe.db.exists("CRM Lead Source", source):
        return source
    try:
        frappe.get_doc({"doctype": "CRM Lead Source", "source_name": source}).insert()
        return source
    except Exception:
        frappe.clear_messages()
        return None


def lead_create(p, ctx, operation_id):
    title = text(p, "title")
    if not title:
        throw("invalid_input", "title is required.")
    organization = text(p, "companyId")
    if organization:
        require("CRM Organization", organization, "Company")
    contact = require("Contact", text(p, "contactId")) if text(p, "contactId") else None
    email = (contact.email_id or "").lower() if contact else None
    if email:
        existing = frappe.get_all(
            "CRM Lead",
            filters={"email": email, "converted": 0, "status": ["not in", list(LOST_LEAD_STATUSES)]},
            pluck="name",
            limit=1,
        )
        if existing:
            doc = frappe.get_doc("CRM Lead", existing[0])
            return {"lead": as_dict(doc), "duplicate": True}, external(doc)
    doc = frappe.get_doc(
        {
            "doctype": "CRM Lead",
            "first_name": (contact.first_name if contact else None) or title,
            "last_name": (contact.last_name if contact else None) or "",
            "email": email,
            "mobile_no": (contact.mobile_no if contact else None) or None,
            "status": _status_exists("CRM Lead Status", "New"),
            "organization": organization,
            "source": _ensure_lead_source(text(p, "source")),
            "savingroup_title": title,
            "savingroup_value": number(p, "value"),
            "savingroup_notes": text(p, "notes"),
            "savingroup_contact": contact.name if contact else None,
            "savingroup_organization": organization,
            "savingroup_assignee_user": text(p, "assigneeUserId"),
            "savingroup_assignee_bot": text(p, "assigneeBotId"),
            **actor_fields(ctx, operation_id),
        }
    )
    doc.flags.ignore_email_validation = True
    doc.insert()
    return {"lead": as_dict(doc), "duplicate": False}, external(doc)


def _lead(p):
    return require("CRM Lead", text(p, "id") or text(p, "ref"), "Lead")


def lead_assign(p, ctx, operation_id):
    doc = _lead(p)
    doc.savingroup_assignee_user = text(p, "assigneeUserId")
    doc.savingroup_assignee_bot = text(p, "assigneeBotId")
    doc.save()
    return {"lead": as_dict(doc)}, external(doc)


def lead_qualify(p, ctx, operation_id):
    doc = _lead(p)
    if doc.converted:
        throw("invalid_state", "A converted lead cannot change status.")
    status = LEAD_STATUS.get(text(p, "status") or "")
    if not status or status in ("New", "Converted"):
        throw("invalid_input", "status must be contacted, qualified or unqualified.")
    doc.status = _status_exists("CRM Lead Status", status)
    if "notes" in p:
        doc.savingroup_notes = text(p, "notes")
    if number(p, "value") is not None:
        doc.savingroup_value = number(p, "value")
    doc.save()
    return {"lead": as_dict(doc)}, external(doc)


def lead_convert(p, ctx, operation_id):
    from crm.fcrm.doctype.crm_lead.crm_lead import convert_to_deal

    lead = _lead(p)
    if lead.converted:
        throw("invalid_state", "The lead is already converted.")
    if lead.status != "Qualified":
        throw("invalid_state", "Qualify the lead before converting it.")
    amount = number(p, "amount")
    if amount is None:
        amount = lead.savingroup_value or 0
    deal_values = {
        "deal_value": amount,
        "savingroup_title": text(p, "title") or lead.savingroup_title or lead.lead_name,
        "savingroup_notes": lead.savingroup_notes,
        "savingroup_owner_user": lead.savingroup_assignee_user,
        "savingroup_owner_bot": lead.savingroup_assignee_bot,
        **actor_fields(ctx, operation_id),
    }
    deal_name = convert_to_deal(lead.name, deal=deal_values, if_converted="Fail")
    deal = frappe.get_doc("CRM Deal", deal_name)
    changed = False
    for key, value in deal_values.items():
        if deal.get(key) in (None, "", 0) and value not in (None, ""):
            deal.set(key, value)
            changed = True
    if changed:
        deal.save()
    frappe.db.set_value(
        "CRM Lead",
        lead.name,
        {
            "status": _status_exists("CRM Lead Status", "Converted"),
            "converted": 1,
            "savingroup_deal": deal.name,
        },
    )
    lead = frappe.get_doc("CRM Lead", lead.name)
    return {"lead": as_dict(lead), "deal": as_dict(deal)}, external(deal)


# --- deals -------------------------------------------------------------------


def _deal(p):
    return require("CRM Deal", text(p, "id") or text(p, "ref"), "Deal")


def _deal_status(stage: str) -> str:
    status = DEAL_STATUS.get(stage or "")
    if not status:
        throw("invalid_input", "Unknown deal stage.")
    return _status_exists("CRM Deal Status", status)


def deal_create(p, ctx, operation_id):
    title = text(p, "title")
    if not title:
        throw("invalid_input", "title is required.")
    organization = text(p, "companyId")
    if organization:
        require("CRM Organization", organization, "Company")
    contact = text(p, "contactId")
    if contact:
        require("Contact", contact)
    doc = frappe.get_doc(
        {
            "doctype": "CRM Deal",
            "organization": organization,
            "status": _deal_status(text(p, "stage") or "qualification"),
            "deal_value": number(p, "amount") or 0,
            "expected_closure_date": date_part(p.get("expectedCloseAt")),
            "savingroup_title": title,
            "savingroup_notes": text(p, "notes"),
            "savingroup_owner_user": text(p, "ownerUserId"),
            "savingroup_owner_bot": text(p, "ownerBotId"),
            **actor_fields(ctx, operation_id),
        }
    )
    if contact:
        doc.append("contacts", {"contact": contact, "is_primary": 1})
    doc.insert()
    return {"deal": as_dict(doc)}, external(doc)


def deal_update(p, ctx, operation_id):
    doc = _deal(p)
    if text(p, "title"):
        doc.savingroup_title = text(p, "title")
    if number(p, "amount") is not None:
        doc.deal_value = number(p, "amount")
    if "expectedCloseAt" in p:
        doc.expected_closure_date = date_part(p.get("expectedCloseAt"))
    if "notes" in p:
        doc.savingroup_notes = text(p, "notes")
    if "companyId" in p:
        organization = text(p, "companyId")
        if organization:
            require("CRM Organization", organization, "Company")
        doc.organization = organization
    if "contactId" in p:
        contact = text(p, "contactId")
        doc.set("contacts", [])
        if contact:
            require("Contact", contact)
            doc.append("contacts", {"contact": contact, "is_primary": 1})
    if "ownerUserId" in p:
        doc.savingroup_owner_user = text(p, "ownerUserId")
    if "ownerBotId" in p:
        doc.savingroup_owner_bot = text(p, "ownerBotId")
    doc.save()
    return {"deal": as_dict(doc)}, external(doc)


def deal_update_stage(p, ctx, operation_id):
    doc = _deal(p)
    if doc.status in CLOSED_DEAL_STATUSES:
        throw("invalid_state", "A closed deal cannot change stage.")
    doc.status = _deal_status(text(p, "stage"))
    reason = text(p, "reason")
    if reason:
        doc.savingroup_stage_reason = reason
    if doc.status == "Lost":
        if frappe.db.exists("CRM Lost Reason", "Other"):
            doc.lost_reason = "Other"
        doc.lost_notes = reason or "Marked lost from Savingroup"
    doc.save()
    return {"deal": as_dict(doc)}, external(doc)


# --- activities (CRM Task) ---------------------------------------------------


def activity_create(p, ctx, operation_id):
    subject = text(p, "subject")
    if not subject:
        throw("invalid_input", "subject is required.")
    reference_doctype = None
    reference_name = None
    if text(p, "leadId"):
        reference_doctype, reference_name = "CRM Lead", require("CRM Lead", text(p, "leadId"), "Lead").name
    elif text(p, "dealId"):
        reference_doctype, reference_name = "CRM Deal", require("CRM Deal", text(p, "dealId"), "Deal").name
    contact = text(p, "contactId")
    if contact:
        require("Contact", contact)
    organization = text(p, "companyId")
    if organization:
        require("CRM Organization", organization, "Company")
    if not (reference_name or contact or organization):
        throw("invalid_input", "Link the activity to a company, contact, lead, or deal.")
    completed = bool(p.get("completed"))
    doc = frappe.get_doc(
        {
            "doctype": "CRM Task",
            "title": subject,
            "description": text(p, "body"),
            "status": "Done" if completed else "Todo",
            "due_date": datetime_part(p.get("dueAt")),
            "reference_doctype": reference_doctype,
            "reference_docname": reference_name,
            "savingroup_kind": text(p, "kind") or "note",
            "savingroup_contact": contact,
            "savingroup_organization": organization,
            "savingroup_completed_at": now_str() if completed else None,
            "savingroup_assignee_user": text(p, "assigneeUserId"),
            "savingroup_assignee_bot": text(p, "assigneeBotId"),
            **actor_fields(ctx, operation_id),
        }
    ).insert()
    return {"task": as_dict(doc)}, external(doc)
