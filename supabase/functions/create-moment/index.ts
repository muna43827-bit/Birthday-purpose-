// supabase/functions/create-moment/index.ts
//
// Creates or updates a draft moment + its pages on behalf of the
// authenticated creator. Runs server-side so creator_id is ALWAYS derived
// from the caller's verified JWT — never trusted from the request body.
//
// Deploy: supabase functions deploy create-moment
// Secrets required: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY

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

const ALLOWED_RELATIONSHIPS = new Set([
  "friend_male", "friend_female", "girlfriend", "boyfriend",
  "mummy", "papa", "brother", "sister", "bua", "mami", "custom",
]);

const YOUTUBE_ID_RE = /^[A-Za-z0-9_-]{11}$/;

function extractYouTubeId(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    const u = new URL(url);
    if (u.hostname === "youtu.be") {
      const id = u.pathname.slice(1);
      return YOUTUBE_ID_RE.test(id) ? id : null;
    }
    if (u.hostname.includes("youtube.com")) {
      if (u.pathname === "/watch") {
        const id = u.searchParams.get("v");
        return id && YOUTUBE_ID_RE.test(id) ? id : null;
      }
      const shortsMatch = u.pathname.match(/^\/shorts\/([A-Za-z0-9_-]{11})/);
      if (shortsMatch) return shortsMatch[1];
    }
    return null;
  } catch {
    return null;
  }
}

// Strict text sanitation: strip control chars, cap length. Rendering must
// still use textContent (never innerHTML) on the frontend — this is
// defense-in-depth, not the only line of protection.
function cleanText(v: unknown, maxLen: number): string | null {
  if (typeof v !== "string") return null;
  const stripped = v.replace(/[\u0000-\u001F\u007F]/g, "").trim();
  if (stripped.length === 0) return null;
  return stripped.slice(0, maxLen);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const authHeader = req.headers.get("Authorization") ?? "";
  const jwt = authHeader.replace(/^Bearer\s+/i, "");
  if (!jwt) return json({ error: "Missing authorization" }, 401);

  // Verify the caller's JWT using the anon client bound to their token —
  // this is how we derive a trustworthy user id, never from the body.
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

  const { moment_id, type, relationship, recipient_name, creator_name, pages } = body ?? {};

  if (type !== "birthday" && type !== "purpose") {
    return json({ error: "type must be 'birthday' or 'purpose'" }, 400);
  }
  if (!ALLOWED_RELATIONSHIPS.has(relationship)) {
    return json({ error: "Invalid relationship" }, 400);
  }
  const cleanRecipient = cleanText(recipient_name, 100);
  const cleanCreator = cleanText(creator_name, 100);
  if (!cleanRecipient || !cleanCreator) {
    return json({ error: "recipient_name and creator_name are required" }, 400);
  }
  if (!Array.isArray(pages) || pages.length === 0 || pages.length > 10) {
    return json({ error: "pages must be an array of 1-10 page objects" }, 400);
  }

  let momentId = moment_id as string | undefined;

  if (momentId) {
    // Update path — RLS still applies as a second layer even though we use
    // the service role, because we explicitly filter by creator_id below.
    const { data: existing, error: fetchErr } = await admin
      .from("moments")
      .select("id, creator_id, status")
      .eq("id", momentId)
      .maybeSingle();

    if (fetchErr || !existing || existing.creator_id !== creatorId) {
      return json({ error: "Moment not found" }, 404);
    }
    if (existing.status === "published") {
      return json({ error: "Published moments cannot be edited. Unpublish first." }, 409);
    }

    const { error: updateErr } = await admin
      .from("moments")
      .update({
        relationship,
        recipient_name: cleanRecipient,
        creator_name: cleanCreator,
      })
      .eq("id", momentId)
      .eq("creator_id", creatorId);

    if (updateErr) return json({ error: "Could not update moment" }, 500);
  } else {
    const { data: created, error: insertErr } = await admin
      .from("moments")
      .insert({
        creator_id: creatorId,
        type,
        relationship,
        recipient_name: cleanRecipient,
        creator_name: cleanCreator,
        status: "draft",
        public_token: null, // assigned only at publish time
      })
      .select("id")
      .single();

    if (insertErr || !created) {
      return json({ error: "Could not create moment" }, 500);
    }
    momentId = created.id;
    await admin.from("security_events").insert({
      event_type: "moment_created",
      user_id: creatorId,
      metadata: { moment_id: momentId, type },
    });
  }

  // Upsert pages 1..N, validating each field server-side.
  for (const p of pages) {
    const pageNumber = Number(p.page_number);
    if (!Number.isInteger(pageNumber) || pageNumber < 1 || pageNumber > 10) {
      return json({ error: `Invalid page_number: ${p.page_number}` }, 400);
    }

    const youtubeId = p.youtube_url ? extractYouTubeId(p.youtube_url) : (p.youtube_video_id ?? null);
    if (p.youtube_url && !youtubeId) {
      return json({ error: `Invalid YouTube URL on page ${pageNumber}` }, 400);
    }

    const { error: pageErr } = await admin
      .from("moment_pages")
      .upsert(
        {
          moment_id: momentId,
          page_number: pageNumber,
          title: cleanText(p.title, 120),
          message: cleanText(p.message, 2000),
          animation: cleanText(p.animation, 60),
          photo_asset_id: p.photo_asset_id ?? null,
          youtube_video_id: youtubeId,
          settings: typeof p.settings === "object" && p.settings !== null ? p.settings : {},
        },
        { onConflict: "moment_id,page_number" },
      );

    if (pageErr) {
      return json({ error: `Could not save page ${pageNumber}` }, 500);
    }
  }

  return json({ ok: true, moment_id: momentId });
});
