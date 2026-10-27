"""Site bootstrap helpers, run with ``bench --site <site> execute`` by the
provisioning script. They are idempotent so a resumed provisioning run can call
them again.
"""

import json

import frappe
from frappe.utils import cint

from savingroup_business_bridge.install import GATEWAY_ROLES, ensure_roles


def complete_setup(**args):
    """Run ERPNext's setup wizard programmatically from blueprint values."""
    from frappe.desk.page.setup_wizard.setup_wizard import setup_complete

    if frappe.is_setup_complete():
        return {"ok": True, "already_complete": True}
    required = ("country", "currency", "timezone", "company_name", "company_abbr", "fy_start_date", "fy_end_date")
    missing = [key for key in required if not args.get(key)]
    if missing:
        frappe.throw(f"Setup wizard needs: {', '.join(missing)}")
    payload = {
        "language": args.get("language") or "English",
        "lang": "en",
        "country": args["country"],
        "timezone": args["timezone"],
        "currency": args["currency"],
        "full_name": args.get("full_name") or "Administrator",
        "email": args.get("email") or "admin@example.com",
        "company_name": args["company_name"],
        "company_abbr": args["company_abbr"],
        "chart_of_accounts": args.get("chart_of_accounts") or "Standard",
        "fy_start_date": args["fy_start_date"],
        "fy_end_date": args["fy_end_date"],
        "setup_demo": 0,
        "enable_telemetry": 0,
    }
    if args.get("bank_account"):
        payload["bank_account"] = args["bank_account"]
    setup_complete(payload)
    frappe.db.commit()
    return {"ok": True, "already_complete": False, "company": args["company_name"]}


def configure_defaults(company: str, price_list: str = "Standard Selling", allow_negative_stock: int = 0):
    """Settings the gateway relies on: customers named by name, a selling price list, stock rules."""
    selling = frappe.get_single("Selling Settings")
    selling.cust_master_name = "Customer Name"
    if frappe.db.exists("Price List", price_list):
        selling.selling_price_list = price_list
    selling.save(ignore_permissions=True)
    stock = frappe.get_single("Stock Settings")
    stock.allow_negative_stock = cint(allow_negative_stock)
    stock.save(ignore_permissions=True)
    frappe.db.commit()
    return {"ok": True, "company": company}


def ensure_gateway_user(email: str, full_name: str = "Savingroup Gateway", rotate: int = 1, admin: int = 0):
    """The user Savingroup authenticates as. Never Administrator; standard roles only,
    plus every other standard role when ``admin`` asks for autonomous operation.

    Returns the API key and a fresh secret. The secret cannot be read back later,
    so the caller stores it immediately.
    """
    ensure_roles()
    if frappe.db.exists("User", email):
        user = frappe.get_doc("User", email)
    else:
        user = frappe.get_doc(
            {
                "doctype": "User",
                "email": email,
                "first_name": full_name,
                "user_type": "System User",
                "send_welcome_email": 0,
                "enabled": 1,
            }
        )
        user.flags.ignore_permissions = True
        user.insert()
    have = {row.role for row in user.roles}
    for role in GATEWAY_ROLES:
        if role not in have and frappe.db.exists("Role", role):
            user.append("roles", {"role": role})
    if cint(admin):
        have = {row.role for row in user.roles}
        for role in _admin_roles():
            if role not in have:
                user.append("roles", {"role": role})
    if not user.api_key:
        user.api_key = frappe.generate_hash(length=15)
    api_secret = None
    if cint(rotate) or not frappe.db.get_value("User", email, "api_secret"):
        api_secret = frappe.generate_hash(length=15)
        user.api_secret = api_secret
    user.flags.ignore_permissions = True
    user.save()
    frappe.db.commit()
    result = {"email": email, "api_key": user.api_key, "api_secret": api_secret}
    print(json.dumps(result))
    return result


def _admin_roles() -> list[str]:
    """Every enabled role except Administrator's own; Guest and All are implicit."""
    return frappe.get_all(
        "Role",
        filters={"disabled": 0, "name": ["not in", ["Administrator", "Guest", "All"]]},
        pluck="name",
        order_by="name asc",
    )


def grant_admin(email: str):
    """The one-time site-side grant for autonomous operation: the gateway user
    receives every standard role, System Manager included, so the Operator can
    administer the site through the bridge's ``admin.*`` actions. Still never
    Administrator; ``revoke_admin`` undoes it.
    """
    if not frappe.db.exists("User", email):
        frappe.throw(f"User {email} does not exist; run ensure_gateway_user first.")
    user = frappe.get_doc("User", email)
    have = {row.role for row in user.roles}
    added = [role for role in _admin_roles() if role not in have]
    for role in added:
        user.append("roles", {"role": role})
    user.flags.ignore_permissions = True
    user.save()
    frappe.db.commit()
    result = {"email": email, "added": added, "roles": sorted(have | set(added))}
    print(json.dumps(result))
    return result


def revoke_admin(email: str):
    """Back to the standard gateway roles."""
    user = frappe.get_doc("User", email)
    keep = set(GATEWAY_ROLES)
    removed = sorted(row.role for row in user.roles if row.role not in keep)
    user.set("roles", [row for row in user.roles if row.role in keep])
    user.flags.ignore_permissions = True
    user.save()
    frappe.db.commit()
    result = {"email": email, "removed": removed, "roles": sorted(row.role for row in user.roles)}
    print(json.dumps(result))
    return result
