"""Set, reset or change a password: Frappe's page and API, the organization's brand.

The page reads the reset key up front, so a used or expired link says so before
anyone types a password, and a first password after an invitation reads as
setting up the account rather than as a reset. Saving still goes through
`frappe.core.doctype.user.user.update_password`, which checks the key again."""

from datetime import timedelta

import frappe
from frappe import _
from frappe.utils import cint, escape_html, get_datetime, now_datetime
from frappe.utils.data import sha256_hash
from frappe.www import update_password as frappe_update_password

from savingroup_business_bridge import auth

no_cache = 1


def get_context(context):
    frappe_update_password.get_context(context)
    auth.apply(context)
    state, email = _state(frappe.form_dict.get("key"))
    account = frappe.bold(escape_html(email)) if email else ""
    if state == "reset" and frappe.form_dict.get("password_expired"):
        reset_subtitle = _("Your password has expired. Choose a new one for {0}.").format(account)
    else:
        reset_subtitle = _("You're choosing a new password for {0}.").format(account)
    title, subtitle, submit = {
        "setup": (
            _("Set up your account"),
            _("Choose a password for {0}.").format(account),
            _("Save and continue"),
        ),
        "reset": (_("Choose a new password"), reset_subtitle, _("Save new password")),
        "change": (_("Change your password"), _("Signed in as {0}.").format(account), _("Update password")),
        "signin": (
            _("Sign in to change your password"),
            _("Sign in first, or open the reset link from your email."),
            None,
        ),
        "invalid": (
            _("This link is no longer valid"),
            _("Reset links work once. Request a new one and open the most recent email."),
            None,
        ),
        "expired": (
            _("This link has expired"),
            _("For your security, reset links expire. Request a new one."),
            None,
        ),
    }[state]
    context.title = title
    context.rk_title = title
    context.rk_state = state
    context.rk_email = email
    context.rk_subtitle = subtitle
    context.rk_submit = submit
    if state == "change":
        system_user = frappe.get_cached_value("User", frappe.session.user, "user_type") == "System User"
        context.rk_back = ("/desk" if system_user else "/me", _("Back"))
    else:
        context.rk_back = ("/login", _("Back to sign in"))
    context.rk_password_policy = {
        "enabled": bool(cint(frappe.get_system_settings("enable_password_policy"))),
        "minimumScore": cint(frappe.get_system_settings("minimum_password_score")),
    }
    return context


def _state(key: str | None) -> tuple[str, str | None]:
    """The page's state and the account it is for, as update_password will judge the key."""
    if not key:
        if frappe.session.user == "Guest":
            return "signin", None
        return "change", frappe.db.get_value("User", frappe.session.user, "email") or frappe.session.user
    user = frappe.db.get_value(
        "User",
        {"reset_password_key": sha256_hash(key)},
        ["name", "email", "enabled", "last_login", "last_reset_password_key_generated_on"],
        as_dict=True,
    )
    if not user or not user.enabled:
        return "invalid", None
    expiry = cint(frappe.get_system_settings("reset_password_link_expiry_duration"))
    generated = user.last_reset_password_key_generated_on
    if expiry and generated and now_datetime() > get_datetime(generated) + timedelta(seconds=expiry):
        return "expired", None
    return ("reset" if user.last_login else "setup"), user.email or user.name
