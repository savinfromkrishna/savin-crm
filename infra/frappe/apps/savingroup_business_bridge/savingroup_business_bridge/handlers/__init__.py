"""Action id to handler. Each handler takes ``(payload, context, operation_id)`` and
returns ``(result, external)`` where ``external`` names the primary document.
"""

from savingroup_business_bridge.handlers import admin, crm, erp

HANDLERS = {
    "crm.company.create": crm.company_create,
    "crm.company.update": crm.company_update,
    "crm.contact.create": crm.contact_create,
    "crm.contact.update": crm.contact_update,
    "crm.lead.create": crm.lead_create,
    "crm.lead.assign": crm.lead_assign,
    "crm.lead.qualify": crm.lead_qualify,
    "crm.lead.convert": crm.lead_convert,
    "crm.deal.create": crm.deal_create,
    "crm.deal.update": crm.deal_update,
    "crm.deal.update_stage": crm.deal_update_stage,
    "crm.activity.create": crm.activity_create,
    "erp.product.create": erp.product_create,
    "erp.product.update": erp.product_update,
    "erp.inventory.adjust": erp.inventory_adjust,
    "erp.order.create_draft": erp.order_create_draft,
    "erp.order.add_item": erp.order_add_item,
    "erp.order.remove_item": erp.order_remove_item,
    "erp.order.request_approval": erp.order_request_approval,
    "erp.order.approve": erp.order_approve,
    "erp.order.confirm": erp.order_confirm,
    "erp.order.cancel": erp.order_cancel,
    "erp.invoice.create_draft": erp.invoice_create_draft,
    "erp.invoice.issue": erp.invoice_issue,
    "erp.invoice.record_payment": erp.invoice_record_payment,
    # Site administration (Operator): any doctype, with the gateway user's permissions.
    "admin.document.insert": admin.document_insert,
    "admin.document.update": admin.document_update,
    "admin.document.submit": admin.document_submit,
    "admin.document.cancel": admin.document_cancel,
    "admin.document.delete": admin.document_delete,
    "admin.method.call": admin.method_call,
}
