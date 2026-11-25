// =====================================================================
//  DEMO ONLY. An in-memory fake of the parts of supabase-js this app uses,
//  persisted in localStorage, with a tiny emulation of the RLS rules.
//  It is only loaded when the address contains ?demo. Production never
//  imports this file.
// =====================================================================
const KEY = 'ncm-demo-v1', SKEY = 'ncm-demo-session';
const uuid = () => crypto.randomUUID();
const nowISO = (off = 0) => new Date(Date.now() + off).toISOString();
const IN = ['to_player', 'p2p_in'];
const clone = (x) => JSON.parse(JSON.stringify(x));

let db = load();
const bc = typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel('ncm-demo') : null;
const subs = new Set();

function load() { try { const s = localStorage.getItem(KEY); if (s) return JSON.parse(s); } catch { /* fresh */ } const d = seed(); try { localStorage.setItem(KEY, JSON.stringify(d)); } catch { /* ignore */ } return d; }
function save() { try { localStorage.setItem(KEY, JSON.stringify(db)); } catch { /* ignore */ } }
const me = () => { const id = sessionStorage.getItem(SKEY); return id ? db.profiles.find((p) => p.id === id && !p.disabled) || null : null; };
const isGm = () => me()?.role === 'gm';

// ------------------------------------------------------------ domain logic (mirrors the SQL)
function ensureConv(d, player, identity) {
  let c = d.conversations.find((x) => x.player_id === player && x.identity_id === identity);
  if (!c) {
    const kind = d.identities.find((i) => i.id === identity)?.kind || 'npc';
    c = { id: uuid(), player_id: player, identity_id: identity, identity_kind: kind, created_at: nowISO(), last_message_at: nowISO(), last_preview: '', last_subject: '', last_direction: null, archived_by_player: false, deleted_by_player: false, archived_by_gm: false };
    d.conversations.push(c);
  }
  return c;
}
function addMessage(d, convId, f, at) {
  const c = d.conversations.find((x) => x.id === convId);
  const m = { id: uuid(), conversation_id: convId, player_id: c.player_id, direction: f.direction, sender_user_id: f.sender || null, subject: (f.subject || '').trim(), body: f.body.trim(), is_announcement: !!f.ann, created_at: at || nowISO(), read_at: null };
  d.messages.push(m);
  c.last_message_at = m.created_at; c.last_preview = m.body.replace(/\s+/g, ' ').slice(0, 140); c.last_subject = m.subject; c.last_direction = m.direction;
  if (IN.includes(m.direction)) { c.deleted_by_player = false; c.archived_by_player = false; }
  if (m.direction === 'from_player') c.archived_by_gm = false;
  return m;
}
function provision(d, pid) {
  const p = d.profiles.find((x) => x.id === pid); if (!p || p.role !== 'player' || p.disabled) return;
  const g = d.identities.find((i) => i.kind === 'gm'); if (!g) return;
  if (d.conversations.some((c) => c.player_id === pid && c.identity_id === g.id)) return;
  const c = ensureConv(d, pid, g.id);
  d.contacts.push({ id: uuid(), owner_id: pid, identity_id: g.id, display_name: 'GM', portrait_path: null, created_at: nowISO() });
  addMessage(d, c.id, { direction: 'to_player', sender: g.user_id, subject: 'WELCOME', body: `Welcome to the Net, ${p.character_name || 'choom'}.\nThis is your private channel to the GM. Add contacts, check your inbox, stay alive.` });
}
function newPlayer(d, username, character, password) {
  const id = uuid();
  d.users.push({ id, username, password });
  d.profiles.push({ id, username, character_name: character, role: 'player', disabled: false, created_at: nowISO() });
  d.identities.push({ id: uuid(), kind: 'player', user_id: id, name: character || username, notes: '', created_at: nowISO() });
  provision(d, id); return id;
}
function seed() {
  const d = { users: [], profiles: [], identities: [], conversations: [], messages: [], contacts: [], settings: [{ key: 'player_dm_enabled', value: false }], files: {} };
  const gid = uuid();
  d.users.push({ id: gid, username: 'gm', password: 'gm' });
  d.profiles.push({ id: gid, username: 'gm', character_name: '', role: 'gm', disabled: false, created_at: nowISO() });
  d.identities.push({ id: uuid(), kind: 'gm', user_id: gid, name: 'GM', notes: '', created_at: nowISO() });
  const vex = newPlayer(d, 'vex', 'V', 'vex'), kira = newPlayer(d, 'kira', 'Kira Voss', 'kira');
  const regina = { id: uuid(), kind: 'npc', user_id: null, name: 'Regina Jones', notes: 'Arasaka fixer. Pays well, lies better.', created_at: nowISO() };
  const dex = { id: uuid(), kind: 'npc', user_id: null, name: 'Dex', notes: 'Ripperdoc in Kabuki.', created_at: nowISO() };
  d.identities.push(regina, dex);
  const t = (min) => nowISO(-min * 60000);
  const gmI = d.identities.find((i) => i.kind === 'gm');
  const c1 = ensureConv(d, vex, regina.id), c2 = ensureConv(d, vex, dex.id), c3 = ensureConv(d, kira, regina.id);
  addMessage(d, c1.id, { direction: 'to_player', sender: gid, subject: 'Got a job for you', body: 'Choom — I hear you handle quiet work. Meet me at the Afterlife, midnight. Come alone. Come armed.' }, t(95));
  addMessage(d, c2.id, { direction: 'to_player', sender: gid, subject: 'Your chrome', body: 'Your new arm is calibrated. Come back in a week for the follow-up, and no more bar fights, yeah?' }, t(1500));
  addMessage(d, c3.id, { direction: 'to_player', sender: gid, subject: 'Opportunity', body: 'Kira Voss. Heard your name from a friend. I have a package that needs to move through Watson. Interested?' }, t(40));
  const gc = d.conversations.find((c) => c.player_id === vex && c.identity_id === gmI.id);
  addMessage(d, gc.id, { direction: 'from_player', sender: vex, subject: 'Back from Pacifica', body: 'We got the data shard. Rogue says the buyer wants to meet tomorrow. What do I know about him?' }, t(300));
  addMessage(d, gc.id, { direction: 'to_player', sender: gid, subject: 'Re: Back from Pacifica', body: 'Nothing good. Buyer is a Militech middleman called Harlan Voss. Watch your back.' }, t(280));
  return d;
}
function emit(table, eventType, row, old) {
  const ev = { table, eventType, new: row ? clone(row) : null, old: old ? clone(old) : null };
  dispatch(ev); try { bc?.postMessage(ev); } catch { /* ignore */ }
}
function canSee(table, r) {
  const u = me(); if (!u) return false; if (u.role === 'gm') return true;
  if (table === 'profiles') return r.id === u.id;
  if (table === 'identities') return false;
  if (table === 'conversations' || table === 'messages') return r.player_id === u.id;
  if (table === 'contacts') return r.owner_id === u.id;
  return true;
}
function dispatch(ev) { for (const s of subs) for (const h of s.h) { if (h.table === ev.table && canSee(ev.table, ev.new || ev.old || {})) h.cb(clone(ev)); } }
bc && (bc.onmessage = (e) => { db = load(); dispatch(e.data); });
window.addEventListener('storage', (e) => { if (e.key === KEY && e.newValue) db = JSON.parse(e.newValue); });

// ------------------------------------------------------------ query builder
class Q {
  constructor(t) { this.t = t; this.op = 'select'; this.f = []; this.ord = null; this.lim = null; this.one = null; this.pay = null; this.ret = false; }
  select() { if (this.op !== 'select') this.ret = true; return this; }
  insert(p) { this.op = 'insert'; this.pay = p; return this; }
  update(p) { this.op = 'update'; this.pay = p; return this; }
  delete() { this.op = 'delete'; return this; }
  eq(c, v) { this.f.push((r) => r[c] === v); return this; }
  in(c, a) { this.f.push((r) => a.includes(r[c])); return this; }
  is(c, v) { this.f.push((r) => (r[c] ?? null) === v); return this; }
  order(c, { ascending = true } = {}) { this.ord = [c, ascending]; return this; }
  limit(n) { this.lim = n; return this; }
  single() { this.one = 'single'; return this; }
  maybeSingle() { this.one = 'maybe'; return this; }
  then(res, rej) { return new Promise((r) => setTimeout(r, 25)).then(() => this.run()).then(res, rej); }
  fail(message) { return { data: null, error: { message } }; }
  shape(rows) {
    if (this.one) { if (!rows.length) return this.one === 'maybe' ? { data: null, error: null } : this.fail('No rows'); return { data: clone(rows[0]), error: null }; }
    return { data: clone(rows), error: null };
  }
  run() {
    const u = me(), t = this.t, rows = db[t];
    if (!u) return this.fail('JWT expired');
    const match = (r) => canSee(t, r) && this.f.every((f) => f(r));
    if (this.op === 'select') {
      let out = rows.filter(match);
      if (this.ord) { const [c, asc] = this.ord; out = [...out].sort((a, b) => (a[c] > b[c] ? 1 : a[c] < b[c] ? -1 : 0) * (asc ? 1 : -1)); }
      if (this.lim) out = out.slice(0, this.lim);
      return this.shape(out);
    }
    if (this.op === 'insert') {
      const p = this.pay;
      if (t === 'contacts') {
        if (u.role === 'gm' || p.owner_id !== u.id || !db.conversations.some((c) => c.player_id === u.id && c.identity_id === p.identity_id)) return this.fail('new row violates row-level security policy for table "contacts"');
        if (db.contacts.some((c) => c.owner_id === u.id && c.identity_id === p.identity_id)) return this.fail('duplicate key value violates unique constraint');
        const r = { id: uuid(), owner_id: p.owner_id, identity_id: p.identity_id, display_name: String(p.display_name).slice(0, 40), portrait_path: p.portrait_path || null, created_at: nowISO() };
        db.contacts.push(r); save(); emit('contacts', 'INSERT', r); return this.shape([r]);
      }
      if (t === 'identities') {
        if (u.role !== 'gm') return this.fail('new row violates row-level security policy for table "identities"');
        const r = { id: uuid(), kind: p.kind, user_id: null, name: p.name, notes: p.notes || '', created_at: nowISO() };
        db.identities.push(r); save(); return this.shape([r]);
      }
      return this.fail('permission denied for table ' + t);
    }
    if (this.op === 'update') {
      const hit = rows.filter(match), p = this.pay, done = [];
      for (const r of hit) {
        const old = clone(r);
        if (t === 'messages') {
          const ok = (u.role === 'gm' && r.direction === 'from_player') || (u.role === 'player' && IN.includes(r.direction));
          if (!ok || !('read_at' in p)) continue; r.read_at = p.read_at;
        } else if (t === 'conversations') {
          if (u.role === 'gm') { if ('archived_by_gm' in p) r.archived_by_gm = !!p.archived_by_gm; if ('archived_by_player' in p || 'deleted_by_player' in p) return this.fail('not allowed'); }
          else { if ('archived_by_gm' in p) return this.fail('not allowed'); if ('archived_by_player' in p) r.archived_by_player = !!p.archived_by_player; if ('deleted_by_player' in p) r.deleted_by_player = !!p.deleted_by_player; }
        } else if (t === 'contacts') {
          if (r.owner_id !== u.id) continue; if ('display_name' in p) r.display_name = String(p.display_name).slice(0, 40); if ('portrait_path' in p) r.portrait_path = p.portrait_path;
        } else if (t === 'identities') { if (u.role !== 'gm') continue; Object.assign(r, p); }
        else if (t === 'settings') { if (u.role !== 'gm') continue; r.value = p.value; }
        else return this.fail('permission denied for table ' + t);
        done.push(r); if (t !== 'settings' && t !== 'identities') emit(t, 'UPDATE', r, old);
      }
      save(); return this.shape(done);
    }
    if (this.op === 'delete') {
      const hit = rows.filter(match), gone = [];
      for (const r of hit) {
        if (t === 'contacts' && r.owner_id === u.id) gone.push(r);
        else if (t === 'identities' && u.role === 'gm') gone.push(r);
        else if (t === 'messages' && u.role === 'gm') gone.push(r);
      }
      db[t] = rows.filter((r) => !gone.includes(r));
      if (t === 'identities') { const ids = new Set(gone.map((g) => g.id)); const cv = db.conversations.filter((c) => ids.has(c.identity_id)).map((c) => c.id); db.conversations = db.conversations.filter((c) => !ids.has(c.identity_id)); db.messages = db.messages.filter((m) => !cv.includes(m.conversation_id)); db.contacts = db.contacts.filter((c) => !ids.has(c.identity_id)); }
      save(); gone.forEach((r) => t === 'contacts' && emit('contacts', 'DELETE', null, r)); return this.shape(gone);
    }
    return this.fail('unsupported');
  }
}

// ------------------------------------------------------------ RPCs
const rpcs = {
  ensure_my_environment() { const u = me(); if (u && u.role === 'player') { const before = db.messages.length; provision(db, u.id); if (db.messages.length !== before) save(); } return null; },
  list_other_players() { const u = me(); const on = db.settings.find((s) => s.key === 'player_dm_enabled')?.value === true; if (!on || !u || u.role === 'gm') return []; return db.profiles.filter((p) => p.role === 'player' && !p.disabled && p.id !== u.id).map((p) => ({ id: p.id, character_name: p.character_name })); },
  gm_send(a) {
    const u = me(); if (!u || u.role !== 'gm') throw new Error('forbidden');
    if (!String(a.p_body || '').trim()) throw new Error('The message is empty');
    const idn = db.identities.find((i) => i.id === a.p_identity); if (!idn || !['gm', 'npc'].includes(idn.kind)) throw new Error('Invalid sender identity');
    const targets = db.profiles.filter((p) => p.role === 'player' && !p.disabled && (a.p_announcement || (a.p_players || []).includes(p.id)));
    for (const p of targets) { const c = ensureConv(db, p.id, idn.id); const m = addMessage(db, c.id, { direction: 'to_player', sender: u.id, subject: a.p_subject, body: a.p_body, ann: a.p_announcement }); emit('messages', 'INSERT', m); emit('conversations', 'UPDATE', c); }
    save(); return targets.length;
  },
  player_send(a) {
    const u = me(); if (!u || u.role === 'gm') throw new Error('forbidden');
    if (!String(a.p_body || '').trim()) throw new Error('The message is empty');
    const c = db.conversations.find((x) => x.id === a.p_conversation && x.player_id === u.id); if (!c) throw new Error('Conversation not found');
    const idn = db.identities.find((i) => i.id === c.identity_id); let out;
    if (idn.kind === 'player') {
      if (db.settings.find((s) => s.key === 'player_dm_enabled')?.value !== true) throw new Error('Player-to-player messaging is disabled');
      const mine = db.identities.find((i) => i.kind === 'player' && i.user_id === u.id), oc = ensureConv(db, idn.user_id, mine.id);
      const mi = addMessage(db, oc.id, { direction: 'p2p_in', sender: u.id, subject: a.p_subject, body: a.p_body }); emit('messages', 'INSERT', mi); emit('conversations', 'UPDATE', oc);
      out = addMessage(db, c.id, { direction: 'p2p_out', sender: u.id, subject: a.p_subject, body: a.p_body });
    } else out = addMessage(db, c.id, { direction: 'from_player', sender: u.id, subject: a.p_subject, body: a.p_body });
    emit('messages', 'INSERT', out); emit('conversations', 'UPDATE', c); save(); return out.id;
  },
  player_new_p2p(a) {
    const u = me(); if (!u || u.role === 'gm') throw new Error('forbidden');
    if (db.settings.find((s) => s.key === 'player_dm_enabled')?.value !== true) throw new Error('Player-to-player messaging is disabled');
    const t = db.identities.find((i) => i.kind === 'player' && i.user_id === a.p_to); if (!t) throw new Error('Recipient unavailable');
    const c = ensureConv(db, u.id, t.id); rpcs.player_send({ p_conversation: c.id, p_subject: a.p_subject, p_body: a.p_body }); return c.id;
  },
};

// ------------------------------------------------------------ admin Edge Function
function adminFn(b) {
  const u = me(); if (!u || u.role !== 'gm') throw new Error('Only the GM can do this');
  const nameRe = /^[a-z0-9_.-]{2,32}$/;
  const pw = (v) => { v = String(v || ''); if (v && v.length < 8) throw new Error('Password must be at least 8 characters.'); return v || Math.random().toString(36).slice(2, 8) + Math.random().toString(36).slice(2, 8).toUpperCase(); };
  if (b.action === 'create') {
    const un = String(b.username || '').trim().toLowerCase(); if (!nameRe.test(un)) throw new Error('Username must be 2-32 characters: a-z, 0-9, dot, dash or underscore.');
    if (db.profiles.some((p) => p.username === un)) throw new Error('That username already exists.');
    const password = pw(b.password), id = newPlayer(db, un, String(b.character_name || '').trim().slice(0, 60), password); save();
    const c = db.conversations.find((x) => x.player_id === id); if (c) emit('conversations', 'INSERT', c);
    return { id, username: un, character_name: b.character_name || '', password };
  }
  const p = db.profiles.find((x) => x.id === b.id); if (!p) throw new Error('Player not found'); if (p.role === 'gm') throw new Error('GM accounts cannot be changed here');
  if (b.action === 'update') {
    if (b.username !== undefined) { const un = String(b.username).trim().toLowerCase(); if (!nameRe.test(un)) throw new Error('Username must be 2-32 characters: a-z, 0-9, dot, dash or underscore.'); if (un !== p.username) { if (db.profiles.some((x) => x.username === un)) throw new Error('That username already exists.'); p.username = un; db.users.find((x) => x.id === p.id).username = un; } }
    if (b.character_name !== undefined) { p.character_name = String(b.character_name).trim().slice(0, 60); const i = db.identities.find((x) => x.kind === 'player' && x.user_id === p.id); if (i) i.name = p.character_name || p.username; }
    save(); return { ok: true };
  }
  if (b.action === 'reset_password') { const password = pw(b.password); db.users.find((x) => x.id === p.id).password = password; save(); return { ok: true, password }; }
  if (b.action === 'set_disabled') { p.disabled = !!b.disabled; save(); return { ok: true }; }
  if (b.action === 'delete') {
    db.profiles = db.profiles.filter((x) => x.id !== p.id); db.users = db.users.filter((x) => x.id !== p.id);
    const myIdent = db.identities.filter((i) => i.user_id === p.id).map((i) => i.id); db.identities = db.identities.filter((i) => i.user_id !== p.id);
    const cv = db.conversations.filter((c) => c.player_id === p.id || myIdent.includes(c.identity_id)).map((c) => c.id);
    db.conversations = db.conversations.filter((c) => !cv.includes(c.id)); db.messages = db.messages.filter((m) => !cv.includes(m.conversation_id));
    db.contacts = db.contacts.filter((c) => c.owner_id !== p.id && !myIdent.includes(c.identity_id)); save(); return { ok: true };
  }
  throw new Error('Unknown action');
}

// ------------------------------------------------------------ the fake client
export function createMockClient() {
  const authSubs = [];
  return {
    auth: {
      async signInWithPassword({ email, password }) {
        await new Promise((r) => setTimeout(r, 250));
        const un = String(email).split('@')[0].toLowerCase(), u = db.users.find((x) => x.username === un);
        if (!u || u.password !== password) return { data: null, error: { message: 'Invalid login credentials' } };
        const p = db.profiles.find((x) => x.id === u.id); if (p.disabled) return { data: null, error: { message: 'User is banned' } };
        sessionStorage.setItem(SKEY, u.id); authSubs.forEach((f) => f('SIGNED_IN')); return { data: { user: { id: u.id } }, error: null };
      },
      async getSession() { const u = me(); return { data: { session: u ? { user: { id: u.id } } : null } }; },
      async signOut() { sessionStorage.removeItem(SKEY); authSubs.forEach((f) => f('SIGNED_OUT')); return { error: null }; },
      onAuthStateChange(cb) { authSubs.push(cb); return { data: { subscription: { unsubscribe() {} } } }; },
    },
    from: (t) => new Q(t),
    async rpc(name, args) { await new Promise((r) => setTimeout(r, 25)); try { if (!me()) throw new Error('JWT expired'); return { data: rpcs[name](args || {}), error: null }; } catch (e) { return { data: null, error: { message: e.message } }; } },
    functions: { async invoke(name, { body }) { await new Promise((r) => setTimeout(r, 300)); try { return { data: adminFn(body), error: null }; } catch (e) { return { data: null, error: { message: e.message } }; } } },
    channel() { const ch = { h: [], on(_t, f, cb) { this.h.push({ table: f.table, cb }); return this; }, subscribe() { subs.add(this); return this; } }; return ch; },
    removeChannel(ch) { subs.delete(ch); },
    storage: { from: () => ({
      async upload(path, blob) { const data = await new Promise((r) => { const fr = new FileReader(); fr.onload = () => r(fr.result); fr.readAsDataURL(blob); }); db.files[path] = data; save(); return { error: null }; },
      async remove(paths) { paths.forEach((p) => delete db.files[p]); save(); return { error: null }; },
      async createSignedUrls(paths) { return { data: paths.map((p) => ({ path: p, signedUrl: db.files[p] || null })), error: null }; },
    }) },
  };
}
