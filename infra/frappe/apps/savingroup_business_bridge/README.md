# Savingroup Business Bridge

A small Frappe app installed on every Savingroup business site next to ERPNext and
Frappe CRM. It gives the Savingroup gateway a narrow, idempotent surface instead of
raw document access:

- `savingroup_business_bridge.api.ping` reports apps, companies and the protocol version.
- `savingroup_business_bridge.api.execute` runs one named business action once per
  operation id, inside one database transaction, and remembers the outcome in
  the `Savingroup Operation` doctype so a retry after a lost response returns the
  committed result instead of acting twice.
- `savingroup_business_bridge.api.get_operation` answers "did that commit?".
- `savingroup_business_bridge.api.query` serves composite reads (items with stock
  and price, orders with lines and invoice links, overview counts).
- `savingroup_business_bridge.api.configure_webhook` stores where signed document
  events are delivered.
- The site's sign-in pages (`www/login`, `www/update-password`, `www/message`) carry the
  organization's name and logo from Website Settings; Frappe still handles every sign-in request.
- A **Savingroup** desk workspace (number cards, shortcuts, link cards) is created on
  install and refreshed on migrate, so people can see the whole environment at a glance.

Every action runs as the authenticated gateway user, so ERPNext and Frappe CRM
role permissions still apply. The app never grants Administrator rights.

Custom `savingroup_*` fields record which Savingroup person or bot created or approved a
document, the Savingroup-side title, notes and approval state, and the operation id.
