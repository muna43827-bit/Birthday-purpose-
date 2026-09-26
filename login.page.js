// js/login.page.js
import { signIn, signUp, sendPasswordReset, getSession } from "./auth.js";
import { isValidEmail, isValidPassword, setText } from "./security.js";
import { initParticles } from "./particles.js";

initParticles("particles", { count: 46, color: "232, 200, 116", speed: 0.18 });

getSession().then((session) => {
  if (session) window.location.href = "/dashboard.html";
});

const els = {
  loginSub: document.getElementById("loginSub"),
  modeBtns: document.querySelectorAll(".channel-btn"),
  nameField: document.getElementById("nameField"),
  nameInput: document.getElementById("nameInput"),
  emailInput: document.getElementById("emailInput"),
  passwordInput: document.getElementById("passwordInput"),
  passwordHint: document.getElementById("passwordHint"),
  formError: document.getElementById("formError"),
  submitBtn: document.getElementById("submitBtn"),
  forgotBtn: document.getElementById("forgotBtn"),
  loadingRow: document.getElementById("loadingRow"),
};

let mode = "signin"; // "signin" | "signup"

function setLoading(isLoading) {
  els.loadingRow.classList.toggle("is-hidden", !isLoading);
  els.submitBtn.disabled = isLoading;
}

function applyMode() {
  const isSignup = mode === "signup";
  els.nameField.classList.toggle("is-hidden", !isSignup);
  els.passwordInput.autocomplete = isSignup ? "new-password" : "current-password";
  els.passwordHint.textContent = isSignup ? "At least 8 characters, with a letter and a number." : "";
  els.submitBtn.textContent = isSignup ? "Create Account" : "Sign In";
  els.loginSub.textContent = isSignup
    ? "Create an account to start making moments"
    : "Sign in to create something unforgettable";
  els.forgotBtn.classList.toggle("is-hidden", isSignup);
  setText(els.formError, "");
}

els.modeBtns.forEach((btn) => {
  btn.addEventListener("click", () => {
    mode = btn.dataset.mode;
    els.modeBtns.forEach((b) => {
      b.classList.toggle("is-active", b === btn);
      b.setAttribute("aria-selected", String(b === btn));
    });
    applyMode();
  });
});
applyMode();

els.submitBtn.addEventListener("click", async () => {
  const email = els.emailInput.value.trim();
  const password = els.passwordInput.value;
  setText(els.formError, "");

  if (!isValidEmail(email)) {
    setText(els.formError, "Enter a valid email address.");
    return;
  }

  if (mode === "signup") {
    if (!isValidPassword(password)) {
      setText(els.formError, "Password needs at least 8 characters, with a letter and a number.");
      return;
    }
    setLoading(true);
    const result = await signUp(email, password, els.nameInput.value.trim());
    setLoading(false);

    if (!result.ok) {
      setText(els.formError, result.error || "Could not create account. Please try again.");
      return;
    }
    if (!result.session) {
      // Email confirmation is enabled on this project — no session yet.
      setText(els.formError, "Account created. Check your email to confirm, then sign in.");
      mode = "signin";
      document.querySelector('[data-mode="signin"]').click();
      return;
    }
    window.location.href = "/dashboard.html";
    return;
  }

  // Sign in
  if (password.length === 0) {
    setText(els.formError, "Enter your password.");
    return;
  }
  setLoading(true);
  const result = await signIn(email, password);
  setLoading(false);

  if (!result.ok) {
    setText(els.formError, "Incorrect email or password.");
    return;
  }
  window.location.href = "/dashboard.html";
});

els.forgotBtn.addEventListener("click", async () => {
  const email = els.emailInput.value.trim();
  if (!isValidEmail(email)) {
    setText(els.formError, "Enter your email address first, then tap 'Forgot password?'.");
    return;
  }
  setLoading(true);
  const result = await sendPasswordReset(email);
  setLoading(false);
  setText(
    els.formError,
    result.ok ? "Password reset email sent — check your inbox." : "Could not send reset email.",
  );
});

els.passwordInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") els.submitBtn.click();
});
