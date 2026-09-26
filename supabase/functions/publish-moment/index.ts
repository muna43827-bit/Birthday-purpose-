// supabase/functions/publish-moment/index.ts
//
// Publishes a draft moment: validates it's complete, mints a high-entropy
// public token (never a sequential ID), and flips status -> 'published'.
// Also supports action "unpublish" to revoke a link, and the moment_id is
// always re-checked against the caller's own JWT-derived creator_id.
//
// Deploy: supabase functions deploy publish-moment
// Secrets required: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, SUPABASE_ANON_KEY

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

// Cryptographically random, URL-safe token. 10 chars from a 62-char
// alphabet ~= 59.5 bits of entropy — not guessable, not sequential.
function generateToken(length = 10): string {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  let out = "";
  for (const b of bytes) out += alphabet[b % alphabet.length];
  return out;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const authHeader = req.headers.get("Authorization") ?? "";
  const jwt = authHeader.replace(/^Bearer\s+/i, "");
  if (!jwt) return json({ error: "Missing authorization" }, 401);

  const userClient = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: `Bearer ${jwt}` } },
  });
  const { data: userData, error: userError } = await userClient.auth.getUser();
  if (userError || !userData?.user) {
    return json({ error: "Invalid or expired session" }, 401);
  }
  const creatorId = userData.user.id;

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  let body: any;
  try {
    body = await req.json();
  } catch {
    return json({ error: "Invalid request body" }, 400);
  }

  const { moment_id, action, expires_in_days } = body ?? {};
  if (!moment_id) return json({ error: "moment_id is required" }, 400);

  const { data: moment, error: fetchErr } = await admin
    .from("moments")
    .select("id, creator_id, status, type, recipient_name")
    .eq("id", moment_id)
    .maybeSingle();

  if (fetchErr || !moment || moment.creator_id !== creatorId) {
    return json({ error: "Moment not found" }, 404);
  }

  if (action === "unpublish") {
    await admin.from("moments").update({ status: "revoked" }).eq("id", moment_id);
    await admin.from("security_events").insert({
      event_type: "moment_deleted",
      user_id: creatorId,
      metadata: { moment_id, action: "unpublish" },
    });
    return json({ ok: true, status: "revoked" });
  }

  // --- Publish path ---
  const { count: pageCount } = await admin
    .from("moment_pages")
    .select("id", { count: "exact", head: true })
    .eq("moment_id", moment_id);

  if (!pageCount || pageCount < 1) {
    return json({ error: "This moment has no pages yet. Add content before publishing." }, 400);
  }

  let expiresAt: string | null = null;
  if (typeof expires_in_days === "number" && expires_in_days > 0) {
    expiresAt = new Date(Date.now() + expires_in_days * 86_400_000).toISOString();
  }

  // Retry on the (astronomically unlikely) chance of a token collision.
  let publicToken = "";
  for (let attempt = 0; attempt < 5; attempt++) {
    const candidate = generateToken(10);
    const { data: clash } = await admin
      .from("moments")
      .select("id")
      .eq("public_token", candidate)
      .maybeSingle();
    if (!clash) {
      publicToken = candidate;
      break;
    }
  }
  if (!publicToken) return json({ error: "Could not generate a unique link. Try again." }, 500);

  const { error: publishErr } = await admin
    .from("moments")
    .update({
      status: "published",
      public_token: publicToken,
      published_at: new Date().toISOString(),
      expires_at: expiresAt,
    })
    .eq("id", moment_id)
    .eq("creator_id", creatorId);

  if (publishErr) return json({ error: "Could not publish moment" }, 500);

  await admin.from("security_events").insert({
    event_type: "moment_published",
    user_id: creatorId,
    metadata: { moment_id },
  });

  return json({ ok: true, public_token: publicToken, status: "published" });
});
