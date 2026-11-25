// GM dashboard: centralized inbox, players, sender identities, settings.
import * as api from './api.js';
import { $, $$, esc, toast, modal, confirmBox, clock, dayKey, dayLabel, ago, avatar, beep, systemNotify, askNotifyPermission, setTitleCount, debounce } from './ui.js';

export async function startGm(root, profile, signOut) {
  const S = {
    players: [], pmap: new Map(), idents: [], imap: new Map(), convs: [], unread: new Map(), contacts: [],
    sel: null, tab: 'inbox', filter: { player: '', unread: false, scope: 'active', q: '' }, msgs: [], p2p: false, fresh: new Set(), sending: false,
  };
  const pending = [];

  root.innerHTML = `<div class="app" id="gm">
    <header class="top">
      <div class="brand"><b>NIGHT CITY</b><span>// GM CONSOLE</span></div>
      <nav class="tabs">
        <button class="tab on" data-tab="inbox">INBOX<span class="badge" id="ub" hidden></span></button>
        <button class="tab" data-tab="players">PLAYERS</button>
        <button class="tab" data-tab="ids">SENDERS</button>
        <button class="tab" data-tab="settings">SETTINGS</button>
      </nav>
      <div class="hr">
        <span class="who">▸ <b>${esc(profile.username)}</b> [GM]</span>
        <button class="btn sm ghost" id="alerts">ALERTS</button>
        <button class="btn red" id="newb">NEW MESSAGE</button>
        <button class="btn sm ghost" id="out">SIGN OUT</button>
      </div>
    </header>
    <div id="main" style="flex:1;min-height:0;display:flex"></div></div>`;
  const app = $('#gm', root), main = $('#main', app);

  // ------------------------------------------------------------ helpers
  const player = (id) => S.pmap.get(id);
  const ident = (id) => S.imap.get(id);
  const conv = (id) => S.convs.find((c) => c.id === id);
  const pname = (id) => { const p = player(id); return p ? p.username : '?'; };
  const plabel = (id) => { const p = player(id); return p ? (p.character_name ? `${p.username} · ${p.character_name}` : p.username) : 'unknown'; };
  const idLabel = (c) => { const i = ident(c.identity_id); return c.identity_kind === 'gm' ? 'GM' : c.identity_kind === 'player' ? 'P2P · ' + (i?.name || 'player') : (i?.name || 'NPC'); };
  const playerSees = (c) => { const k = S.contacts.find((x) => x.owner_id === c.player_id && x.identity_id === c.identity_id); return k ? k.display_name : 'UNKNOWN'; };
  const totalUnread = () => S.convs.filter((c) => !c.archived_by_gm).reduce((n, c) => n + (S.unread.get(c.id) || 0), 0);
  const activePlayers = () => S.players.filter((p) => p.role === 'player' && !p.disabled);

  async function loadAll() {
    const [players, idents, convs, unread, contacts, p2p] = await Promise.all([
      api.gmPlayers(), api.gmIdentities(), api.listConversations(), api.listUnread(['from_player']), api.gmContacts(), api.p2pEnabled().catch(() => false)]);
    S.players = players; S.pmap = new Map(players.map((p) => [p.id, p]));
    S.idents = idents; S.imap = new Map(idents.map((i) => [i.id, i]));
    S.convs = convs; S.contacts = contacts; S.p2p = p2p;
    S.unread = new Map(); unread.forEach((m) => S.unread.set(m.conversation_id, (S.unread.get(m.conversation_id) || 0) + 1));
    if (S.sel && !conv(S.sel)) S.sel = null;
    if (S.sel) { S.msgs = await api.listMessages(S.sel); await readOpen(); }
  }
  async function readOpen() {
    if (!S.sel || !(S.unread.get(S.sel) > 0) || document.hidden) return;
    await api.markRead(S.sel, ['from_player']).catch(() => {});
    S.unread.delete(S.sel);
  }
  async function refresh(stick = false) {
    try { await loadAll(); } catch (e) { toast('Sync problem: ' + e.message, 'err'); return; }
    renderTabs(); renderTab(stick);
    while (pending.length) {
      const m = pending.shift();
      if (S.sel === m.conversation_id && !document.hidden) continue;
      const c = conv(m.conversation_id), nm = c ? plabel(c.player_id) : 'a player';
      toast(`NEW MESSAGE · ${nm}${m.subject ? ' — ' + m.subject : ''}`, 'msg'); beep(); systemNotify('New message · ' + nm, m.subject || m.body.slice(0, 80));
    }
  }
  const refreshSoon = debounce(() => refresh(false), 250);

  function renderTabs() {
    $$('.tab', app).forEach((t) => t.classList.toggle('on', t.dataset.tab === S.tab));
    const n = totalUnread(), b = $('#ub', app); b.hidden = !n; b.textContent = n; setTitleCount(n);
  }
  function renderTab(stick) {
    if (S.tab === 'inbox') { if (!$('#glist', main) || main.dataset.pc !== String(S.players.length)) mountInbox(); renderList(); renderChat(stick); }
    else if (S.tab === 'players') renderPlayers();
    else if (S.tab === 'ids') renderIdents();
    else renderSettings();
  }

  // ------------------------------------------------------------ inbox
  function mountInbox() {
    main.innerHTML = `<main class="split" style="flex:1;min-height:0;width:100%">
      <aside class="left ang"><div class="in">
        <div class="lhead"><span>CENTRAL INBOX</span><span class="tiny mono mut" id="gcount"></span></div>
        <div class="filters">
          <select id="fp"><option value="">ALL PLAYERS</option>${S.players.filter((p) => p.role === 'player').map((p) => `<option value="${p.id}">${esc(plabel(p.id))}${p.disabled ? ' (disabled)' : ''}</option>`).join('')}</select>
          <div class="row"><select id="fs" style="flex:1"><option value="active">ACTIVE</option><option value="archived">ARCHIVED</option><option value="all">ALL</option></select>
            <label class="chk"><input type="checkbox" id="fu"> UNREAD</label></div>
          <input id="fq" placeholder="SEARCH…">
        </div>
        <div class="clist" id="glist"></div>
      </div></aside>
      <section class="right ang"><div class="in">
        <div class="chead" id="ghead" hidden></div>
        <div class="msgs" id="gmsgs"></div>
        <div class="comp" id="gcomp" hidden>
          <div class="tiny mono mut" id="gas"></div>
          <input id="gsub" maxlength="120" placeholder="SUBJECT (optional)">
          <textarea id="gbody" maxlength="4000" placeholder="Reply… (Ctrl+Enter to send)"></textarea>
          <div class="row sp"><span class="tiny mono mut" id="gnote"></span><button class="btn red" id="gsend">SEND</button></div>
        </div>
      </div></section></main>`;
    main.dataset.pc = String(S.players.length);
    $('#fp', main).value = S.filter.player; $('#fs', main).value = S.filter.scope; $('#fu', main).checked = S.filter.unread; $('#fq', main).value = S.filter.q;
    $('#gbody', main).addEventListener('keydown', (e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); sendReply(); } });
  }

  function filtered() {
    const f = S.filter, q = f.q.trim().toLowerCase();
    return S.convs.filter((c) => {
      if (f.player && c.player_id !== f.player) return false;
      if (f.scope === 'active' && c.archived_by_gm) return false;
      if (f.scope === 'archived' && !c.archived_by_gm) return false;
      if (f.unread && !(S.unread.get(c.id) > 0)) return false;
      if (q && !(`${plabel(c.player_id)} ${idLabel(c)} ${c.last_preview} ${c.last_subject}`.toLowerCase().includes(q))) return false;
      return true;
    });
  }
  function renderList() {
    const rows = filtered();
    $('#gcount', main).textContent = rows.length ? String(rows.length).padStart(2, '0') : '';
    $('#glist', main).innerHTML = rows.map((c) => {
      const u = S.unread.get(c.id) || 0, mine = c.last_direction === 'to_player';
      return `<div class="crow${S.sel === c.id ? ' sel' : ''}${u ? ' unread' : ''}" data-id="${c.id}">${avatar(null, { size: '' })}<div class="mid">
        <div class="nm">${esc(plabel(c.player_id))}</div>
        <div class="pv"><span class="tag ${c.identity_kind === 'gm' ? 'c' : c.identity_kind === 'npc' ? 'y' : 'r'}">${esc(idLabel(c))}</span> ${esc(c.last_subject ? c.last_subject + ' — ' : '')}${mine ? '↩ ' : ''}${esc(c.last_preview)}</div></div>
        <div class="rt"><span>${ago(c.last_message_at)}</span>${u ? `<span class="badge">${u}</span>` : ''}</div></div>`;
    }).join('') || `<div class="empty"><b>${S.filter.unread ? 'ALL CAUGHT UP' : 'NO CONVERSATIONS'}</b><span class="mono">${S.filter.unread ? 'No unread player messages.' : 'Create a player, then write to them — or wait for their first message.'}</span></div>`;
  }
  function renderChat(stick = true) {
    const head = $('#ghead', main), msgs = $('#gmsgs', main), comp = $('#gcomp', main), c = S.sel && conv(S.sel);
    app.classList.toggle('chat-open', !!c);
    if (!c) { head.hidden = comp.hidden = true; msgs.innerHTML = '<div class="empty"><b>SELECT A CONVERSATION</b><span class="mono">Every player message lands here.</span></div>'; return; }
    const p2p = c.identity_kind === 'player';
    head.hidden = comp.hidden = false;
    head.innerHTML = `<button class="btn sm ghost back" id="gback">◂</button>${avatar(null, { size: 'lg' })}
      <div class="grow" style="min-width:0"><div class="nm">${esc(plabel(c.player_id))}</div><div class="sub">↔ ${esc(idLabel(c))} · player sees this sender as <b style="color:var(--yel)">${esc(playerSees(c))}</b></div></div>
      <div class="row"><button class="btn sm" id="gread">MARK READ</button><button class="btn sm ghost" id="garch">${c.archived_by_gm ? 'UNARCHIVE' : 'ARCHIVE'}</button></div>`;
    const atBottom = msgs.scrollHeight - msgs.scrollTop - msgs.clientHeight < 80;
    let last = '', html = '';
    for (const m of S.msgs) {
      const k = dayKey(m.created_at); if (k !== last) { html += `<div class="day">${dayLabel(m.created_at)}</div>`; last = k; }
      const w = m.direction === 'from_player' ? plabel(c.player_id) : m.direction === 'to_player' ? 'AS ' + idLabel(c) : m.direction === 'p2p_out' ? plabel(c.player_id) : 'FROM ' + idLabel(c);
      const mine = m.direction === 'to_player';
      const unread = m.direction === 'from_player' && !m.read_at;
      html += `<div class="msg ${mine ? 'out' : 'in'}"><div class="bubble${S.fresh.has(m.id) ? ' fresh' : ''}"><div class="bm"><span class="w">${esc(w)}</span><span>${clock(m.created_at)}${unread ? ' · NEW' : ''}</span></div>${m.is_announcement ? '<span class="tag y">ANNOUNCEMENT</span> ' : ''}${m.subject ? `<div class="subj">${esc(m.subject)}</div>` : ''}<div class="body">${esc(m.body)}</div></div></div>`;
    }
    msgs.innerHTML = html || '<div class="empty"><b>NO MESSAGES</b></div>';
    if (stick || atBottom) msgs.scrollTop = msgs.scrollHeight;
    S.fresh.clear();
    $('#gas', main).textContent = p2p ? '' : `SENDING AS ▸ ${idLabel(c)}  →  ${plabel(c.player_id)}`;
    $('#gnote', main).textContent = p2p ? 'PLAYER-TO-PLAYER THREAD · READ ONLY' : '';
    for (const id of ['gsub', 'gbody', 'gsend']) $('#' + id, main).disabled = p2p;
  }

  async function selectConv(id) {
    S.sel = id; renderList(); renderChat(true);
    try { S.msgs = await api.listMessages(id); await readOpen(); renderTabs(); renderList(); renderChat(true); } catch (e) { toast(e.message, 'err'); }
  }
  async function sendReply() {
    const c = conv(S.sel), body = $('#gbody', main).value.trim(), subject = $('#gsub', main).value.trim();
    if (!c || !body || S.sending) return;
    S.sending = true; $('#gsend', main).disabled = true;
    try { await api.gmSend(c.identity_id, [c.player_id], subject, body, false); $('#gbody', main).value = ''; $('#gsub', main).value = ''; await refresh(true); }
    catch (e) { toast(e.message, 'err'); } finally { S.sending = false; $('#gsend', main).disabled = false; }
  }

  // ------------------------------------------------------------ compose / announce
  function composeModal(pre = {}) {
    const senders = S.idents.filter((i) => i.kind === 'gm' || i.kind === 'npc');
    const m = modal(`<h3>NEW MESSAGE</h3>
      <label>Send as</label><select id="cs">${senders.map((i) => `<option value="${i.id}"${pre.identity === i.id ? ' selected' : ''}>${i.kind === 'gm' ? 'GM (you)' : esc(i.name) + ' (NPC)'}</option>`).join('')}</select>
      <div class="hint">Players see NPC senders as <b>UNKNOWN</b> until they add them to their contacts.</div>
      <label>Recipients</label>
      <div class="row" style="margin-bottom:6px"><label class="chk"><input type="checkbox" id="call"> ALL PLAYERS</label><label class="chk"><input type="checkbox" id="cann"> CAMPAIGN ANNOUNCEMENT</label></div>
      <div class="chips" id="cr">${activePlayers().map((p) => `<label class="chk"><input type="checkbox" value="${p.id}"${pre.player === p.id ? ' checked' : ''}> ${esc(plabel(p.id))}</label>`).join('') || '<span class="mut">No active players yet.</span>'}</div>
      <label>Subject</label><input id="csub" maxlength="120">
      <label>Message</label><textarea id="cbody" maxlength="4000" style="min-height:110px"></textarea>
      <div class="err" id="ce"></div>
      <div class="acts"><button class="btn ghost" id="ccan">CANCEL</button><button class="btn red" id="csend">SEND</button></div>`);
    const boxes = () => m.$$('#cr input');
    const sync = () => { const lock = m.$('#cann').checked || m.$('#call').checked; boxes().forEach((b) => { if (lock) b.checked = true; b.disabled = lock; }); if (m.$('#cann').checked) m.$('#call').checked = true; };
    m.$('#call').onchange = () => { if (!m.$('#call').checked) m.$('#cann').checked = false; sync(); if (!m.$('#call').checked) boxes().forEach((b) => { b.disabled = false; b.checked = false; }); };
    m.$('#cann').onchange = () => { if (m.$('#cann').checked) m.$('#call').checked = true; sync(); };
    m.$('#ccan').onclick = m.close;
    m.$('#csend').onclick = async () => {
      const ann = m.$('#cann').checked, ids = boxes().filter((b) => b.checked).map((b) => b.value), body = m.$('#cbody').value.trim();
      if (!body) { m.$('#ce').textContent = '✖ Write a message.'; return; }
      if (!ann && !ids.length) { m.$('#ce').textContent = '✖ Choose at least one recipient.'; return; }
      const b = m.$('#csend'); b.disabled = true; b.innerHTML = '<span class="spin"></span>SENDING';
      try {
        const n = await api.gmSend(m.$('#cs').value, ids, m.$('#csub').value.trim(), body, ann);
        m.close(); toast(`Sent to ${n} player${n === 1 ? '' : 's'}.`); await refresh();
      } catch (e) { m.$('#ce').textContent = '✖ ' + e.message; b.disabled = false; b.textContent = 'SEND'; }
    };
  }

  // ------------------------------------------------------------ players
  function credModal(title, username, password) {
    const m = modal(`<h3>${esc(title)}</h3>
      <p class="hint">Give these to the player. The passcode is shown <b>only now</b> and cannot be recovered (you can always reset it).</p>
      <label>Handle (username)</label><div class="cred" id="cu">${esc(username)}</div>
      <label>Passcode</label><div class="cred" id="cp">${esc(password)}</div>
      <label>Site</label><div class="cred" style="font-size:14px">${esc(location.origin + location.pathname)}</div>
      <div class="acts"><button class="btn" id="ccp">COPY LOGIN</button><button class="btn red" id="cok">DONE</button></div>`);
    m.$('#cok').onclick = m.close;
    m.$('#ccp').onclick = async () => { try { await navigator.clipboard.writeText(`Site: ${location.origin + location.pathname}\nHandle: ${username}\nPasscode: ${password}`); toast('Login copied.'); } catch { toast('Copy failed — select the text manually.', 'err'); } };
  }
  function renderPlayers() {
    const ps = S.players.filter((p) => p.role === 'player');
    main.innerHTML = `<div class="ang" style="flex:1;min-width:0"><div class="in">
      <div class="lhead"><span>PLAYERS · ${ps.length}</span><button class="btn red sm" id="np">+ CREATE PLAYER</button></div>
      <div class="scroll"><table class="tbl"><thead><tr><th>Handle</th><th>Character</th><th>Status</th><th>Threads</th><th>Unread</th><th></th></tr></thead><tbody>
      ${ps.map((p) => { const cs = S.convs.filter((c) => c.player_id === p.id), un = cs.reduce((n, c) => n + (S.unread.get(c.id) || 0), 0);
        return `<tr data-id="${p.id}"><td class="mono">${esc(p.username)}</td><td>${esc(p.character_name || '—')}</td><td><span class="tag ${p.disabled ? 'r' : 'g'}">${p.disabled ? 'DISABLED' : 'ACTIVE'}</span></td><td>${cs.length}</td><td>${un ? `<span class="badge">${un}</span>` : '0'}</td>
        <td><div class="act"><button class="btn sm" data-a="hist">HISTORY</button><button class="btn sm" data-a="msg">MESSAGE</button><button class="btn sm ghost" data-a="edit">EDIT</button><button class="btn sm ghost" data-a="pw">RESET PASSCODE</button><button class="btn sm ghost" data-a="dis">${p.disabled ? 'ENABLE' : 'DISABLE'}</button><button class="btn sm ghost" data-a="del">DELETE</button></div></td></tr>`; }).join('') || '<tr><td colspan="6" class="mut" style="padding:24px">No players yet. Create the first one — their private messaging environment is built automatically.</td></tr>'}
      </tbody></table></div></div></div>`;
  }
  function createPlayerModal() {
    const m = modal(`<h3>CREATE PLAYER</h3><p class="hint">Their inbox, GM channel and welcome message are created automatically.</p>
      <label>Handle (username)</label><input id="pu" maxlength="32" autocapitalize="none" spellcheck="false" placeholder="e.g. vex">
      <label>Character name</label><input id="pc" maxlength="60" placeholder="e.g. V">
      <label>Passcode</label><input id="pp" type="text" maxlength="72" placeholder="leave blank to generate a strong one" autocomplete="off">
      <div class="err" id="pe"></div><div class="acts"><button class="btn ghost" id="pcan">CANCEL</button><button class="btn red" id="pgo">CREATE</button></div>`);
    m.$('#pcan').onclick = m.close;
    m.$('#pgo').onclick = async () => {
      const b = m.$('#pgo'); b.disabled = true; b.innerHTML = '<span class="spin"></span>PROVISIONING';
      try {
        const r = await api.admin({ action: 'create', username: m.$('#pu').value, character_name: m.$('#pc').value, password: m.$('#pp').value });
        m.close(); credModal('PLAYER CREATED', r.username, r.password); await refresh();
      } catch (e) { m.$('#pe').textContent = '✖ ' + e.message; b.disabled = false; b.textContent = 'CREATE'; }
    };
  }
  async function playerAction(a, id) {
    const p = player(id); if (!p) return;
    if (a === 'hist') { S.filter = { player: id, unread: false, scope: 'all', q: '' }; S.tab = 'inbox'; S.sel = null; main.innerHTML = ''; renderTabs(); return renderTab(true); }
    if (a === 'msg') return composeModal({ player: id });
    if (a === 'edit') {
      const m = modal(`<h3>EDIT PLAYER</h3><label>Handle (username)</label><input id="eu" maxlength="32" value="${esc(p.username)}"><label>Character name</label><input id="ec" maxlength="60" value="${esc(p.character_name)}">
        <div class="hint">Changing the handle changes the login name too.</div><div class="err" id="ee"></div><div class="acts"><button class="btn ghost" id="ecan">CANCEL</button><button class="btn red" id="esave">SAVE</button></div>`);
      m.$('#ecan').onclick = m.close;
      m.$('#esave').onclick = async () => { try { await api.admin({ action: 'update', id, username: m.$('#eu').value, character_name: m.$('#ec').value }); m.close(); toast('Player updated.'); await refresh(); } catch (e) { m.$('#ee').textContent = '✖ ' + e.message; } };
    }
    if (a === 'pw') {
      const m = modal(`<h3>RESET PASSCODE</h3><p class="hint">For ${esc(p.username)}. Leave blank to generate a strong one.</p><input id="rp" maxlength="72" placeholder="new passcode (optional)" autocomplete="off"><div class="err" id="re"></div><div class="acts"><button class="btn ghost" id="rcan">CANCEL</button><button class="btn red" id="rgo">RESET</button></div>`);
      m.$('#rcan').onclick = m.close;
      m.$('#rgo').onclick = async () => { try { const r = await api.admin({ action: 'reset_password', id, password: m.$('#rp').value }); m.close(); credModal('PASSCODE RESET', p.username, r.password); } catch (e) { m.$('#re').textContent = '✖ ' + e.message; } };
    }
    if (a === 'dis') {
      const to = !p.disabled;
      if (!(await confirmBox(to ? 'Disable player?' : 'Enable player?', to ? `${p.username} will be signed out and unable to log in. Their messages are kept.` : `${p.username} will be able to log in again.`, { ok: to ? 'DISABLE' : 'ENABLE', danger: to }))) return;
      try { await api.admin({ action: 'set_disabled', id, disabled: to }); toast(to ? 'Player disabled.' : 'Player enabled.'); await refresh(); } catch (e) { toast(e.message, 'err'); }
    }
    if (a === 'del') {
      const m = modal(`<h3>DELETE PLAYER</h3><p>This permanently erases <b>${esc(p.username)}</b>, all their messages, contacts and portraits.</p><label>Type the handle to confirm</label><input id="dc" autocomplete="off"><div class="err" id="de"></div><div class="acts"><button class="btn ghost" id="dcan">CANCEL</button><button class="btn solid" id="dgo">DELETE FOREVER</button></div>`);
      m.$('#dcan').onclick = m.close;
      m.$('#dgo').onclick = async () => {
        if (m.$('#dc').value.trim().toLowerCase() !== p.username) { m.$('#de').textContent = '✖ The handle does not match.'; return; }
        try { await api.admin({ action: 'delete', id }); m.close(); toast('Player deleted.'); if (S.filter.player === id) S.filter.player = ''; await refresh(); } catch (e) { m.$('#de').textContent = '✖ ' + e.message; }
      };
    }
  }

  // ------------------------------------------------------------ senders (identities)
  function renderIdents() {
    const rows = S.idents.filter((i) => i.kind !== 'player');
    main.innerHTML = `<div class="ang" style="flex:1;min-width:0"><div class="in">
      <div class="lhead"><span>SENDER IDENTITIES</span><button class="btn red sm" id="ni">+ NEW NPC SENDER</button></div>
      <div class="pad hint" style="padding-bottom:0">Write to players <b>as</b> any of these. Players see an NPC as <b>UNKNOWN</b> until they add it to their own contacts — and can name it whatever they like. The real name below is visible to you only.</div>
      <div class="scroll"><table class="tbl"><thead><tr><th>Name (GM only)</th><th>Type</th><th>Notes</th><th>Threads</th><th></th></tr></thead><tbody>
      ${rows.map((i) => `<tr data-id="${i.id}"><td><b>${esc(i.name)}</b></td><td><span class="tag ${i.kind === 'gm' ? 'c' : 'y'}">${i.kind === 'gm' ? 'GM' : 'NPC'}</span></td><td>${esc(i.notes || '—')}</td><td>${S.convs.filter((c) => c.identity_id === i.id).length}</td>
        <td><div class="act"><button class="btn sm" data-a="msg">MESSAGE</button>${i.kind === 'npc' ? '<button class="btn sm ghost" data-a="edit">EDIT</button><button class="btn sm ghost" data-a="del">DELETE</button>' : ''}</div></td></tr>`).join('')}
      </tbody></table></div></div></div>`;
  }
  function identModal(i) {
    const m = modal(`<h3>${i ? 'EDIT' : 'NEW'} NPC SENDER</h3><label>Name (GM only)</label><input id="in" maxlength="60" value="${esc(i?.name || '')}" placeholder="e.g. Regina Jones"><label>Notes</label><textarea id="ino" maxlength="500">${esc(i?.notes || '')}</textarea>
      <div class="err" id="ie"></div><div class="acts"><button class="btn ghost" id="icn">CANCEL</button><button class="btn red" id="isv">SAVE</button></div>`);
    m.$('#icn').onclick = m.close;
    m.$('#isv').onclick = async () => {
      const name = m.$('#in').value.trim(); if (!name) { m.$('#ie').textContent = '✖ Enter a name.'; return; }
      try { if (i) await api.updateIdentity(i.id, { name, notes: m.$('#ino').value.trim() }); else await api.createNpc(name, m.$('#ino').value.trim()); m.close(); toast('Saved.'); await refresh(); }
      catch (e) { m.$('#ie').textContent = '✖ ' + e.message; }
    };
  }

  // ------------------------------------------------------------ settings
  function renderSettings() {
    main.innerHTML = `<div class="ang" style="flex:1;min-width:0"><div class="in"><div class="lhead"><span>SETTINGS</span></div><div class="pad scroll">
      <div class="switch"><label class="chk" style="margin:0"><input type="checkbox" id="p2p"${S.p2p ? ' checked' : ''}> PLAYER-TO-PLAYER MESSAGING</label></div>
      <p class="hint">Off by default. When on, players can message each other directly (you can always read those threads from the Inbox → Players → History). When off, players can only write to you.</p>
      <div class="note">Account: <b>${esc(profile.username)}</b> · GM. Players can never change roles or permissions; every rule is enforced in the database.</div>
    </div></div></div>`;
  }

  // ------------------------------------------------------------ events
  app.addEventListener('click', async (e) => {
    const t = e.target.closest('button,.crow'); if (!t) return;
    if (t.classList.contains('crow')) return selectConv(t.dataset.id);
    if (t.dataset.tab) { S.tab = t.dataset.tab; main.innerHTML = ''; renderTabs(); return renderTab(true); }
    const c = S.sel && conv(S.sel), tr = t.closest('tr[data-id]');
    if (tr && t.dataset.a) {
      if (S.tab === 'ids') {
        const i = ident(tr.dataset.id);
        if (t.dataset.a === 'msg') return composeModal({ identity: i.id });
        if (t.dataset.a === 'edit') return identModal(i);
        if (t.dataset.a === 'del') {
          if (await confirmBox('Delete sender?', `Deleting "${i.name}" also erases every conversation with this sender, for all players.`, { ok: 'DELETE', danger: true })) {
            try { await api.deleteIdentity(i.id); toast('Sender deleted.'); await refresh(); } catch (er) { toast(er.message, 'err'); }
          }
        }
        return;
      }
      return playerAction(t.dataset.a, tr.dataset.id);
    }
    switch (t.id) {
      case 'newb': return composeModal(S.sel && conv(S.sel) ? { player: conv(S.sel).player_id } : {});
      case 'out': return signOut();
      case 'np': return createPlayerModal();
      case 'ni': return identModal(null);
      case 'gsend': return sendReply();
      case 'gback': S.sel = null; return renderTab(false);
      case 'gread': try { await api.markRead(c.id, ['from_player']); toast('Marked as read.'); await refresh(); } catch (er) { toast(er.message, 'err'); } return;
      case 'garch': try { await api.setConvFlags(c.id, { archived_by_gm: !c.archived_by_gm }); toast(c.archived_by_gm ? 'Conversation restored.' : 'Conversation archived.'); await refresh(); } catch (er) { toast(er.message, 'err'); } return;
      case 'alerts': { const r = await askNotifyPermission(); toast(r === 'granted' ? 'Desktop alerts enabled.' : 'Alerts unavailable or blocked.', r === 'granted' ? 'info' : 'err'); }
    }
  });
  app.addEventListener('change', async (e) => {
    const t = e.target;
    if (t.id === 'fp') S.filter.player = t.value; else if (t.id === 'fs') S.filter.scope = t.value; else if (t.id === 'fu') S.filter.unread = t.checked;
    else if (t.id === 'p2p') { try { await api.setP2p(t.checked); S.p2p = t.checked; toast(t.checked ? 'Player-to-player messaging enabled.' : 'Player-to-player messaging disabled.'); } catch (er) { t.checked = !t.checked; toast(er.message, 'err'); } return; }
    else return;
    renderList();
  });
  app.addEventListener('input', (e) => { if (e.target.id === 'fq') { S.filter.q = e.target.value; renderList(); } });
  const onFocus = () => { readOpen().then(() => refresh()); };
  window.addEventListener('focus', onFocus);

  // ------------------------------------------------------------ boot
  await refresh(true);
  const stop = api.subscribe((ev) => {
    if (ev.table === 'messages' && ev.eventType === 'INSERT' && ev.new?.direction === 'from_player') { pending.push(ev.new); S.fresh.add(ev.new.id); }
    refreshSoon();
  });
  const origOut = signOut;
  signOut = async () => { stop(); window.removeEventListener('focus', onFocus); setTitleCount(0); await origOut(); };
}
