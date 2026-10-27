// Set, reset or change a password through Frappe's update_password, which
// checks the key, the current password and the site's password policy again.
frappe.ready(function () {
	"use strict";

	var form = document.getElementById("reset-password");
	if (!form) return;

	var TEXT = {
		show: {{ _("Show password") | tojson }},
		hide: {{ _("Hide password") | tojson }},
		strength: [
			{{ _("Weak") | tojson }},
			{{ _("Weak") | tojson }},
			{{ _("Fair") | tojson }},
			{{ _("Good") | tojson }},
			{{ _("Strong") | tojson }},
		],
		match: {{ _("Passwords match") | tojson }},
		mismatch: {{ _("Passwords don't match") | tojson }},
		sameAsOld: {{ _("Choose a password different from your current one.") | tojson }},
		stronger: {{ _("Choose a stronger password.") | tojson }},
		saving: {{ _("Saving") | tojson }},
		wrongOld: {{ _("Your current password is incorrect.") | tojson }},
		tooMany: {{ _("Too many attempts. Wait a moment and try again.") | tojson }},
		failed: {{ _("The password could not be saved. Try again.") | tojson }},
		signingIn: {{ _("Signing you in…") | tojson }},
		signInAgain: {{ _("Sign in with your new password.") | tojson }},
	};
	var POLICY = {{ rk_password_policy | tojson }};
	var key = frappe.utils.get_url_arg("key") || "";

	var oldInput = document.getElementById("old_password");
	var newInput = document.getElementById("new_password");
	var confirmInput = document.getElementById("confirm_password");
	var submit = document.getElementById("update");
	var submitLabel = submit.textContent;
	var errorBanner = form.querySelector(".login-error-banner");
	var errorTitle = errorBanner.querySelector(".es-alert__title");
	var strength = document.getElementById("rk-password-strength");
	var policyNote = document.getElementById("rk-password-policy");
	var match = document.getElementById("rk-password-match");
	var rules = form.querySelectorAll("[data-rule]");

	var checked = { value: null, score: null, passed: true, note: "" };
	var checkTimer = null;
	var checkSequence = 0;
	var busy = false;

	function meets(value) {
		return { length: value.length >= 8, variety: /[0-9]|[^A-Za-z0-9]/.test(value) };
	}

	// Used when the site has no password policy, so Frappe returns no score.
	function localScore(value) {
		var kinds = [/[a-z]/, /[A-Z]/, /[0-9]/, /[^A-Za-z0-9]/].filter(function (pattern) {
			return pattern.test(value);
		}).length;
		var score = 0;
		if (value.length >= 8) score += 1;
		if (value.length >= 12) score += 1;
		if (kinds >= 3) score += 1;
		if (value.length >= 16 || (value.length >= 12 && kinds >= 3)) score += 1;
		if (/^(.)\1*$/.test(value) || /^(?:password|qwerty|letmein|welcome|admin|12345)/i.test(value)) score = 0;
		return Math.min(score, 4);
	}

	function showStrength(score) {
		if (score === null || score === undefined || score < 0) {
			strength.classList.add("hidden");
			return;
		}
		strength.classList.remove("hidden");
		strength.setAttribute("data-score", String(score));
		strength.querySelector(".rk-strength__label").textContent = TEXT.strength[score];
	}

	function render() {
		var value = newInput.value;
		var met = meets(value);
		rules.forEach(function (rule) {
			rule.setAttribute("data-met", String(!!met[rule.getAttribute("data-rule")]));
		});

		var checkedNow = POLICY.enabled && checked.value === value;
		if (!value) showStrength(null);
		else if (!POLICY.enabled) showStrength(localScore(value));
		else if (checkedNow && checked.score !== null) showStrength(checked.score);

		var sameAsOld = !!(oldInput && value && oldInput.value === value);
		var note = sameAsOld ? TEXT.sameAsOld : checkedNow && !checked.passed ? checked.note : "";
		policyNote.textContent = note;
		policyNote.classList.toggle("hidden", !note);

		var confirmation = confirmInput.value;
		match.classList.toggle("hidden", !confirmation);
		if (confirmation) {
			var same = confirmation === value;
			match.setAttribute("data-state", same ? "ok" : "no");
			match.querySelector(".rk-match__text").textContent = same ? TEXT.match : TEXT.mismatch;
		}

		var ready =
			met.length &&
			met.variety &&
			confirmation === value &&
			!sameAsOld &&
			!(checkedNow && !checked.passed) &&
			(!oldInput || !!oldInput.value);
		submit.disabled = busy || !ready;
	}

	function scheduleCheck() {
		if (!POLICY.enabled) return;
		clearTimeout(checkTimer);
		var value = newInput.value;
		if (!value) return;
		checkTimer = setTimeout(function () {
			var sequence = ++checkSequence;
			frappe.call({
				type: "POST",
				method: "frappe.core.doctype.user.user.test_password_strength",
				args: { new_password: value },
				error_msg: "#rk-password-sink",
				statusCode: {
					200: function (response) {
						if (sequence !== checkSequence) return;
						var result = (response && response.message) || {};
						var feedback = result.feedback || {};
						checked = {
							value: value,
							score: typeof result.score === "number" ? result.score : null,
							passed: feedback.password_policy_validation_passed !== false,
							note: feedback.warning || (feedback.suggestions || [])[0] || TEXT.stronger,
						};
						render();
					},
				},
			});
		}, 250);
	}

	function hideError() {
		errorBanner.classList.add("hidden");
		errorTitle.textContent = "";
	}

	function showError(message) {
		errorTitle.textContent = message;
		errorBanner.classList.remove("hidden");
	}

	function setBusy(on) {
		busy = on;
		if (on) {
			submit.setAttribute("aria-busy", "true");
			submit.innerHTML = '<span class="es-spinner" aria-hidden="true"></span><span class="rk-visually-hidden"></span>';
			submit.lastChild.textContent = TEXT.saving;
		} else {
			submit.removeAttribute("aria-busy");
			submit.textContent = submitLabel;
		}
	}

	function samePath(target) {
		if (!target || typeof target !== "string") return null;
		try {
			var url = new URL(target, window.location.origin);
			return url.origin === window.location.origin ? url.pathname + url.search + url.hash : null;
		} catch (error) {
			return null;
		}
	}

	function done(target) {
		var next = samePath(target) || "/login";
		var signIn = next === "/login" || next.indexOf("/login?") === 0;
		document.getElementById("rk-password-view").classList.add("hidden");
		document.getElementById("rk-password-done").classList.remove("hidden");
		document.getElementById("rk-password-back").classList.add("hidden");
		document.getElementById("rk-password-done-note").textContent = signIn ? TEXT.signInAgain : TEXT.signingIn;
		document.getElementById("rk-password-done-actions").classList.toggle("hidden", !signIn);
		if (!signIn) {
			setTimeout(function () {
				window.location.assign(next);
			}, 900);
		}
	}

	function expired() {
		document.getElementById("rk-password-view").classList.add("hidden");
		document.getElementById("rk-password-expired").classList.remove("hidden");
	}

	form.addEventListener("submit", function (event) {
		event.preventDefault();
		render();
		if (busy || submit.disabled) return;
		hideError();
		setBusy(true);
		var outcome = { saved: false, message: null, expired: false };
		frappe
			.call({
				type: "POST",
				method: "frappe.core.doctype.user.user.update_password",
				args: {
					key: key,
					old_password: oldInput ? oldInput.value : "",
					new_password: newInput.value,
					logout_all_sessions: 1,
				},
				// Frappe writes server messages (policy feedback) into this element.
				error_msg: "#reset-password .login-error-banner .es-alert__title",
				statusCode: {
					200: function (response) {
						outcome.saved = true;
						done(response && response.message);
					},
					401: function () {
						outcome.message = TEXT.wrongOld;
					},
					410: function () {
						outcome.expired = true;
					},
					429: function () {
						outcome.message = TEXT.tooMany;
					},
				},
			})
			.always(function () {
				if (outcome.saved) return;
				setBusy(false);
				if (outcome.expired) {
					expired();
					return;
				}
				showError(outcome.message || $.trim(errorTitle.textContent) || TEXT.failed);
				render();
			});
	});

	[oldInput, newInput, confirmInput].forEach(function (input) {
		if (!input) return;
		input.addEventListener("input", function () {
			hideError();
			if (input === newInput) scheduleCheck();
			render();
		});
	});

	form.querySelectorAll(".rk-reveal").forEach(function (button) {
		button.addEventListener("mousedown", function (event) {
			event.preventDefault();
		});
		button.addEventListener("click", function () {
			var input = document.querySelector(button.getAttribute("toggle"));
			if (!input) return;
			var show = input.type === "password";
			input.type = show ? "text" : "password";
			button.setAttribute("aria-pressed", String(show));
			button.setAttribute("aria-label", show ? TEXT.hide : TEXT.show);
		});
	});

	form.querySelectorAll(".rk-input--secret").forEach(function (input) {
		var hint = input.closest(".form-group").querySelector(".rk-caps");
		if (!hint) return;
		["keydown", "keyup"].forEach(function (type) {
			input.addEventListener(type, function (event) {
				if (typeof event.getModifierState !== "function") return;
				hint.classList.toggle("hidden", !event.getModifierState("CapsLock"));
			});
		});
		input.addEventListener("blur", function () {
			hint.classList.add("hidden");
		});
	});

	render();
});
