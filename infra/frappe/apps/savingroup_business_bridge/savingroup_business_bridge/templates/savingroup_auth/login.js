// Sign-in page behaviour on top of Frappe's login.js, which is included just
// before this file and still sends every request, routes between views and
// reports errors. Everything here adapts its output to this page's markup.
(function () {
	"use strict";

	var TEXT = {
		show: {{ _("Show password") | tojson }},
		hide: {{ _("Hide password") | tojson }},
		verifyTitle: {{ _("Two-step verification") | tojson }},
		codeLabel: {{ _("Verification code") | tojson }},
		codeRequired: {{ _("Enter the verification code.") | tojson }},
	};
	var ROUTES = ["login", "email", "steptwo", "forgot", "signup", "login_with_email_link"];

	function visibleSection() {
		return $("section.rk-view:visible").first();
	}

	function fromTemplate(id) {
		var template = document.getElementById(id);
		return $(template ? template.innerHTML : "");
	}

	// This page has one sign-in form; Frappe's separate "email" view is that form.
	login.email = function () {
		login.login();
		$("#login_email").trigger("focus");
	};

	// A hash login.js has no view for falls back to sign in instead of throwing.
	var route = login.route;
	login.route = function () {
		var name = (window.location.hash.slice(1) || "login").replace(/-/g, "_");
		if (ROUTES.indexOf(name) === -1) {
			history.replaceState(null, "", window.location.pathname + window.location.search);
		}
		route.apply(this, arguments);
		focusView();
	};

	function focusView() {
		var $section = visibleSection();
		if (!$section.length || $.contains($section[0], document.activeElement)) return;
		var $inputs = $section.find("input:visible");
		var $empty = $inputs.filter(function () {
			return !this.value;
		});
		($empty.length ? $empty : $inputs).first().trigger("focus");
	}

	// login.js flips the field type on .toggle-password; keep the button's state
	// readable, and keep the caret in the field when the button is clicked.
	$(document)
		.on("mousedown", ".rk-reveal", function (event) {
			event.preventDefault();
		})
		.on("click", ".rk-reveal", function () {
			var input = document.querySelector(this.getAttribute("toggle"));
			var shown = !!input && input.type === "text";
			this.setAttribute("aria-pressed", String(shown));
			this.setAttribute("aria-label", shown ? TEXT.hide : TEXT.show);
		});

	$(document)
		.on("keydown keyup", ".rk-input--secret", function (event) {
			var native = event.originalEvent;
			if (!native || typeof native.getModifierState !== "function") return;
			$(this)
				.closest(".form-group")
				.find(".rk-caps")
				.toggleClass("hidden", !native.getModifierState("CapsLock"));
		})
		.on("blur", ".rk-input--secret", function () {
			$(this).closest(".form-group").find(".rk-caps").addClass("hidden");
		});

	$(document).on("input", "#login_token", function () {
		$(this).closest(".form-group").removeClass("invalid").find(".field-error").text("");
		$(this).closest(".page-card-body").removeClass("invalid").find(".login-error-banner").addClass("hidden");
	});

	// Runs before login.js's own submit handlers: a second Enter while a request
	// is in flight sends nothing, and a pasted code loses its spaces.
	document.addEventListener(
		"submit",
		function (event) {
			var form = event.target;
			if (!(form instanceof HTMLFormElement)) return;
			if (form.querySelector('[aria-busy="true"]')) {
				event.preventDefault();
				event.stopImmediatePropagation();
				return;
			}
			if (!form.classList.contains("form-verify")) return;
			var input = form.querySelector("#login_token");
			if (!input) return;
			input.value = input.value.replace(/\s+/g, "");
			if (!input.value) {
				event.preventDefault();
				event.stopImmediatePropagation();
				login.show_field_error("login_token", TEXT.codeRequired);
				input.focus();
			}
		},
		true
	);

	// Server messages land in the open view's banner instead of a dialog; a
	// message the banner already shows is not repeated.
	var nativeMsgprint = frappe.msgprint;
	frappe.msgprint = function (message) {
		var parts = messageParts(message);
		var text = parts
			.map(function (part) {
				return part.text;
			})
			.filter(Boolean)
			.join(" ");
		var $section = visibleSection();
		var $error = $section.find(".login-error-banner").first();
		if (!text || !$error.length) return nativeMsgprint.apply(this, arguments);
		var success = parts.every(function (part) {
			return part.indicator === "green";
		});
		var $success = $section.find(".login-success-banner").first();
		var $banner = success && $success.length ? $success : $error;
		var $title = $banner.find(".es-alert__title");
		if (!$banner.hasClass("hidden") && $.trim($title.text()) === text) return;
		$section.find(".login-error-banner, .login-success-banner").addClass("hidden");
		$title.text(text);
		$banner.removeClass("hidden");
	};

	function messageParts(message) {
		if (message === null || message === undefined) return [];
		if (Array.isArray(message)) {
			return message.reduce(function (all, item) {
				return all.concat(messageParts(item));
			}, []);
		}
		if (typeof message === "object") {
			return [{ text: plainText(message.message), indicator: message.indicator || "" }];
		}
		var value = String(message);
		try {
			var parsed = JSON.parse(value);
			if (parsed && typeof parsed === "object") return messageParts(parsed);
		} catch (error) {
			// Plain text, not a serialized server message.
		}
		return [{ text: plainText(value), indicator: "" }];
	}

	function plainText(html) {
		if (html === null || html === undefined) return "";
		var doc = new DOMParser().parseFromString(String(html), "text/html");
		return $.trim(doc.body.textContent || "");
	}

	// Two-step verification: login.js swaps the view for its own form; give it
	// this page's heading, label, error banner and a numeric code field.
	["continue_otp_app", "continue_sms", "continue_email"].forEach(function (name) {
		var original = window[name];
		if (typeof original !== "function") return;
		window[name] = function () {
			var result = original.apply(this, arguments);
			enhanceVerification();
			return result;
		};
	});

	function enhanceVerification() {
		var $root = $("#twofactor_div");
		if (!$root.length || $root.hasClass("rk-verify")) return;
		$root.addClass("rk-verify");
		var $form = $root.find("form.form-verify").addClass("rk-form").attr("novalidate", "novalidate");
		var $prompt = $root.find("#otp_div").addClass("page-card-subtitle rk-subtitle");
		var $input = $root
			.find("#login_token")
			.removeClass("form-control")
			.addClass("rk-input rk-input--code")
			.removeAttr("placeholder")
			.attr({
				inputmode: "numeric",
				autocomplete: "one-time-code",
				autocapitalize: "off",
				spellcheck: "false",
				"aria-describedby": "login_token_error",
			});
		var $button = $root
			.find("#verify_token")
			.removeClass("mt-3 w-full")
			.addClass("rk-btn rk-btn--primary")
			.attr("type", "submit");
		var $head = $('<div class="page-card-head rk-head"></div>')
			.append(fromTemplate("rk-tpl-verify-badge"))
			.append($('<h1 class="rk-title"></h1>').text(TEXT.verifyTitle))
			.append($prompt);
		var $field = $('<div class="form-group rk-field"></div>')
			.append($('<label class="rk-label" for="login_token"></label>').text(TEXT.codeLabel))
			.append($input)
			.append('<p class="field-error" id="login_token_error"></p>');
		var $body = $('<div class="page-card-body rk-fields"></div>')
			.append(fromTemplate("rk-tpl-error-banner"))
			.append($field);
		var $actions = $('<div class="page-card-actions rk-actions"></div>').append($button);
		$form.children().remove();
		$form.append($head, $body, $actions);
		var $back = fromTemplate("rk-tpl-verify-back");
		$back.find("a").attr("href", window.location.pathname + window.location.search);
		$root.append($back);
		$input.trigger("focus");
	}
})();
