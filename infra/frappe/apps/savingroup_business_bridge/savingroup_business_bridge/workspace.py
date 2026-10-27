"""The "Savingroup" desk workspace: one page on the site that shows the whole
business environment at a glance (gateway operations, CRM, selling, stock,
compliance) with live number cards, shortcuts and link cards.

Created on install and refreshed on migrate; idempotent.
"""

import json

import frappe

MODULE = "Savingroup Business Bridge"
WORKSPACE = "Savingroup"

NUMBER_CARDS = [
    {
        "name": "Savingroup Open Leads",
        "document_type": "CRM Lead",
        "function": "Count",
        "filters": [
            ["CRM Lead", "converted", "=", 0],
            ["CRM Lead", "status", "not in", ["Unqualified", "Junk", "Converted"]],
        ],
        "color": "#7C7C7C",
    },
    {
        "name": "Savingroup Open Deals",
        "document_type": "CRM Deal",
        "function": "Count",
        "filters": [["CRM Deal", "status", "not in", ["Won", "Lost"]]],
        "color": "#7C7C7C",
    },
    {
        "name": "Savingroup Won Deal Value",
        "document_type": "CRM Deal",
        "function": "Sum",
        "aggregate_function_based_on": "deal_value",
        "filters": [["CRM Deal", "status", "=", "Won"]],
        "color": "#29CD42",
    },
    {
        "name": "Savingroup Active Items",
        "document_type": "Item",
        "function": "Count",
        "filters": [["Item", "disabled", "=", 0]],
        "color": "#7C7C7C",
    },
    {
        "name": "Savingroup Confirmed Orders",
        "document_type": "Sales Order",
        "function": "Count",
        "filters": [["Sales Order", "docstatus", "=", 1]],
        "color": "#7C7C7C",
    },
    {
        "name": "Savingroup Outstanding Receivables",
        "document_type": "Sales Invoice",
        "function": "Sum",
        "aggregate_function_based_on": "outstanding_amount",
        "filters": [["Sales Invoice", "docstatus", "=", 1]],
        "color": "#ECAD4B",
    },
    {
        "name": "Savingroup Operations",
        "document_type": "Savingroup Operation",
        "function": "Count",
        "filters": [],
        "color": "#7C7C7C",
    },
    {
        "name": "Savingroup Failed Operations",
        "document_type": "Savingroup Operation",
        "function": "Count",
        "filters": [["Savingroup Operation", "status", "=", "Failed"]],
        "color": "#CB2929",
    },
]

SHORTCUTS = [
    {"label": "Operations", "type": "DocType", "link_to": "Savingroup Operation", "doc_view": "List"},
    {"label": "Bridge Settings", "type": "DocType", "link_to": "Savingroup Bridge Settings", "doc_view": ""},
    {"label": "Savingroup CRM", "type": "URL", "url": "/crm", "link_to": ""},
    {"label": "Leads", "type": "DocType", "link_to": "CRM Lead", "doc_view": "List"},
    {"label": "Deals", "type": "DocType", "link_to": "CRM Deal", "doc_view": "List"},
    {"label": "Items", "type": "DocType", "link_to": "Item", "doc_view": "List"},
    {"label": "Sales Orders", "type": "DocType", "link_to": "Sales Order", "doc_view": "List"},
    {"label": "Sales Invoices", "type": "DocType", "link_to": "Sales Invoice", "doc_view": "List"},
    {"label": "Stock Ledger", "type": "Report", "link_to": "Stock Ledger", "doc_view": ""},
    {"label": "Error Log", "type": "DocType", "link_to": "Error Log", "doc_view": "List"},
]

CARDS = {
    "Savingroup gateway": [
        ("Savingroup Operation", "Operations ledger"),
        ("Savingroup Bridge Settings", "Event delivery"),
        ("Error Log", "Error Log"),
        ("User", "Users and API keys"),
    ],
    "CRM": [
        ("CRM Lead", "Leads"),
        ("CRM Deal", "Deals"),
        ("CRM Organization", "Organizations"),
        ("Contact", "Contacts"),
        ("CRM Task", "Tasks"),
    ],
    "Selling": [
        ("Customer", "Customers"),
        ("Sales Order", "Sales Orders"),
        ("Delivery Note", "Delivery Notes"),
        ("Sales Invoice", "Sales Invoices"),
        ("Payment Entry", "Payment Entries"),
    ],
    "Stock": [
        ("Item", "Items"),
        ("Item Price", "Item Prices"),
        ("Stock Entry", "Stock Entries"),
        ("Stock Ledger Entry", "Stock Ledger Entries"),
        ("Bin", "Stock levels (Bin)"),
    ],
    "Compliance": [
        ("GST Settings", "GST Settings"),
        ("GST HSN Code", "HSN/SAC codes"),
        ("Company", "Company"),
    ],
}


def _block(block_type: str, data: dict) -> dict:
    return {"id": frappe.generate_hash(length=10), "type": block_type, "data": data}


def _header(text: str) -> dict:
    return _block("header", {"text": f'<span class="h4"><b>{text}</b></span>', "col": 12})


def _content() -> str:
    blocks = [_header("Savingroup")]
    blocks += [_block("number_card", {"number_card_name": card["name"], "col": 3}) for card in NUMBER_CARDS]
    blocks.append(_block("spacer", {"col": 12}))
    blocks.append(_header("Shortcuts"))
    blocks += [_block("shortcut", {"shortcut_name": shortcut["label"], "col": 3}) for shortcut in SHORTCUTS]
    blocks.append(_block("spacer", {"col": 12}))
    blocks.append(_header("Masters & Reports"))
    blocks += [_block("card", {"card_name": name, "col": 4}) for name in CARDS]
    return json.dumps(blocks)


def ensure_number_cards():
    for card in NUMBER_CARDS:
        if not frappe.db.exists("DocType", card["document_type"]):
            continue
        values = {
            "label": card["name"],
            "type": "Document Type",
            "document_type": card["document_type"],
            "function": card["function"],
            "aggregate_function_based_on": card.get("aggregate_function_based_on"),
            "filters_json": json.dumps(card["filters"]),
            "is_public": 1,
            "is_standard": 0,
            "show_percentage_stats": 0,
            "stats_time_interval": "Daily",
            "color": card["color"],
        }
        if frappe.db.exists("Number Card", card["name"]):
            doc = frappe.get_doc("Number Card", card["name"])
            doc.update(values)
            doc.flags.ignore_permissions = True
            doc.save()
            continue
        doc = frappe.get_doc({"doctype": "Number Card", "name": card["name"], "__newname": card["name"], **values})
        doc.flags.ignore_permissions = True
        doc.insert()


def ensure_workspace():
    ensure_number_cards()
    links = []
    for card_name, entries in CARDS.items():
        entries = [(doctype, label) for doctype, label in entries if frappe.db.exists("DocType", doctype)]
        if not entries:
            continue
        links.append({"type": "Card Break", "label": card_name, "link_count": len(entries)})
        for doctype, label in entries:
            links.append(
                {"type": "Link", "link_type": "DocType", "link_to": doctype, "label": label, "onboard": 0}
            )
    shortcuts = [
        shortcut
        for shortcut in SHORTCUTS
        if shortcut["type"] != "DocType" or frappe.db.exists("DocType", shortcut["link_to"])
    ]
    number_cards = [
        {"number_card_name": card["name"]}
        for card in NUMBER_CARDS
        if frappe.db.exists("Number Card", card["name"])
    ]
    values = {
        "label": WORKSPACE,
        "title": WORKSPACE,
        "module": MODULE,
        "public": 1,
        "is_hidden": 0,
        "icon": "integration",
        "indicator_color": "blue",
        "sequence_id": 0.5,
        "type": "Workspace",
        "content": _content(),
    }
    # Workspaces are declarative: replace the whole page rather than patch it.
    existing = frappe.get_all("Workspace", filters={"title": WORKSPACE, "public": 1}, pluck="name")
    for name in existing:
        frappe.delete_doc("Workspace", name, force=True, ignore_permissions=True, delete_permanently=True)
    doc = frappe.get_doc({"doctype": "Workspace", "__newname": WORKSPACE, **values})
    doc.set("links", links)
    doc.set("shortcuts", shortcuts)
    doc.set("number_cards", number_cards)
    doc.set("charts", [])
    doc.flags.ignore_permissions = True
    doc.insert()
    frappe.db.commit()
    frappe.clear_cache()
    return {"ok": True, "workspace": WORKSPACE, "cards": len(number_cards), "shortcuts": len(shortcuts)}


def diagnose():
    """`bench execute` swallows exceptions; this returns the traceback instead."""
    try:
        return ensure_workspace()
    except Exception:
        frappe.db.rollback()
        return {"ok": False, "error": frappe.get_traceback(), "messages": frappe.local.message_log}
