// Player messaging board: two panels (contacts/conversations + selected thread).
import * as api from './api.js';
import { $, $$, esc, toast, modal, confirmBox, clock, dayKey, dayLabel, ago, avatar, beep, systemNotify, askNotifyPermission, setTitleCount, debounce } from './ui.js';
import { cropSquare } from './images.js';

const IN = ['to_player', 'p2p_in'];
const OUT = ['from_player', 'p2p_out'];

export async function startPlayer(root, profile, signOut) {
  const S = {
    profile, convs: [], contacts: new Map(), unread: new Map(), url: () => null,
    sel: null, tab: 'inbox', msgs: [], sent: [], p2p: false, fresh: new Set(), drafts: new Map(), sending: false, ready: false,
  };
  const pending = [];

  root.innerHTML = `<div class="app" id="pl">
    <header class="top">
      <div class="brand"><b>NIGHT CITY</b><span>// MESSAGES</span></div>
      <nav class="tabs">
        <button class="tab on" data-tab="inbox">INBOX<span class="badge" id="ub" hidden></span></button>
        <button class="tab" data-tab="sent">SENT</button>
        <button class="tab" data-tab="archived">ARCHIVED</button>
      </nav>
      <div class="hr">
        <span class="who">▸ <b>${esc(profile.character_name || profile.username)}</b></span>
        <button class="btn sm ghost" id="alerts" title="Desktop notifications">ALERTS</button>
        <button class="btn red" id="newb">NEW MESSAGE</button>
        <button class="btn sm ghost" id="out">SIGN OUT</button>
      </div>
    </header>
    <main class="split">
      <aside class="left ang"><div class="in">
        <div class="lhead"><span id="ltitle">CONTACTS</span><span class="tiny mono mut" id="lcount"></span></div>
        <div class="clist" id="list"><div class="loading"><span class="spin"></span>SYNCING…</div></div>
      </div></aside>
      <section class="right ang"><div class="in">
        <div class="chead" id="chead" hidden></div>
        <div class="msgs" id="msgs"></div>
        <div class="comp" id="comp" hidden>
          <input id="csub" maxlength="120" placeholder="SUBJECT (optional)">
          <textarea id="cbody" maxlength="4000" placeholder="Type your message… (Ctrl+Enter to send)"></textarea>
          <div class="row sp"><span class="tiny mono mut">NETWATCH RELAY · CH-07</span><button class="btn red" id="sendb">SEND</button></div>
        </div>
      </div></section>
    </main></div>`;
  const app = $('#pl', root);

  // ------------------------------------------------------------ helpers
  const who = (conv) => {
    const c = S.contacts.get(conv.identity_id);
    return c ? { name: c.display_name, known: true, url: c.portrait_path ? S.url(c.portrait_path) : null, contact: c }
             : { name: 'UNKNOWN', known: false, url: null, contact: null };
  };
  const conv = (id) => S.convs.find((c) => c.id === id);
  const visible = (c) => (S.tab === 'archived') ? (c.archived_by_player && !c.deleted_by_player) : (!c.archived_by_player && !c.deleted_by_player);
  const totalUnread = () => S.convs.filter((c) => !c.archived_by_player && !c.deleted_by_player).reduce((n, c) => n + (S.unread.get(c.id) || 0), 0);

  // ------------------------------------------------------------ rendering
  function renderTabs() {
    $$('.tab', app).forEach((t) => t.classList.toggle('on', t.dataset.tab === S.tab));
    const n = totalUnread(), b = $('#ub', app);
    b.hidden = !n; b.textContent = n;
    setTitleCount(n);
    $('#ltitle', app).textContent = S.tab === 'sent' ? 'SENT MESSAGES' : S.tab === 'archived' ? 'ARCHIVED' : 'CONTACTS';
  }

  function renderList() {
    const list = $('#list', app);
    let html = '', count = 0;
    if (S.tab === 'sent') {
      for (const m of S.sent) {
        const c = conv(m.conversation_id); if (!c) continue;
        const w = who(c); count++;
        html += `<div class="crow${S.sel === c.id ? ' sel' : ''}" data-id="${c.id}">${avatar(w.url, { known: w.known })}<div class="mid"><div class="nm${w.known ? '' : ' unk'}">TO: ${esc(w.name)}</div><div class="pv">${esc(m.subject ? m.subject + ' — ' : '')}${esc(m.body.replace(/\s+/g, ' '))}</div></div><div class="rt"><span>${ago(m.created_at)}</span></div></div>`;
      }
    } else {
      for (const c of S.convs.filter(visible)) {
        const w = who(c), u = S.unread.get(c.id) || 0; count++;
        const mine = OUT.includes(c.last_direction);
        html += `<div class="crow${S.sel === c.id ? ' sel' : ''}${u ? ' unread' : ''}" data-id="${c.id}">${avatar(w.url, { known: w.known })}<div class="mid"><div class="nm${w.known ? '' : ' unk'}">${esc(w.name)}</div><div class="pv">${esc(c.last_subject ? c.last_subject + ' — ' : '')}${mine ? 'You: ' : ''}${esc(c.last_preview)}</div></div><div class="rt"><span>${ago(c.last_message_at)}</span>${u ? `<span class="badge">${u}</span>` : ''}</div></div>`;
      }
    }
    if (!count) {
      html = `<div class="empty"><b>${S.tab === 'sent' ? 'NOTHING SENT' : S.tab === 'archived' ? 'NO ARCHIVE' : 'NO MESSAGES'}</b><span class="mono">${S.tab === 'sent' ? 'Messages you send will be listed here.' : S.tab === 'archived' ? 'Archived conversations land here.' : 'Your inbox is empty. Messages from the GM and your contacts show up here the moment they arrive.'}</span></div>`;
    }
    list.innerHTML = html;
    $('#lcount', app).textContent = count ? String(count).padStart(2, '0') : '';
  }

  function renderChat(stick = true) {
    const head = $('#chead', app), msgs = $('#msgs', app), comp = $('#comp', app);
    const c = S.sel && conv(S.sel);
    app.classList.toggle('chat-open', !!c);
    if (!c) {
      head.hidden = comp.hidden = true;
      msgs.innerHTML = `<div class="empty"><b>SELECT A CONVERSATION</b><span class="mono">Pick a contact on the left, or hit NEW MESSAGE.</span></div>`;
      return;
    }
    const w = who(c);
    head.hidden = comp.hidden = false;
    head.innerHTML = `<button class="btn sm ghost back" id="back">◂</button>${avatar(w.url, { known: w.known, size: 'lg' })}
      <div class="grow" style="min-width:0"><div class="nm${w.known ? '' : ' unk'}">${esc(w.name)}</div><div class="sub">${w.known ? 'CONTACT' : 'UNKNOWN SENDER · not in your contacts'}</div></div>
      <div class="row">${w.known ? '<button class="btn sm" id="editc">EDIT</button>' : '<button class="btn sm yel" id="addc">+ ADD TO CONTACTS</button>'}
      <button class="btn sm ghost" id="arch">${c.archived_by_player ? 'UNARCHIVE' : 'ARCHIVE'}</button><button class="btn sm ghost" id="delc">DELETE</button></div>`;
    const atBottom = msgs.scrollHeight - msgs.scrollTop - msgs.clientHeight < 80;
    let last = '', html = '';
    for (const m of S.msgs) {
      const k = dayKey(m.created_at);
      if (k !== last) { html += `<div class="day">${dayLabel(m.created_at)}</div>`; last = k; }
      const out = OUT.includes(m.direction);
      html += `<div class="msg ${out ? 'out' : 'in'}"><div class="bubble${S.fresh.has(m.id) ? ' fresh' : ''}"><div class="bm"><span class="w">${out ? 'YOU' : esc(w.name)}</span><span>${clock(m.created_at)}</span></div>${m.is_announcement ? '<span class="tag y">ANNOUNCEMENT</span> ' : ''}${m.subject ? `<div class="subj">${esc(m.subject)}</div>` : ''}<div class="body">${esc(m.body)}</div></div></div>`;
    }
    msgs.innerHTML = html || `<div class="empty"><b>NO MESSAGES YET</b><span class="mono">Say something.</span></div>`;
    if (stick || atBottom) msgs.scrollTop = msgs.scrollHeight;
    S.fresh.clear();
  }

  const render = (stick) => { renderTabs(); renderList(); renderChat(stick); };

  // ------------------------------------------------------------ data
  async function loadAll() {
    const [convs, contacts, unread, p2p] = await Promise.all([api.listConversations(), api.listContacts(), api.listUnread(IN), api.p2pEnabled().catch(() => false)]);
    S.convs = convs; S.p2p = p2p;
    S.contacts = new Map(contacts.map((c) => [c.identity_id, c]));
    S.unread = new Map(); unread.forEach((m) => S.unread.set(m.conversation_id, (S.unread.get(m.conversation_id) || 0) + 1));
    S.url = await api.portraitUrls(contacts.map((c) => c.portrait_path));
    if (S.tab === 'sent') S.sent = await api.listSent();
    if (S.sel && !conv(S.sel)) S.sel = null;
    if (S.sel) { S.msgs = await api.listMessages(S.sel); await readOpen(); }
  }
  async function readOpen() {
    if (!S.sel || !(S.unread.get(S.sel) > 0) || document.hidden) return;
    await api.markRead(S.sel, IN).catch(() => {});
    S.unread.delete(S.sel);
  }
  async function refresh(stick = false) {
    try { await loadAll(); } catch (e) { toast('Sync problem: ' + e.message, 'err'); return; }
    render(stick);
    while (pending.length) {
      const m = pending.shift(), c = conv(m.conversation_id);
      if (S.sel === m.conversation_id && !document.hidden) continue;
      const name = c ? who(c).name : 'UNKNOWN';
      toast(`NEW MESSAGE · ${name}${m.subject ? ' — ' + m.subject : ''}`, 'msg');
      beep(); systemNotify('New message · ' + name, m.subject || m.body.slice(0, 80));
    }
  }
  const refreshSoon = debounce(() => refresh(false), 250);

  async function select(id) {
    if (S.sel) S.drafts.set(S.sel, { s: $('#csub', app).value, b: $('#cbody', app).value });
    S.sel = id;
    const d = S.drafts.get(id) || { s: '', b: '' };
    $('#csub', app).value = d.s; $('#cbody', app).value = d.b;
    renderList(); renderChat(true);
    try { S.msgs = await api.listMessages(id); await readOpen(); render(true); }
    catch (e) { toast(e.message, 'err'); }
  }

  async function send() {
    const body = $('#cbody', app).value.trim(), subject = $('#csub', app).value.trim();
    if (!body || !S.sel || S.sending) return;
    S.sending = true; $('#sendb', app).disabled = true;
    try {
      await api.playerSend(S.sel, subject, body);
      $('#cbody', app).value = ''; $('#csub', app).value = ''; S.drafts.delete(S.sel);
      await refresh(true);
    } catch (e) { toast(e.message, 'err'); }
    finally { S.sending = false; $('#sendb', app).disabled = false; $('#cbody', app).focus(); }
  }

  // ------------------------------------------------------------ contacts
  function contactModal(c) {
    const w = who(c), ex = w.contact;
    let blob = null, drop = false;
    const m = modal(`<h3>${ex ? 'EDIT CONTACT' : 'ADD TO CONTACTS'}</h3>
      <p class="hint">${ex ? 'Change how this sender appears to you.' : 'Give this sender a name and a face. Only you can see them.'}</p>
      <label>Display name</label><input id="cn" maxlength="40" value="${esc(ex?.display_name || '')}" placeholder="e.g. Regina Jones">
      <label>Portrait</label>
      <div class="pick"><div id="pv">${avatar(w.url, { known: true, size: 'lg' })}</div>
        <div><input type="file" id="cf" accept="image/jpeg,image/png,image/webp"><div class="hint">JPG, PNG or WebP · cropped to a square automatically</div>
        ${ex?.portrait_path ? '<button class="btn sm ghost" id="crp" type="button">REMOVE PORTRAIT</button>' : ''}</div></div>
      <div class="err" id="ce"></div>
      <div class="acts">${ex ? '<button class="btn ghost" id="cdel">REMOVE CONTACT</button>' : ''}<button class="btn ghost" id="ccan">CANCEL</button><button class="btn red" id="csave">SAVE</button></div>`);
    m.$('#ccan').onclick = m.close;
    m.$('#cf').onchange = async (e) => {
      const f = e.target.files[0]; if (!f) return;
      try { blob = await cropSquare(f); drop = false; m.$('#pv').innerHTML = avatar(URL.createObjectURL(blob), { size: 'lg' }); m.$('#ce').textContent = ''; }
      catch (ex) { blob = null; e.target.value = ''; m.$('#ce').textContent = '✖ ' + ex.message; }
    };
    const crp = m.$('#crp');
    if (crp) crp.onclick = () => { drop = true; blob = null; m.$('#cf').value = ''; m.$('#pv').innerHTML = avatar(null, { size: 'lg' }); crp.hidden = true; };
    m.$('#csave').onclick = async () => {
      const name = m.$('#cn').value.trim();
      if (!name) { m.$('#ce').textContent = '✖ Enter a display name.'; return; }
      const btn = m.$('#csave'); btn.disabled = true; btn.innerHTML = '<span class="spin"></span>SAVING';
      try {
        const newPath = blob ? await api.uploadPortrait(blob) : null;
        if (ex) {
          const path = newPath ?? (drop ? null : ex.portrait_path);
          await api.updateContact(ex.id, { display_name: name, portrait_path: path });
          if (ex.portrait_path && path !== ex.portrait_path) await api.removePortrait(ex.portrait_path).catch(() => {});
        } else await api.addContact(c.identity_id, name, newPath);
        m.close(); toast(ex ? 'Contact updated.' : `${name} added to your contacts.`); await refresh();
      } catch (e) { m.$('#ce').textContent = '✖ ' + e.message; btn.disabled = false; btn.textContent = 'SAVE'; }
    };
    const del = m.$('#cdel');
    if (del) del.onclick = async () => {
      if (!(await confirmBox('Remove contact?', `${ex.display_name} will show as UNKNOWN again. Your messages are kept.`, { ok: 'REMOVE', danger: true }))) return;
      try { await api.removeContact(ex.id); if (ex.portrait_path) await api.removePortrait(ex.portrait_path).catch(() => {}); m.close(); toast('Contact removed.'); await refresh(); }
      catch (e) { toast(e.message, 'err'); }
    };
  }

  // ------------------------------------------------------------ new message
  async function newMessage() {
    let others = [];
    try { S.p2p = await api.p2pEnabled(); if (S.p2p) others = await api.otherPlayers(); } catch { /* keep going with GM only */ }
    const m = modal(`<h3>NEW MESSAGE</h3>
      <label>To</label><select id="nto"><option value="gm">GM</option>${others.map((o) => `<option value="p:${o.id}">${esc(o.character_name || 'Player')}</option>`).join('')}</select>
      <label>Subject</label><input id="nsub" maxlength="120" placeholder="optional">
      <label>Message</label><textarea id="nbody" maxlength="4000" style="min-height:120px"></textarea>
      <div class="err" id="ne"></div>
      <div class="acts"><button class="btn ghost" id="ncan">CANCEL</button><button class="btn red" id="nsend">SEND</button></div>`);
    m.$('#ncan').onclick = m.close;
    m.$('#nsend').onclick = async () => {
      const to = m.$('#nto').value, subject = m.$('#nsub').value.trim(), body = m.$('#nbody').value.trim();
      if (!body) { m.$('#ne').textContent = '✖ Write a message first.'; return; }
      const b = m.$('#nsend'); b.disabled = true; b.innerHTML = '<span class="spin"></span>SENDING';
      try {
        let id;
        if (to === 'gm') {
          let g = S.convs.find((c) => c.identity_kind === 'gm');
          if (!g) { await api.ensureEnv(); await loadAll(); g = S.convs.find((c) => c.identity_kind === 'gm'); }
          if (!g) throw new Error('No GM channel is available yet. Ask your GM.');
          await api.playerSend(g.id, subject, body); id = g.id;
        } else id = await api.playerNewP2p(to.slice(2), subject, body);
        m.close(); toast('Message sent.');
        S.tab = 'inbox'; S.sel = id; await refresh(true); app.classList.add('chat-open');
      } catch (e) { m.$('#ne').textContent = '✖ ' + e.message; b.disabled = false; b.textContent = 'SEND'; }
    };
  }

  // ------------------------------------------------------------ events
  app.addEventListener('click', async (e) => {
    const t = e.target.closest('button,.crow'); if (!t) return;
    if (t.classList.contains('crow')) return select(t.dataset.id);
    const c = S.sel && conv(S.sel);
    if (t.dataset.tab) {
      S.tab = t.dataset.tab;
      if (S.tab === 'sent') { try { S.sent = await api.listSent(); } catch (er) { toast(er.message, 'err'); } }
      return render(false);
    }
    switch (t.id) {
      case 'newb': return newMessage();
      case 'out': return signOut();
      case 'sendb': return send();
      case 'back': S.sel = null; return render(false);
      case 'addc': case 'editc': return contactModal(c);
      case 'arch':
        try { await api.setConvFlags(c.id, { archived_by_player: !c.archived_by_player }); toast(c.archived_by_player ? 'Conversation restored.' : 'Conversation archived.'); if (!c.archived_by_player) S.sel = null; await refresh(); } catch (er) { toast(er.message, 'err'); }
        return;
      case 'delc':
        if (await confirmBox('Delete conversation?', 'It disappears from your inbox. If this sender writes again, a fresh thread appears.', { ok: 'DELETE', danger: true })) {
          try { await api.setConvFlags(c.id, { deleted_by_player: true }); S.sel = null; toast('Conversation deleted.'); await refresh(); } catch (er) { toast(er.message, 'err'); }
        }
        return;
      case 'alerts': { const r = await askNotifyPermission(); toast(r === 'granted' ? 'Desktop alerts enabled.' : r === 'unsupported' ? 'This browser does not support alerts.' : 'Alerts are blocked in your browser settings.', r === 'granted' ? 'info' : 'err'); }
    }
  });
  $('#cbody', app).addEventListener('keydown', (e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); send(); } });
  const onFocus = () => { readOpen().then(() => refresh()); };
  window.addEventListener('focus', onFocus);

  // ------------------------------------------------------------ boot
  try { await api.ensureEnv(); } catch { /* optional safety net */ }
  await refresh(true);
  const stop = api.subscribe((ev) => {
    if (ev.table === 'messages' && ev.eventType === 'INSERT' && IN.includes(ev.new?.direction)) { pending.push(ev.new); S.fresh.add(ev.new.id); }
    refreshSoon();
  });
  const origOut = signOut;
  signOut = async () => { stop(); window.removeEventListener('focus', onFocus); setTitleCount(0); await origOut(); };
}
