// PromptPad — Discover backend configuration.
// Fill these in ONCE after the guided setup (see discover-setup/DISCOVER-SETUP.md).
//
// Both come from Supabase → Project Settings → API.
// The anon key is a PUBLIC key — safe to ship. Row-Level Security protects data.
//
// Until both are filled in, the Discover tab shows a "not set up yet" notice.
window.DISCOVER_CONFIG = {
  SUPABASE_URL: 'https://gjudxcyoboyqiondmouz.supabase.co',
  SUPABASE_ANON_KEY: 'sb_publishable_IsfkF6NgXLabyve1UTjMfA_nWRiya86',
  // Storage bucket for uploaded images (created during setup). Public-read.
  IMAGE_BUCKET: 'discover-images'
};

window.DISCOVER_CONFIGURED = !!(
  window.DISCOVER_CONFIG.SUPABASE_URL &&
  window.DISCOVER_CONFIG.SUPABASE_ANON_KEY
);
