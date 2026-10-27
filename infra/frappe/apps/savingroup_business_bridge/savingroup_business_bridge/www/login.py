"""The site's sign-in page: Frappe's context and requests, the organization's brand.

Frappe's whitelisted sign-in methods stay in `frappe.www.login`; this module only
adds what the page shows (savingroup_business_bridge.auth)."""

import frappe
from frappe import _
from frappe.utils import cint
from frappe.www import login as frappe_login

from savingroup_business_bridge import auth

no_cache = True


def get_context(context):
    context = frappe_login.get_context(context) or context
    redirect_to = frappe_login.sanitize_redirect(frappe.local.request.args.get("redirect-to"))
    destination = auth.destination_for(redirect_to)
    auth.apply(context, destination=destination)
    context.title = _("Sign in")
    context.rk_subtitle = auth.sign_in_subtitle(context.rk_org, destination)
    context.rk_custom_signup_form = bool(frappe.get_hooks("signup_form_template"))
    context.rk_link_expiry = cint(frappe.get_system_settings("login_with_email_link_expiry")) or 10
    return context
