// =====================================================================
//  Your Supabase project settings. Safe to publish: the PUBLISHABLE key is
//  public by design (security comes from Row Level Security).
//  NEVER put a secret key (sb_secret_...) or the old service_role key here.
// =====================================================================
export const SUPABASE_URL = 'https://fnxvvcwquydgtonbsypz.supabase.co';
export const SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_4Xk5Lj-O4RCcm3_UbZdQ0w_SR1VSSIB'; // starts with sb_publishable_

// Players log in with a USERNAME. Internally Supabase Auth needs an e-mail,
// so we use <username>@<EMAIL_DOMAIN>. No mail is ever sent. This MUST match
// the PLAYER_EMAIL_DOMAIN secret of the admin-players Edge Function.
export const EMAIL_DOMAIN = 'nightcity.local';
