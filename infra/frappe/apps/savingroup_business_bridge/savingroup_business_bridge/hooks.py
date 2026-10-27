app_name = "savingroup_business_bridge"
app_title = "Savingroup Business Bridge"
app_publisher = "Savingroup contributors"
app_description = "Idempotent business actions and signed events for the Savingroup gateway"
app_email = "noreply@savingroup.invalid"
app_license = "Apache-2.0"

required_apps = ["frappe/erpnext", "frappe/crm"]

after_install = "savingroup_business_bridge.install.after_install"
after_migrate = "savingroup_business_bridge.install.after_migrate"

# Document events become signed deliveries to Savingroup (see events.py). They are
# queued after the transaction commits, so Savingroup never hears about a rollback.
doc_events = {
    "CRM Lead": {
        "after_insert": "savingroup_business_bridge.events.on_lead_insert",
        "on_update": "savingroup_business_bridge.events.on_lead_update",
    },
    "CRM Deal": {
        "after_insert": "savingroup_business_bridge.events.on_deal_insert",
        "on_update": "savingroup_business_bridge.events.on_deal_update",
    },
    "Customer": {"after_insert": "savingroup_business_bridge.events.on_customer_insert"},
    "Quotation": {"on_submit": "savingroup_business_bridge.events.on_quotation_submit"},
    "Sales Order": {
        "on_submit": "savingroup_business_bridge.events.on_sales_order_submit",
        "on_cancel": "savingroup_business_bridge.events.on_sales_order_cancel",
    },
    "Sales Invoice": {
        "on_submit": "savingroup_business_bridge.events.on_sales_invoice_submit",
        "on_cancel": "savingroup_business_bridge.events.on_sales_invoice_cancel",
    },
    "Payment Entry": {"on_submit": "savingroup_business_bridge.events.on_payment_submit"},
    "Stock Ledger Entry": {"after_insert": "savingroup_business_bridge.events.on_stock_ledger_insert"},
}

# The site's sign-in pages are www/login, www/update-password and www/message
# (see auth.py). Frappe's not-permitted page renders www/message.html with its
# own controller; this hook gives it the same context.
update_website_context = ["savingroup_business_bridge.auth.update_website_context"]
