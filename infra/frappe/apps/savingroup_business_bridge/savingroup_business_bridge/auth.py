"""Shared context for the sign-in pages this app serves in place of Frappe's
(`www/login`, `www/update-password`, `www/message`).

Only the pages change. Every request they make still goes to Frappe
(`/api/method/login`, `frappe.www.login.*`, `frappe.core.doctype.user.user.*`),
so rate limits, two-factor, email links, social and LDAP sign-in behave exactly
as Frappe defines them. The pages carry the organization's own name and logo
from Website Settings and the layout of Savingroup's own sign-in.
"""

from urllib.parse import quote, urlparse

import frappe
from frappe import _
from frappe.utils import escape_html, now_datetime

BODY_CLASS = "rk-auth-page"


def apply(context, destination: str | None = None, panel: bool = True) -> None:
    """Add the branding, layout and destination keys every sign-in page reads."""
    organization = organization_name()
    logo = custom_logo()
    monogram = (organization.strip()[:1] or "R").upper()
    context.rk_org = organization
    context.rk_logo = logo
    context.rk_monogram = monogram
    context.rk_copyright = copyright_line(context.get("copyright") or organization)
    context.rk_panel = panel
    context.rk_destination = destination
    context.rk_apps = workspace_apps(destination) if panel else []
    # After a successful sign-in Frappe's login.js replaces the page with its
    # splash screen, which falls back to the framework's logo.
    context.splash_image = logo or monogram_image(monogram)
    context.body_class = " ".join(part for part in (context.get("body_class"), BODY_CLASS) if part)
    context.no_header = True
    context.no_breadcrumbs = True


def organization_name() -> str:
    return (
        frappe.get_website_settings("app_name")
        or frappe.defaults.get_global_default("company")
        or frappe.get_system_settings("app_name")
        or "Savingroup"
    )


def custom_logo() -> str | None:
    """The organization's logo, never a framework or app logo."""
    logo = frappe.get_website_settings("app_logo") or frappe.get_cached_value(
        "Navbar Settings", "Navbar Settings", "app_logo"
    )
    if not logo and "erpnext" in frappe.get_installed_apps():
        company = frappe.defaults.get_global_default("company")
        if company:
            logo = frappe.db.get_value("Company", company, "company_logo")
    return logo or None


def copyright_line(holder: str) -> str:
    holder = holder.strip()
    if holder.startswith("©"):
        return holder
    return f"© {now_datetime().year} {holder}"


def destination_for(redirect_to: str | None) -> str | None:
    """Which app a sign-in continues to, from the page's `redirect-to`."""
    path = urlparse(redirect_to or "").path.rstrip("/")
    if path == "/crm" or path.startswith("/crm/"):
        return "crm"
    if path in ("/desk", "/app") or path.startswith(("/desk/", "/app/")):
        return "erp"
    return None


def sign_in_subtitle(organization: str, destination: str | None) -> str:
    label = {"crm": _("CRM"), "erp": _("ERP")}.get(destination)
    if label:
        return _("Continue to {0}").format(f"{organization} {label}")
    return _("Use your {0} account").format(organization)


def workspace_apps(destination: str | None) -> list:
    """The apps on this site, in the order the sign-in panel lists them."""
    installed = set(frappe.get_installed_apps())
    apps = []
    if "crm" in installed:
        apps.append(_app("crm", "users", _("CRM"), _("Leads, deals and follow-ups"), destination))
    if "erpnext" in installed:
        apps.append(_app("erp", "package", _("ERP"), _("Orders, stock, invoices and accounts"), destination))
    if "india_compliance" in installed:
        apps.append(_app("gst", "receipt", _("GST"), _("Returns, e-invoices and e-way bills"), destination))
    if "hrms" in installed:
        apps.append(_app("hr", "id-card", _("HR"), _("People, leave and payroll"), destination))
    if "helpdesk" in installed:
        apps.append(
            _app("helpdesk", "life-buoy", _("Helpdesk"), _("Tickets and service levels"), destination)
        )
    return apps


def _app(key: str, icon: str, title: str, description: str, destination: str | None):
    return frappe._dict(key=key, icon=icon, title=title, description=description, current=key == destination)


def monogram_image(letter: str) -> str:
    """A data URI of the organization's initial, for sites without a logo.

    Fully percent-encoded: login.js inserts it into a JavaScript template literal."""
    svg = (
        '<svg xmlns="http://www.w3.org/2000/svg" width="96" height="96" viewBox="0 0 96 96">'
        '<rect width="96" height="96" rx="24" fill="#1a1a1a"/>'
        '<text x="48" y="63" text-anchor="middle" font-family="Inter, Arial, sans-serif" '
        f'font-size="44" font-weight="600" fill="#f9f9f7">{escape_html(letter)}</text></svg>'
    )
    return "data:image/svg+xml," + quote(svg, safe="")


def update_website_context(context) -> None:
    """`update_website_context` hook. Frappe's not-permitted page renders
    www/message.html with Frappe's own message controller, so this app's
    controller never adds the keys the template reads."""
    if context.get("template") == "www/message.html" and "rk_heading" not in context:
        from savingroup_business_bridge.www.message import add_context

        add_context(context)
