"""Signed business event deliveries to Savingroup.

Each document event becomes one HTTP POST with a delivery id, a timestamp and an
HMAC-SHA256 signature over ``"<timestamp>.<body>"``. Deliveries are queued after
the database transaction commits, so Savingroup never learns about a document that
was rolled back. Savingroup deduplicates on the delivery id.
"""

import hashlib
import hmac
import json
import time
import uuid

import frappe
from frappe.utils import now_datetime

SIGNATURE_HEADER = "X-Savingroup-Signature"
TIMESTAMP_HEADER = "X-Savingroup-Timestamp"
DELIVERY_HEADER = "X-Savingroup-Delivery"
RETRY_DELAYS_SECONDS = (1, 5, 20)


def _settings():
    try:
        settings = frappe.get_cached_doc("Savingroup Bridge Settings")
    except Exception:
        return None, None
    if not settings.webhook_url or not settings.events_enabled:
        return None, None
    secret = settings.get_password("webhook_secret", raise_exception=False)
    if not secret:
        return None, None
    return settings.webhook_url, secret


def emit(doc, event_type: str, payload: dict | None = None):
    url, secret = _settings()
    if not url:
        return
    body = {
        "delivery_id": str(uuid.uuid4()),
        "type": event_type,
        "doctype": doc.doctype,
        "name": doc.name,
        "operation_id": doc.get("savingroup_operation_id"),
        "occurred_at": now_datetime().isoformat(),
        "payload": payload or {},
    }
    frappe.enqueue(
        "savingroup_business_bridge.events.deliver",
        queue="short",
        enqueue_after_commit=True,
        url=url,
        secret=secret,
        body=body,
    )


def deliver(url: str, secret: str, body: dict):
    import requests

    raw = json.dumps(body, separators=(",", ":"), sort_keys=False)
    last_error = None
    for attempt, delay in enumerate((0, *RETRY_DELAYS_SECONDS)):
        if delay:
            time.sleep(delay)
        timestamp = str(int(time.time()))
        signature = hmac.new(
            secret.encode("utf-8"), f"{timestamp}.{raw}".encode("utf-8"), hashlib.sha256
        ).hexdigest()
        try:
            response = requests.post(
                url,
                data=raw,
                headers={
                    "Content-Type": "application/json",
                    DELIVERY_HEADER: body["delivery_id"],
                    TIMESTAMP_HEADER: timestamp,
                    SIGNATURE_HEADER: f"sha256={signature}",
                },
                timeout=10,
            )
        except requests.RequestException as exc:
            last_error = str(exc)
            continue
        if response.status_code < 500 and response.status_code != 429:
            # 2xx stored it; 4xx means Savingroup rejected it for good (bad signature, unknown environment).
            if response.status_code >= 400:
                frappe.log_error(
                    title="Savingroup event rejected",
                    message=f"{body['type']} {body['doctype']} {body['name']}: HTTP {response.status_code}",
                )
            return
        last_error = f"HTTP {response.status_code}"
    frappe.log_error(
        title="Savingroup event delivery failed",
        message=f"{body['type']} {body['doctype']} {body['name']}: {last_error}",
    )


# --- document hooks -----------------------------------------------------------


def on_lead_insert(doc, method=None):
    emit(doc, "crm.lead.created", {"status": doc.status})


def on_lead_update(doc, method=None):
    if doc.flags.in_insert:
        return
    emit(doc, "crm.lead.updated", {"status": doc.status, "converted": int(doc.converted or 0)})


def on_deal_insert(doc, method=None):
    emit(doc, "crm.deal.created", {"status": doc.status, "deal_value": doc.deal_value})


def on_deal_update(doc, method=None):
    if doc.flags.in_insert:
        return
    before = doc.get_doc_before_save()
    if before is not None and before.status != doc.status and doc.status == "Won":
        emit(doc, "crm.deal.won", {"deal_value": doc.deal_value})
        return
    emit(doc, "crm.deal.updated", {"status": doc.status, "deal_value": doc.deal_value})


def on_customer_insert(doc, method=None):
    emit(doc, "customer.created", {"customer_name": doc.customer_name})


def on_quotation_submit(doc, method=None):
    emit(doc, "sales.quotation.created", {"grand_total": doc.grand_total})


def on_sales_order_submit(doc, method=None):
    emit(doc, "sales.order.submitted", {"customer": doc.customer, "grand_total": doc.grand_total})


def on_sales_order_cancel(doc, method=None):
    emit(doc, "sales.order.cancelled", {"customer": doc.customer})


def on_sales_invoice_submit(doc, method=None):
    emit(
        doc,
        "sales.invoice.submitted",
        {"customer": doc.customer, "grand_total": doc.grand_total, "outstanding": doc.outstanding_amount},
    )


def on_sales_invoice_cancel(doc, method=None):
    emit(doc, "sales.invoice.cancelled", {"customer": doc.customer})


def on_payment_submit(doc, method=None):
    references = [
        {"doctype": row.reference_doctype, "name": row.reference_name, "amount": row.allocated_amount}
        for row in (doc.references or [])
    ]
    emit(doc, "finance.payment.recorded", {"paid_amount": doc.paid_amount, "references": references})


def on_stock_ledger_insert(doc, method=None):
    if doc.is_cancelled:
        return
    emit(
        doc,
        "inventory.stock.changed",
        {
            "item_code": doc.item_code,
            "warehouse": doc.warehouse,
            "actual_qty": doc.actual_qty,
            "qty_after_transaction": doc.qty_after_transaction,
            "voucher_type": doc.voucher_type,
            "voucher_no": doc.voucher_no,
        },
    )
