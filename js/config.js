// js/config.example.js
//
// Copy this file to js/config.js and fill in your project's PUBLIC values.
//
// SAFE to put here (public by design):
//   - SUPABASE_URL        (your project's REST endpoint)
//   - SUPABASE_ANON_KEY   (the "anon" / "public" key from Supabase Settings > API)
//
// NEVER put here, ever:
//   - SUPABASE_SERVICE_ROLE_KEY
//   - any SMS/OTP provider secret
//   - any signing key
// Those belong ONLY in Supabase Edge Function secrets:
//   supabase secrets set SUPABASE_SERVICE_ROLE_KEY=...
//
// js/config.js is gitignored — see .gitignore in the project root.

export const SUPABASE_URL = "https://wgzeybxogurhvjcainbh.supabase.co";
export const SUPABASE_ANON_KEY = "sb_publishable_dK81DQO8Tgu1ii165ccNiA_JxIutD_d";

// Base URL where this site is deployed (GitHub Pages), used to build share
// links, e.g. "https://yourusername.github.io/birthday-purpose"
export const SITE_URL = "https://yourusername.github.io/birthday-purpose";

// Edge Function names (rarely need to change these)
export const FUNCTIONS = {
  createMoment: "create-moment",
  publishMoment: "publish-moment",
  getMoment: "get-moment",
};
