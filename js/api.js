// All talking to Supabase lives here. Authorization is enforced by the
// database (RLS + RPCs); nothing in this file is a security boundary.
import { createBackend } from './backend.js';
import { EMAIL_DOMAIN } from './config.js';

export const sb = await createBackend();
const ck = ({ data, error }) => { if (error) throw new Error(error.message || String(error)); return data; };

export const emailFor = (u) => `${String(u).trim().toLowerCase()}@${EMAIL_DOMAIN}`;

// ---------------------------------------------------------------- auth
export async function signIn(username, password) {
  const { error } = await sb.auth.signInWithPassword({ email: emailFor(username), password });
  if (error) throw new Error(/invalid login/i.test(error.message) ? 'Wrong username or password.' : error.message);
}
export const signOut = () => sb.auth.signOut();
export async function session() { const { data } = await sb.auth.getSession(); return data.session; }
export async function myProfile() {
  const s = await session();
  if (!s) return null;
  return ck(await sb.from('profiles').select('*').eq('id', s.user.id).maybeSingle());
}
export const uid = async () => (await session()).user.id;

// ------------------------------------------------------------ settings
export async function p2pEnabled() {
  const rows = ck(await sb.from('settings').select('*').eq('key', 'player_dm_enabled'));
  return rows.length ? rows[0].value === true : false;
}
export async function setP2p(on) {
  ck(await sb.from('settings').update({ value: !!on }).eq('key', 'player_dm_enabled'));
}

// -------------------------------------------------------------- player
export const ensureEnv = async () => ck(await sb.rpc('ensure_my_environment'));
export const listConversations = async () => ck(await sb.from('conversations').select('*').order('last_message_at', { ascending: false }));
export const listContacts = async () => ck(await sb.from('contacts').select('*'));
export const listUnread = async (dirs) => ck(await sb.from('messages').select('id,conversation_id').is('read_at', null).in('direction', dirs).limit(2000));
export const listMessages = async (convId) => ck(await sb.from('messages').select('*').eq('conversation_id', convId).order('created_at', { ascending: true }).limit(500));
export const listSent = async () => ck(await sb.from('messages').select('*').in('direction', ['from_player', 'p2p_out']).order('created_at', { ascending: false }).limit(100));
export const playerSend = async (convId, subject, body) => ck(await sb.rpc('player_send', { p_conversation: convId, p_subject: subject, p_body: body }));
export const playerNewP2p = async (to, subject, body) => ck(await sb.rpc('player_new_p2p', { p_to: to, p_subject: subject, p_body: body }));
export const otherPlayers = async () => ck(await sb.rpc('list_other_players'));
export async function markRead(convId, dirs) {
  ck(await sb.from('messages').update({ read_at: new Date().toISOString() }).eq('conversation_id', convId).is('read_at', null).in('direction', dirs));
}
export const setConvFlags = async (id, patch) => ck(await sb.from('conversations').update(patch).eq('id', id));

// ------------------------------------------------------------ contacts
export async function addContact(identityId, name, portraitPath) {
  return ck(await sb.from('contacts').insert({ owner_id: await uid(), identity_id: identityId, display_name: name, portrait_path: portraitPath || null }).select().single());
}
export const updateContact = async (id, patch) => ck(await sb.from('contacts').update(patch).eq('id', id));
export const removeContact = async (id) => ck(await sb.from('contacts').delete().eq('id', id));
export async function uploadPortrait(blob) {
  const ext = blob.type === 'image/webp' ? 'webp' : blob.type === 'image/png' ? 'png' : 'jpg';
  const path = `${await uid()}/${crypto.randomUUID()}.${ext}`;
  const { error } = await sb.storage.from('portraits').upload(path, blob, { contentType: blob.type, upsert: false });
  if (error) throw new Error(error.message);
  return path;
}
export const removePortrait = async (path) => { if (path) await sb.storage.from('portraits').remove([path]); };

const urlCache = new Map(); // path -> { url, exp }
export async function portraitUrls(paths) {
  const need = [...new Set(paths.filter(Boolean))].filter((p) => !(urlCache.get(p)?.exp > Date.now()));
  if (need.length) {
    const { data, error } = await sb.storage.from('portraits').createSignedUrls(need, 3600);
    if (!error) (data || []).forEach((d) => { if (d.signedUrl) urlCache.set(d.path, { url: d.signedUrl, exp: Date.now() + 50 * 60 * 1000 }); });
  }
  return (p) => urlCache.get(p)?.url || null;
}

// ------------------------------------------------------------------ GM
export const gmPlayers = async () => ck(await sb.from('profiles').select('*').order('username'));
export const gmIdentities = async () => ck(await sb.from('identities').select('*').order('created_at'));
export const gmContacts = async () => ck(await sb.from('contacts').select('*'));
export const gmSend = async (identity, players, subject, body, announcement = false) =>
  ck(await sb.rpc('gm_send', { p_identity: identity, p_players: players, p_subject: subject, p_body: body, p_announcement: announcement }));
export const createNpc = async (name, notes) => ck(await sb.from('identities').insert({ kind: 'npc', name, notes: notes || '' }).select().single());
export const updateIdentity = async (id, patch) => ck(await sb.from('identities').update(patch).eq('id', id));
export const deleteIdentity = async (id) => ck(await sb.from('identities').delete().eq('id', id));

export async function admin(body) {
  const { data, error } = await sb.functions.invoke('admin-players', { body });
  if (error) {
    let msg = error.message;
    try { const j = await error.context?.json?.(); if (j?.error) msg = j.error; } catch { /* keep default */ }
    throw new Error(msg);
  }
  if (data?.error) throw new Error(data.error);
  return data;
}

// ------------------------------------------------------------ realtime
/** Calls onEvent({table,eventType,new,old}) for every change visible to this user (RLS applies). */
export function subscribe(onEvent) {
  const ch = sb.channel('ncm-' + Math.random().toString(36).slice(2));
  for (const table of ['messages', 'conversations', 'contacts']) {
    ch.on('postgres_changes', { event: '*', schema: 'public', table }, (p) => onEvent({ table, eventType: p.eventType, new: p.new, old: p.old }));
  }
  ch.subscribe();
  return () => sb.removeChannel(ch);
}
