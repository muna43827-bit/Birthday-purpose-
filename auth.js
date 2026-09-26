// js/auth.js
//
// Real Supabase Auth with email + password. No OTP, no custom lock table —
// Supabase Auth itself enforces password hashing, session issuing, and
// basic abuse protection (email rate limits) on its own servers. Every
// authenticated call afterwards is verified against the session's JWT,
// never against anything this file sets.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { SUPABASE_URL, SUPABASE_ANON_KEY, FUNCTIONS } from "./config.js";

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: false,
  },
});

const FUNCTIONS_BASE = `${SUPABASE_URL}/functions/v1`;

/** Create a new account. Supabase hashes and stores the password server-side. */
export async function signUp(email, password, displayName) {
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: { data: { display_name: displayName || null } },
  });
  if (error) return { ok: false, error: error.message };
  return { ok: true, session: data.session, user: data.user };
}

/** Sign in with an existing account. */
export async function signIn(email, password) {
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) return { ok: false, error: error.message };
  return { ok: true, session: data.session, user: data.user };
}

export async function sendPasswordReset(email) {
  const { error } = await supabase.auth.resetPasswordForEmail(email, {
    redirectTo: `${window.location.origin}/login.html`,
  });
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

export async function getSession() {
  const { data } = await supabase.auth.getSession();
  return data.session ?? null;
}

export async function requireSession() {
  const session = await getSession();
  if (!session) {
    window.location.href = "/login.html";
    return null;
  }
  return session;
}

export async function signOut() {
  await supabase.auth.signOut();
  window.location.href = "/login.html";
}

/** Attach the current session's access token to a call to an Edge Function. */
export async function authedFetch(functionName, payload, method = "POST") {
  const session = await getSession();
  if (!session) throw new Error("Not authenticated");

  const res = await fetch(`${FUNCTIONS_BASE}/${functionName}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      apikey: SUPABASE_ANON_KEY,
      Authorization: `Bearer ${session.access_token}`,
    },
    body: method === "GET" ? undefined : JSON.stringify(payload),
  });
  const data = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, data };
}
