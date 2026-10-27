"""Frappe's message page ("Not Permitted", "Logged Out", expired links, ...) with
the organization's brand.

A guest who opens a page that needs a sign-in (Frappe CRM at /crm, a portal
page) goes straight to the sign-in page, which returns them afterwards, instead
of reading "Not Permitted"."""

import frappe
from frappe import _
from frappe.utils import strip_html_tags
from frappe.www import message as frappe_message

from savingroup_business_bridge import auth

no_cache = 1

TONES = {"red": ("danger", "alert-circle"), "green": ("success", "check-circle")}


def get_context(context):
    message_context = frappe_message.get_context(context)
    add_context(context, message_context)
    return message_context


def add_context(context, message_context=None) -> None:
    """The keys www/message.html reads. Also called from auth.update_website_context
    for Frappe's not-permitted page, which renders this template with Frappe's
    own message controller."""
    source = message_context or context
    auth.apply(context, panel=False)
    # respond_as_web_page and the not-permitted page hand their buttons over here.
    handed = (getattr(frappe.local, "response", None) or {}).get("context") or {}
    primary_action = handed.get("primary_action", source.get("primary_action"))
    indicator = handed.get("indicator_color", source.get("indicator_color"))
    asks_sign_in = isinstance(primary_action, str) and primary_action.startswith("/login")

    heading = strip_html_tags(source.get("header") or source.get("title") or "")
    context.rk_heading = heading or _("Message")
    context.rk_tone, context.rk_icon = TONES.get(indicator, (None, "info"))
    context.rk_redirect = None
    context.rk_text = None
    context.rk_primary = None
    if asks_sign_in and frappe.session.user == "Guest":
        context.rk_redirect = primary_action
        context.rk_heading = _("Sign in to continue")
        context.rk_text = _("This page needs you to sign in first.")
        context.rk_tone, context.rk_icon = None, "lock"
        context.rk_primary = (primary_action, _("Sign in"))
    elif primary_action == "/" and frappe.session.user == "Guest":
        # A guest's home is the sign-in page; say so.
        context.rk_primary = ("/login", _("Sign in"))
    elif asks_sign_in:
        # Signed in already: the sign-in page would only send them back here.
        system_user = frappe.get_cached_value("User", frappe.session.user, "user_type") == "System User"
        context.rk_primary = ("/desk" if system_user else "/", _("Home"))
