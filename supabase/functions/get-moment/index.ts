// supabase/functions/get-moment/index.ts
//
// The ONLY way a recipient's browser can read moment content. RLS on the
// `moments` / `moment_pages` tables has NO public select policy, so this
// service-role function is the sole path — meaning we fully control what a
// public_token can see: no creator_id, no email, no internal moment id.
//
// Deploy: supabase functions deploy get-moment --no-verify-jwt
// (recipients are unauthenticated, so JWT verification must be disabled
// for this function specifically — access control comes from the token.)
// Secrets required: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

// Very simple in-memory-per-instance rate limiter as a first line of
// defense; edge instances are ephemeral so this is a supplement to, not a
// replacement for, the request-count check against security_events below.
const TOKEN_RE = /^[A-Za-z0-9]{6,16}$/;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const url = new URL(req.url);
  const token = req.method === "GET" ? url.searchParams.get("token") : (await req.json().catch(() => ({})))?.token;

  if (typeof token !== "string" || !TOKEN_RE.test(token)) {
    await admin.from("security_events").insert({
      event_type: "invalid_token",
      metadata: { reason: "malformed" },
    });
    return json({ error: "not_found" }, 404);
  }

  const { data: moment, error } = await admin
    .from("moments")
    .select("id, type, relationship, recipient_name, creator_name, status, expires_at")
    .eq("public_token", token)
    .maybeSingle();

  if (error || !moment) {
    await admin.from("security_events").insert({
      event_type: "invalid_token",
      metadata: { reason: "no_match" },
    });
    return json({ error: "not_found" }, 404);
  }

  if (moment.status !== "published") {
    return json({ error: "not_found" }, 404);
  }

  if (moment.expires_at && new Date(moment.expires_at) < new Date()) {
    return json({ error: "expired" }, 410);
  }

  const { data: pages } = await admin
    .from("moment_pages")
    .select("page_number, title, message, animation, photo_asset_id, youtube_video_id, settings")
    .eq("moment_id", moment.id)
    .order("page_number", { ascending: true });

  // Resolve photo assets to short-lived signed URLs — never a public bucket
  // URL, never the raw storage path.
  const pagesWithPhotos = await Promise.all(
    (pages ?? []).map(async (p) => {
      if (!p.photo_asset_id) return { ...p, photo_url: null, photo_asset_id: undefined };
      const { data: asset } = await admin
        .from("moment_assets")
        .select("storage_path")
        .eq("id", p.photo_asset_id)
        .maybeSingle();
      if (!asset) return { ...p, photo_url: null, photo_asset_id: undefined };
      const { data: signed } = await admin.storage
        .from("moment-assets")
        .createSignedUrl(asset.storage_path, 3600); // 1 hour
      return { ...p, photo_url: signed?.signedUrl ?? null, photo_asset_id: undefined };
    }),
  );

  return json({
    type: moment.type,
    relationship: moment.relationship,
    recipient_name: moment.recipient_name,
    creator_name: moment.creator_name,
    pages: pagesWithPhotos,
  });
});
