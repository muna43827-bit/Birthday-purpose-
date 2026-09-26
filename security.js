// js/security.js
//
// Client-side validation & sanitization helpers.
//
// IMPORTANT: everything in this file is UX convenience, NOT security.
// The server (Edge Functions + RLS) re-validates everything independently
// and is the actual source of truth — a malicious user can bypass this
// entire file by editing JS in devtools, and the backend must still hold.

const YOUTUBE_ID_RE = /^[A-Za-z0-9_-]{11}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const E164_RE = /^\+[1-9]\d{6,14}$/;

export function isValidEmail(value) {
  return typeof value === "string" && EMAIL_RE.test(value) && value.length <= 254;
}

export function isValidPhone(value) {
  return typeof value === "string" && E164_RE.test(value);
}

/** Minimum: 8 chars, one letter, one number. Supabase also enforces its own minimum server-side. */
export function isValidPassword(value) {
  return typeof value === "string" && value.length >= 8 && /[A-Za-z]/.test(value) && /[0-9]/.test(value);
}

/** Extract a YouTube video ID from watch / youtu.be / shorts URLs. Returns null if invalid. */
export function extractYouTubeId(url) {
  if (typeof url !== "string" || url.length === 0) return null;
  let parsed;
  try {
    parsed = new URL(url.trim());
  } catch {
    return null;
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return null;

  if (parsed.hostname === "youtu.be" || parsed.hostname === "www.youtu.be") {
    const id = parsed.pathname.slice(1).split("/")[0];
    return YOUTUBE_ID_RE.test(id) ? id : null;
  }
  if (parsed.hostname.includes("youtube.com")) {
    if (parsed.pathname === "/watch") {
      const id = parsed.searchParams.get("v");
      return id && YOUTUBE_ID_RE.test(id) ? id : null;
    }
    const shortsMatch = parsed.pathname.match(/^\/shorts\/([A-Za-z0-9_-]{11})/);
    if (shortsMatch) return shortsMatch[1];
  }
  return null;
}

/** Safely set text content — never use innerHTML for user-entered strings. */
export function setText(el, value) {
  el.textContent = value ?? "";
}

/** Strip control characters and cap length. Used before sending to the server too. */
export function cleanText(value, maxLen = 2000) {
  if (typeof value !== "string") return "";
  return value.replace(/[\u0000-\u001F\u007F]/g, "").trim().slice(0, maxLen);
}

const ALLOWED_IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);
const MAX_IMAGE_BYTES = 8 * 1024 * 1024; // 8 MB

export function validateImageFile(file) {
  if (!file) return { ok: false, error: "No file selected." };
  if (!ALLOWED_IMAGE_TYPES.has(file.type)) {
    return { ok: false, error: "Please upload a JPG, PNG, WEBP, or GIF image." };
  }
  if (file.size > MAX_IMAGE_BYTES) {
    return { ok: false, error: "Image must be smaller than 8 MB." };
  }
  return { ok: true };
}

/** Generate a safe, collision-resistant storage filename — never trust the original filename. */
export function safeStorageName(originalFile) {
  const ext = (originalFile.name.split(".").pop() || "jpg").toLowerCase().replace(/[^a-z0-9]/g, "");
  const random = crypto.randomUUID();
  return `${random}.${ext || "jpg"}`;
}

/** User-friendly error message — never surface raw server/SQL errors. */
export function friendlyError(context = "Something went wrong") {
  return `${context}. Please try again in a moment.`;
}
