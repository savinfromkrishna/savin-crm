"""Composite reads the gateway cannot express as a single REST list call."""

import frappe
from frappe.utils import flt

from savingroup_business_bridge.handlers import admin
from savingroup_business_bridge.handlers.common import as_dict, default

LOW_STOCK_THRESHOLD = 5
ITEM_FIELDS = [
    "name",
    "item_code",
    "item_name",
    "description",
    "disabled",
    "standard_rate",
    "valuation_rate",
    "stock_uom",
    "creation",
    "modified",
    "savingroup_created_by_user",
    "savingroup_created_by_bot",
    "savingroup_operation_id",
]


def _item_fields() -> list[str]:
    fields = list(ITEM_FIELDS)
    if frappe.get_meta("Item").has_field("gst_hsn_code"):
        fields.append("gst_hsn_code")
    return fields


def _limit(params, fallback=50) -> int:
    try:
        return max(1, min(int(params.get("limit") or fallback), 200))
    except (TypeError, ValueError):
        return fallback


def _price_list(ctx_or_params) -> str:
    preferred = default(ctx_or_params or {}, "price_list", "Standard Selling")
    if frappe.db.exists("Price List", preferred):
        return preferred
    fallback = frappe.get_all("Price List", filters={"selling": 1, "enabled": 1}, pluck="name", limit=1)
    return fallback[0] if fallback else preferred


def _stock_map(item_codes: list[str]) -> dict:
    if not item_codes:
        return {}
    # Frappe v16 rejects SQL function strings in get_all fields; aggregate with SQL.
    rows = frappe.db.sql(
        """select item_code, coalesce(sum(actual_qty), 0) as actual_qty,
                  coalesce(sum(reserved_qty), 0) as reserved_qty
           from `tabBin` where item_code in %(codes)s group by item_code""",
        {"codes": tuple(item_codes)},
        as_dict=True,
    )
    return {row.item_code: (flt(row.actual_qty), flt(row.reserved_qty)) for row in rows}


def _price_map(item_codes: list[str], price_list: str) -> dict:
    if not item_codes:
        return {}
    rows = frappe.get_all(
        "Item Price",
        filters={"item_code": ["in", item_codes], "price_list": price_list, "selling": 1},
        fields=["item_code", "price_list_rate"],
    )
    return {row.item_code: flt(row.price_list_rate) for row in rows}


def _decorate_items(items: list[dict], price_list: str) -> list[dict]:
    codes = [row["name"] for row in items]
    stock = _stock_map(codes)
    prices = _price_map(codes, price_list)
    for row in items:
        actual, reserved = stock.get(row["name"], (0.0, 0.0))
        row["actual_qty"] = actual
        row["reserved_qty"] = reserved
        row["price_list_rate"] = prices.get(row["name"])
        row["creation"] = str(row.get("creation") or "")
        row["modified"] = str(row.get("modified") or "")
    return items


def product_row(ctx, item_code: str) -> dict:
    rows = frappe.get_all("Item", filters={"name": item_code}, fields=_item_fields(), limit=1)
    decorated = _decorate_items([dict(row) for row in rows], _price_list(ctx))
    return decorated[0] if decorated else {}


def products(params, company=None):
    filters = {"is_stock_item": 1}
    if not params.get("include_inactive"):
        filters["disabled"] = 0
    if params.get("id"):
        filters["name"] = params["id"]
    if params.get("sku"):
        filters["item_code"] = str(params["sku"]).upper()
    or_filters = None
    if params.get("q"):
        needle = f"%{params['q']}%"
        or_filters = {"item_code": ["like", needle], "item_name": ["like", needle]}
    rows = frappe.get_all(
        "Item",
        filters=filters,
        or_filters=or_filters,
        fields=_item_fields(),
        order_by="modified desc",
        limit=_limit(params),
    )
    return _decorate_items([dict(row) for row in rows], _price_list({}))


def inventory(params, company=None):
    code = str(params.get("item_code") or "").upper()
    if not code or not frappe.db.exists("Item", code):
        return None
    return product_row({}, code)


def adjustments(params, company=None):
    filters = {"is_cancelled": 0, "voucher_type": ["in", ["Stock Entry", "Delivery Note", "Stock Reconciliation"]]}
    if params.get("item_code"):
        filters["item_code"] = str(params["item_code"]).upper()
    ledger = frappe.get_all(
        "Stock Ledger Entry",
        filters=filters,
        fields=[
            "name",
            "item_code",
            "actual_qty",
            "qty_after_transaction",
            "voucher_type",
            "voucher_no",
            "creation",
        ],
        order_by="creation desc",
        limit=_limit(params),
    )
    names = {row.item_code for row in ledger}
    item_names = dict(frappe.get_all("Item", filters={"name": ["in", list(names)]}, fields=["name", "item_name"], as_list=True)) if names else {}
    out = []
    for row in ledger:
        voucher = frappe.db.get_value(
            row.voucher_type,
            row.voucher_no,
            ["savingroup_reason", "savingroup_created_by_user", "savingroup_created_by_bot"],
            as_dict=True,
        ) or frappe._dict()
        sales_order = None
        reason = voucher.get("savingroup_reason")
        if row.voucher_type == "Delivery Note":
            sales_order = frappe.db.get_value(
                "Delivery Note Item", {"parent": row.voucher_no, "against_sales_order": ["is", "set"]}, "against_sales_order"
            )
            reason = reason or (f"Delivered for {sales_order}" if sales_order else "Delivered")
        elif row.voucher_type == "Stock Reconciliation":
            reason = reason or "Opening stock"
        out.append(
            {
                "name": row.name,
                "item_code": row.item_code,
                "item_name": item_names.get(row.item_code) or row.item_code,
                "delta": int(flt(row.actual_qty)),
                "quantity_after": int(flt(row.qty_after_transaction)),
                "reason": reason or row.voucher_type,
                "sales_order": sales_order,
                "creation": str(row.creation),
                "savingroup_created_by_user": voucher.get("savingroup_created_by_user"),
                "savingroup_created_by_bot": voucher.get("savingroup_created_by_bot"),
            }
        )
    return out


# --- orders and invoices -----------------------------------------------------


def _invoice_for_order(order_name: str):
    return frappe.db.get_value(
        "Sales Invoice Item", {"sales_order": order_name, "docstatus": ["!=", 2]}, "parent"
    )


def order_dict(order) -> dict:
    data = as_dict(order)
    data["savingroup_invoice"] = _invoice_for_order(order.name)
    return data


def order(params, company=None):
    name = str(params.get("name") or "").strip()
    if not name or not frappe.db.exists("Sales Order", name):
        return None
    return order_dict(frappe.get_doc("Sales Order", name))


ORDER_STATUS_FILTERS = {
    "draft": {"docstatus": 0, "savingroup_approval_status": ["in", ["", "draft", None]]},
    "pending_approval": {"docstatus": 0, "savingroup_approval_status": "pending_approval"},
    "approved": {"docstatus": 0, "savingroup_approval_status": "approved"},
    "confirmed": {"docstatus": 1},
}


def orders(params, company=None):
    filters = {}
    if company:
        filters["company"] = company
    status = params.get("status")
    or_filters = None
    if status == "cancelled":
        or_filters = {"docstatus": 2, "savingroup_approval_status": "cancelled"}
    elif status in ORDER_STATUS_FILTERS:
        extra = dict(ORDER_STATUS_FILTERS[status])
        if status == "draft":
            # Drafts never requested or already approved; exclude cancelled drafts.
            filters["docstatus"] = 0
            filters["savingroup_approval_status"] = ["not in", ["pending_approval", "approved", "cancelled"]]
        else:
            filters.update(extra)
    if params.get("customer"):
        filters["customer"] = params["customer"]
    if params.get("deal"):
        filters["savingroup_deal"] = params["deal"]
    if params.get("q"):
        needle = f"%{params['q']}%"
        or_filters = {**(or_filters or {}), "name": ["like", needle], "customer_name": ["like", needle]}
    names = frappe.get_all(
        "Sales Order",
        filters=filters,
        or_filters=or_filters,
        pluck="name",
        order_by="modified desc",
        limit=_limit(params),
    )
    return [order_dict(frappe.get_doc("Sales Order", name)) for name in names]


def invoice(params, company=None):
    name = str(params.get("name") or "").strip()
    if not name or not frappe.db.exists("Sales Invoice", name):
        return None
    return as_dict(frappe.get_doc("Sales Invoice", name))


def invoices(params, company=None):
    filters = {"docstatus": ["!=", 2]}
    if company:
        filters["company"] = company
    status = params.get("status")
    if status == "draft":
        filters["docstatus"] = 0
    elif status == "issued":
        filters["docstatus"] = 1
        filters["outstanding_amount"] = [">", 0]
    elif status == "paid":
        filters["docstatus"] = 1
        filters["outstanding_amount"] = ["<=", 0]
    payment_status = params.get("payment_status")
    if payment_status == "paid":
        filters["docstatus"] = 1
        filters["outstanding_amount"] = ["<=", 0]
    elif payment_status == "unpaid":
        filters["outstanding_amount"] = ["=", "grand_total"] if False else [">", 0]
    if params.get("customer"):
        filters["customer"] = params["customer"]
    names = frappe.get_all(
        "Sales Invoice", filters=filters, pluck="name", order_by="modified desc", limit=_limit(params)
    )
    rows = [as_dict(frappe.get_doc("Sales Invoice", name)) for name in names]
    if payment_status == "partial":
        rows = [r for r in rows if r.get("docstatus") == 1 and 0 < flt(r.get("outstanding_amount")) < flt(r.get("grand_total"))]
    elif payment_status == "unpaid":
        rows = [r for r in rows if flt(r.get("outstanding_amount")) >= flt(r.get("grand_total")) - 0.005]
    return rows


# --- overviews ---------------------------------------------------------------


def crm_overview(params, company=None):
    open_deals = frappe.get_all(
        "CRM Deal", filters={"status": ["not in", ["Won", "Lost"]]}, fields=["deal_value"]
    )
    won = frappe.get_all("CRM Deal", filters={"status": "Won"}, fields=["deal_value"])
    return {
        "companies": frappe.db.count("CRM Organization"),
        "contacts": frappe.db.count("Contact"),
        "open_leads": frappe.db.count(
            "CRM Lead", {"converted": 0, "status": ["not in", ["Unqualified", "Junk", "Converted"]]}
        ),
        "open_deals": len(open_deals),
        "open_deal_amount": sum(flt(row.deal_value) for row in open_deals),
        "won_deal_amount": sum(flt(row.deal_value) for row in won),
        "open_follow_ups": frappe.db.count(
            "CRM Task", {"status": ["!=", "Done"], "due_date": ["is", "set"]}
        ),
    }


def erp_overview(params, company=None):
    company_filter = {"company": company} if company else {}
    items = frappe.get_all("Item", filters={"disabled": 0, "is_stock_item": 1}, pluck="name")
    stock = _stock_map(items)
    confirmed = frappe.get_all(
        "Sales Order", filters={"docstatus": 1, **company_filter}, fields=["total"]
    )
    open_invoices = frappe.get_all(
        "Sales Invoice", filters={"docstatus": 1, **company_filter}, fields=["outstanding_amount"]
    )
    return {
        "products": len(items),
        "low_stock_products": sum(
            1 for code in items if stock.get(code, (0.0, 0.0))[0] <= LOW_STOCK_THRESHOLD
        ),
        "draft_orders": frappe.db.count(
            "Sales Order",
            {
                "docstatus": 0,
                "savingroup_approval_status": ["not in", ["pending_approval", "approved", "cancelled"]],
                **company_filter,
            },
        ),
        "pending_approval_orders": frappe.db.count(
            "Sales Order", {"docstatus": 0, "savingroup_approval_status": "pending_approval", **company_filter}
        ),
        "confirmed_orders": len(confirmed),
        "confirmed_order_amount": sum(flt(row.total) for row in confirmed),
        "draft_invoices": frappe.db.count("Sales Invoice", {"docstatus": 0, **company_filter}),
        "outstanding_invoice_amount": sum(flt(row.outstanding_amount) for row in open_invoices),
    }


QUERIES = {
    "products": products,
    "inventory": inventory,
    "adjustments": adjustments,
    "order": order,
    "orders": orders,
    "invoice": invoice,
    "invoices": invoices,
    "crm_overview": crm_overview,
    "erp_overview": erp_overview,
    # Site administration reads (Operator).
    "admin_doctypes": admin.doctypes,
    "admin_doctype": admin.doctype,
    "admin_documents": admin.documents,
    "admin_document": admin.document,
}
