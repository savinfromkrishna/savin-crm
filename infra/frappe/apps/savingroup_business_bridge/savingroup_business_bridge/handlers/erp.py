"""ERP actions on ERPNext doctypes.

Documents follow ERPNext's own lifecycle: orders are drafts until submitted,
confirming an order submits it and delivers it (stock moves through a Delivery
Note), invoices post to the ledger on submit, payments are Payment Entries.
Savingroup's approval state lives in custom fields on the draft order.
"""

import frappe
from frappe.utils import add_days, flt, nowdate

from savingroup_business_bridge.errors import throw
from savingroup_business_bridge.handlers.common import (
    actor_fields,
    as_dict,
    date_part,
    default,
    external,
    is_bot,
    now_str,
    number,
    policy,
    require,
    stamp_fields,
    text,
)
from savingroup_business_bridge.handlers.queries import order_dict, product_row

DELIVERY_LEAD_DAYS = 7
INVOICE_DUE_DAYS = 30


# --- masters -----------------------------------------------------------------


def _company(ctx) -> str:
    company = ctx.get("company")
    if not company or not frappe.db.exists("Company", company):
        throw("unavailable", f"Company {company or ''} does not exist on this site.")
    return company


def _warehouse(ctx, company: str) -> str:
    abbr = ctx.get("company_abbr") or frappe.db.get_value("Company", company, "abbr")
    preferred = f"{default(ctx, 'warehouse', 'Stores')} - {abbr}"
    if frappe.db.exists("Warehouse", preferred):
        return preferred
    fallback = frappe.get_all(
        "Warehouse", filters={"company": company, "is_group": 0}, pluck="name", order_by="creation asc", limit=1
    )
    if not fallback:
        throw("unavailable", f"Company {company} has no warehouse.")
    return fallback[0]


def _item_group(ctx) -> str:
    preferred = default(ctx, "item_group", "Products")
    if frappe.db.exists("Item Group", preferred):
        return preferred
    return "All Item Groups"


def _price_list(ctx) -> str:
    preferred = default(ctx, "price_list", "Standard Selling")
    if frappe.db.exists("Price List", preferred):
        return preferred
    fallback = frappe.get_all("Price List", filters={"selling": 1, "enabled": 1}, pluck="name", limit=1)
    return fallback[0] if fallback else preferred


def _customer_group(ctx) -> str:
    preferred = default(ctx, "customer_group", "Commercial")
    return preferred if frappe.db.exists("Customer Group", preferred) else "All Customer Groups"


def _territory(ctx) -> str:
    preferred = default(ctx, "territory", "All Territories")
    return preferred if frappe.db.exists("Territory", preferred) else "All Territories"


def _ensure_customer(ctx, organization: str, operation_id: str) -> str:
    """One ERPNext Customer per CRM Organization, named alike."""
    existing = frappe.db.get_value("Customer", {"customer_name": organization}, "name")
    if existing:
        return existing
    customer = frappe.get_doc(
        {
            "doctype": "Customer",
            "customer_name": organization,
            "customer_type": "Company",
            "customer_group": _customer_group(ctx),
            "territory": _territory(ctx),
            **actor_fields(ctx, operation_id),
        }
    ).insert()
    return customer.name


def _set_hsn(item, code):
    """HSN/SAC lives in India Compliance's custom field; ignore it on sites without GST."""
    if not frappe.get_meta("Item").has_field("gst_hsn_code"):
        return
    if code is None:
        return
    if code and not frappe.db.exists("GST HSN Code", code):
        throw("invalid_input", f"HSN/SAC code {code} is not in the site's GST HSN Code list.")
    item.gst_hsn_code = code or None


def _item(code: str):
    code = str(code or "").strip().upper()
    if not code or not frappe.db.exists("Item", code):
        throw("not_found", f"Product {code} not found.")
    return frappe.get_doc("Item", code)


def _selling_rate(ctx, item_code: str, fallback: float) -> float:
    rate = frappe.db.get_value(
        "Item Price", {"item_code": item_code, "price_list": _price_list(ctx), "selling": 1}, "price_list_rate"
    )
    return flt(rate) if rate is not None else flt(fallback)


def _set_item_price(ctx, item_code: str, rate: float):
    price_list = _price_list(ctx)
    name = frappe.db.get_value("Item Price", {"item_code": item_code, "price_list": price_list, "selling": 1}, "name")
    if name:
        frappe.db.set_value("Item Price", name, "price_list_rate", rate)
        return
    frappe.get_doc(
        {
            "doctype": "Item Price",
            "item_code": item_code,
            "price_list": price_list,
            "price_list_rate": rate,
            "selling": 1,
        }
    ).insert()


def _stock(item_code: str) -> tuple[float, float]:
    row = frappe.db.sql(
        "select coalesce(sum(actual_qty), 0), coalesce(sum(reserved_qty), 0) from `tabBin` where item_code = %s",
        (item_code,),
    )
    actual, reserved = (row[0] if row else (0, 0))
    return flt(actual), flt(reserved)


# --- products and stock ------------------------------------------------------


def product_create(p, ctx, operation_id):
    company = _company(ctx)
    sku = (text(p, "sku") or "").upper()
    name = text(p, "name")
    if not sku or not name:
        throw("invalid_input", "sku and name are required.")
    if frappe.db.exists("Item", sku):
        throw("conflict", f"Product {sku} already exists.")
    price = flt(number(p, "unitPrice") or 0)
    opening = int(number(p, "initialStock") or 0)
    item = frappe.get_doc(
        {
            "doctype": "Item",
            "item_code": sku,
            "item_name": name,
            "description": text(p, "description") or name,
            "item_group": _item_group(ctx),
            "stock_uom": default(ctx, "uom", "Nos"),
            "is_stock_item": 1,
            "include_item_in_manufacturing": 0,
            "standard_rate": price,
            "valuation_rate": price,
            "opening_stock": opening,
            "item_defaults": [{"company": company, "default_warehouse": _warehouse(ctx, company)}],
            **actor_fields(ctx, operation_id),
        }
    )
    _set_hsn(item, text(p, "hsnCode"))
    item.insert()
    _set_item_price(ctx, item.name, price)
    return {"product": product_row(ctx, item.name)}, external(item)


def product_update(p, ctx, operation_id):
    item = _item(text(p, "id") or text(p, "sku"))
    if text(p, "name"):
        item.item_name = text(p, "name")
    if "description" in p:
        item.description = text(p, "description") or item.item_name
    if "active" in p and p.get("active") is not None:
        item.disabled = 0 if p.get("active") else 1
    price = number(p, "unitPrice")
    if price is not None:
        item.standard_rate = flt(price)
    if "hsnCode" in p:
        _set_hsn(item, text(p, "hsnCode"))
    item.save()
    if price is not None:
        _set_item_price(ctx, item.name, flt(price))
    return {"product": product_row(ctx, item.name)}, external(item)


def inventory_adjust(p, ctx, operation_id):
    company = _company(ctx)
    item = _item(text(p, "productId") or text(p, "sku"))
    delta = int(number(p, "delta") or 0)
    if delta == 0:
        throw("invalid_input", "delta must not be zero.")
    reason = text(p, "reason")
    if not reason:
        throw("invalid_input", "reason is required.")
    actual, _reserved = _stock(item.name)
    if delta < 0 and actual + delta < 0 and not policy(ctx, "allow_negative_stock"):
        throw(
            "insufficient_stock",
            f"Only {int(actual)} of {item.name} on hand; cannot remove {abs(delta)}.",
        )
    warehouse = _warehouse(ctx, company)
    entry = frappe.get_doc(
        {
            "doctype": "Stock Entry",
            "company": company,
            "stock_entry_type": "Material Receipt" if delta > 0 else "Material Issue",
            "purpose": "Material Receipt" if delta > 0 else "Material Issue",
            "to_warehouse": warehouse if delta > 0 else None,
            "from_warehouse": warehouse if delta < 0 else None,
            "items": [
                {
                    "item_code": item.name,
                    "qty": abs(delta),
                    "uom": item.stock_uom,
                    "stock_uom": item.stock_uom,
                    "conversion_factor": 1,
                    "basic_rate": flt(item.valuation_rate) or flt(item.standard_rate) or 0,
                    "allow_zero_valuation_rate": 1 if not (item.valuation_rate or item.standard_rate) else 0,
                    "t_warehouse": warehouse if delta > 0 else None,
                    "s_warehouse": warehouse if delta < 0 else None,
                }
            ],
            "savingroup_reason": reason,
            **actor_fields(ctx, operation_id),
        }
    )
    entry.insert()
    entry.submit()
    actual_after, _ = _stock(item.name)
    adjustment = {
        "name": entry.name,
        "item_code": item.name,
        "item_name": item.item_name,
        "delta": delta,
        "quantity_after": int(actual_after),
        "reason": reason,
        "sales_order": None,
        "creation": str(entry.creation),
        **stamp_fields(ctx, "savingroup_created_by"),
    }
    return {"adjustment": adjustment}, external(entry)


# --- sales orders ------------------------------------------------------------


def _order(p, key="id"):
    name = text(p, key) or text(p, "ref") or text(p, "orderId")
    return require("Sales Order", name, "Order")


def _draft_order(p, key="id"):
    order = _order(p, key)
    if order.docstatus == 1:
        throw("invalid_state", "The order is already confirmed.")
    if order.docstatus == 2 or order.savingroup_approval_status == "cancelled":
        throw("invalid_state", "The order is cancelled.")
    return order


def _line(ctx, line, warehouse: str, delivery_date: str) -> dict:
    item = _item(line.get("sku") or line.get("productId"))
    qty = int(number(line, "quantity") or 0)
    if qty <= 0:
        throw("invalid_input", "quantity must be positive.")
    rate = number(line, "unitPrice")
    if rate is None:
        rate = _selling_rate(ctx, item.name, item.standard_rate)
    return {
        "item_code": item.name,
        "item_name": item.item_name,
        "description": item.description or item.item_name,
        "qty": qty,
        "rate": flt(rate),
        "uom": item.stock_uom,
        "stock_uom": item.stock_uom,
        "conversion_factor": 1,
        "warehouse": warehouse,
        "delivery_date": delivery_date,
    }


def order_create_draft(p, ctx, operation_id):
    company = _company(ctx)
    deal = None
    deal_name = text(p, "dealId") or text(p, "dealRef")
    if deal_name:
        deal = require("CRM Deal", deal_name, "Deal")
    organization = text(p, "companyId") or (deal.organization if deal else None)
    if not organization:
        throw("invalid_input", "An order needs a customer: pass companyId or a deal with a company.")
    require("CRM Organization", organization, "Company")
    contact = text(p, "contactId")
    if contact:
        require("Contact", contact)
    lines = p.get("lines") or []
    if not isinstance(lines, list) or not lines:
        throw("invalid_input", "Add at least one line; Savingroup ERP does not keep empty orders.")
    customer = _ensure_customer(ctx, organization, operation_id)
    warehouse = _warehouse(ctx, company)
    delivery_date = add_days(nowdate(), DELIVERY_LEAD_DAYS)
    order = frappe.get_doc(
        {
            "doctype": "Sales Order",
            "company": company,
            "customer": customer,
            "order_type": "Sales",
            "transaction_date": nowdate(),
            "delivery_date": delivery_date,
            "currency": ctx.get("currency") or frappe.db.get_value("Company", company, "default_currency"),
            "selling_price_list": _price_list(ctx),
            "set_warehouse": warehouse,
            "items": [_line(ctx, line, warehouse, delivery_date) for line in lines],
            "savingroup_deal": deal.name if deal else None,
            "savingroup_contact": contact,
            "savingroup_notes": text(p, "notes"),
            "savingroup_approval_status": "draft",
            **actor_fields(ctx, operation_id),
        }
    )
    order.insert()
    return {"sales_order": order_dict(order)}, external(order)


def order_add_item(p, ctx, operation_id):
    order = _draft_order(p, "orderId")
    warehouse = order.set_warehouse or _warehouse(ctx, order.company)
    order.append("items", _line(ctx, p, warehouse, order.delivery_date))
    order.save()
    return {"sales_order": order_dict(order)}, external(order)


def order_remove_item(p, ctx, operation_id):
    order = _draft_order(p, "orderId")
    line_id = text(p, "lineId")
    remaining = [row for row in order.items if row.name != line_id]
    if len(remaining) == len(order.items):
        throw("not_found", "Order line not found.")
    if not remaining:
        throw("invalid_state", "An order keeps at least one line; cancel it instead.")
    order.set("items", remaining)
    order.save()
    return {"sales_order": order_dict(order)}, external(order)


def order_request_approval(p, ctx, operation_id):
    order = _draft_order(p)
    if not order.items:
        throw("invalid_state", "Add at least one line before requesting approval.")
    if order.savingroup_approval_status == "approved":
        throw("invalid_state", "The order is already approved.")
    frappe.db.set_value(
        "Sales Order",
        order.name,
        {"savingroup_approval_status": "pending_approval", "savingroup_approval_requested_at": now_str()},
    )
    return {"sales_order": order_dict(frappe.get_doc("Sales Order", order.name))}, external(order)


def order_approve(p, ctx, operation_id):
    order = _draft_order(p)
    if order.savingroup_approval_status != "pending_approval":
        throw("invalid_state", "Only an order pending approval can be approved.")
    frappe.db.set_value(
        "Sales Order",
        order.name,
        {
            "savingroup_approval_status": "approved",
            "savingroup_approved_at": now_str(),
            **stamp_fields(ctx, "savingroup_approved_by"),
        },
    )
    return {"sales_order": order_dict(frappe.get_doc("Sales Order", order.name))}, external(order)


def order_confirm(p, ctx, operation_id):
    from erpnext.selling.doctype.sales_order.sales_order import make_delivery_note

    order = _draft_order(p)
    if policy(ctx, "order_approval_required", True) and order.savingroup_approval_status != "approved":
        throw("invalid_state", "Approve the order before confirming it.")
    if not order.items:
        throw("invalid_state", "An order needs at least one line.")
    if not policy(ctx, "allow_negative_stock"):
        for row in order.items:
            actual, _reserved = _stock(row.item_code)
            if actual - flt(row.qty) < 0:
                throw(
                    "insufficient_stock",
                    f"Only {int(actual)} of {row.item_code} on hand; the order needs {int(row.qty)}.",
                )
    order.submit()
    delivery = make_delivery_note(order.name)
    delivery.update(actor_fields(ctx, operation_id))
    delivery.insert()
    delivery.submit()
    frappe.db.set_value("Sales Order", order.name, "savingroup_confirmed_at", now_str())
    if order.savingroup_deal and frappe.db.exists("CRM Deal", order.savingroup_deal):
        deal = frappe.get_doc("CRM Deal", order.savingroup_deal)
        if deal.status not in ("Won", "Lost") and frappe.db.exists("CRM Deal Status", "Won"):
            deal.status = "Won"
            deal.save()
    refreshed = frappe.get_doc("Sales Order", order.name)
    return {"sales_order": order_dict(refreshed), "delivery_note": as_dict(delivery)}, external(order)


def order_cancel(p, ctx, operation_id):
    order = _order(p)
    if order.docstatus == 1:
        throw("invalid_state", "A confirmed order cannot be cancelled; reverse it with an adjustment.")
    if order.docstatus == 2 or order.savingroup_approval_status == "cancelled":
        throw("invalid_state", "The order is already cancelled.")
    frappe.db.set_value(
        "Sales Order",
        order.name,
        {"savingroup_approval_status": "cancelled", "savingroup_cancelled_at": now_str()},
    )
    return {"sales_order": order_dict(frappe.get_doc("Sales Order", order.name))}, external(order)


# --- invoices ----------------------------------------------------------------


def _invoice(p):
    return require("Sales Invoice", text(p, "id") or text(p, "ref"), "Invoice")


def _require_person_for_money(ctx, verb: str):
    if is_bot(ctx) and policy(ctx, "invoice_approval_required", True):
        throw(
            "permission_denied",
            f"A person must {verb} invoices while invoice approval is required for this workspace.",
        )


def invoice_create_draft(p, ctx, operation_id):
    from erpnext.selling.doctype.sales_order.sales_order import make_sales_invoice

    order = require("Sales Order", text(p, "orderId") or text(p, "orderRef"), "Order")
    if order.docstatus != 1:
        throw("invalid_state", "Confirm the order before invoicing it.")
    existing = frappe.get_all(
        "Sales Invoice Item",
        filters={"sales_order": order.name, "docstatus": ["!=", 2]},
        pluck="parent",
        limit=1,
    )
    if existing:
        throw("conflict", f"Order {order.name} already has invoice {existing[0]}.")
    invoice = make_sales_invoice(order.name)
    invoice.due_date = date_part(p.get("dueAt")) or add_days(nowdate(), INVOICE_DUE_DAYS)
    invoice.savingroup_notes = text(p, "notes")
    invoice.update(actor_fields(ctx, operation_id))
    invoice.insert()
    return {"sales_invoice": as_dict(invoice)}, external(invoice)


def invoice_issue(p, ctx, operation_id):
    _require_person_for_money(ctx, "issue")
    invoice = _invoice(p)
    if invoice.docstatus != 0:
        throw("invalid_state", "Only a draft invoice can be issued.")
    if date_part(p.get("dueAt")):
        invoice.due_date = date_part(p.get("dueAt"))
    invoice.submit()
    frappe.db.set_value("Sales Invoice", invoice.name, stamp_fields(ctx, "savingroup_approved_by"))
    return {"sales_invoice": as_dict(frappe.get_doc("Sales Invoice", invoice.name))}, external(invoice)


def invoice_record_payment(p, ctx, operation_id):
    from erpnext.accounts.doctype.payment_entry.payment_entry import get_payment_entry

    _require_person_for_money(ctx, "record a payment on")
    invoice = _invoice(p)
    if invoice.docstatus != 1:
        throw("invalid_state", "Issue the invoice before recording a payment.")
    amount = flt(number(p, "amount") or 0)
    if amount <= 0:
        throw("invalid_input", "amount must be positive.")
    if amount > flt(invoice.outstanding_amount) + 0.005:
        throw("invalid_input", f"Only {flt(invoice.outstanding_amount)} is outstanding on {invoice.name}.")
    payment = get_payment_entry("Sales Invoice", invoice.name, party_amount=amount)
    payment.paid_amount = amount
    payment.received_amount = amount
    for row in payment.references:
        row.allocated_amount = amount if row.reference_name == invoice.name else 0
    payment.reference_no = text(p, "note") or f"Savingroup {operation_id[:12]}"
    payment.reference_date = nowdate()
    payment.savingroup_note = text(p, "note")
    payment.update(actor_fields(ctx, operation_id))
    payment.insert()
    payment.submit()
    refreshed = frappe.get_doc("Sales Invoice", invoice.name)
    return {"sales_invoice": as_dict(refreshed), "payment_entry": as_dict(payment)}, external(invoice)
