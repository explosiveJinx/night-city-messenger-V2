// Small DOM helpers shared by every screen.
export const $ = (s, r = document) => r.querySelector(s);
export const $$ = (s, r = document) => [...r.querySelectorAll(s)];
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export function toast(msg, kind = 'info', ms = 4200) {
  let box = $('#toasts');
  if (!box) { box = document.createElement('div'); box.id = 'toasts'; document.body.append(box); }
  const t = document.createElement('div');
  t.className = 'toast ' + kind;
  t.textContent = msg;
  box.append(t);
  setTimeout(() => { t.classList.add('out'); setTimeout(() => t.remove(), 320); }, ms);
}

export function modal(html, { wide = false } = {}) {
  const o = document.createElement('div');
  o.className = 'overlay';
  o.innerHTML = `<div class="ang modal${wide ? ' wide' : ''}" role="dialog" aria-modal="true"><div class="in">${html}</div></div>`;
  document.body.append(o);
  const key = (e) => { if (e.key === 'Escape') close(); };
  const close = () => { o.remove(); document.removeEventListener('keydown', key); };
  document.addEventListener('keydown', key);
  o.addEventListener('mousedown', (e) => { if (e.target === o) close(); });
  const first = o.querySelector('input:not([type=file]):not([type=checkbox]),textarea,select');
  if (first) setTimeout(() => first.focus(), 30);
  return { el: o, close, $: (s) => o.querySelector(s), $$: (s) => [...o.querySelectorAll(s)] };
}

export function confirmBox(title, text, { ok = 'CONFIRM', danger = false } = {}) {
  return new Promise((res) => {
    const m = modal(`<h3>${esc(title)}</h3><p>${esc(text)}</p>
      <div class="acts"><button class="btn ghost" data-x="0">CANCEL</button><button class="btn ${danger ? 'solid' : 'red'}" data-x="1">${esc(ok)}</button></div>`);
    let done = false;
    const fin = (v) => { if (!done) { done = true; m.close(); res(v); } };
    m.el.addEventListener('click', (e) => { const b = e.target.closest('[data-x]'); if (b) fin(b.dataset.x === '1'); });
    new MutationObserver(() => { if (!document.body.contains(m.el)) fin(false); }).observe(document.body, { childList: true });
  });
}

const pad = (n) => String(n).padStart(2, '0');
export const clock = (ts) => { const d = new Date(ts); return `${pad(d.getHours())}:${pad(d.getMinutes())}`; };
export const dayKey = (ts) => { const d = new Date(ts); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
export function dayLabel(ts) {
  const d = new Date(ts), now = new Date();
  if (dayKey(ts) === dayKey(now)) return 'TODAY';
  const y = new Date(now); y.setDate(now.getDate() - 1);
  if (dayKey(ts) === dayKey(y)) return 'YESTERDAY';
  return `${pad(d.getDate())}.${pad(d.getMonth() + 1)}.${d.getFullYear()}`;
}
export function ago(ts) {
  const s = Math.max(0, (Date.now() - new Date(ts)) / 1000);
  if (s < 60) return 'NOW';
  if (s < 3600) return Math.floor(s / 60) + 'M';
  if (s < 86400) return Math.floor(s / 3600) + 'H';
  const d = new Date(ts); return `${pad(d.getDate())}.${pad(d.getMonth() + 1)}`;
}

const PLACEHOLDER = `<svg viewBox="0 0 64 64" aria-hidden="true"><rect width="64" height="64" fill="#1a060c"/><circle cx="32" cy="24" r="11" fill="#5c1424"/><path d="M10 64c0-14 10-22 22-22s22 8 22 22z" fill="#5c1424"/></svg>`;
const UNKNOWN = `<svg viewBox="0 0 64 64" aria-hidden="true"><rect width="64" height="64" fill="#160b02"/><text x="32" y="46" text-anchor="middle" font-family="monospace" font-size="42" fill="#fcee0a">?</text></svg>`;
/** square portrait html. known=false -> UNKNOWN glyph */
export function avatar(url, { known = true, size = '' } = {}) {
  const inner = url ? `<img src="${esc(url)}" alt="" loading="lazy">` : (known ? PLACEHOLDER : UNKNOWN);
  return `<div class="av ${size}${known ? '' : ' unk'}">${inner}</div>`;
}

/** Browser notification + soft beep (both optional). */
let actx;
export function beep() {
  try {
    actx = actx || new (window.AudioContext || window.webkitAudioContext)();
    const o = actx.createOscillator(), g = actx.createGain();
    o.type = 'square'; o.frequency.setValueAtTime(880, actx.currentTime); o.frequency.setValueAtTime(1320, actx.currentTime + .08);
    g.gain.setValueAtTime(.04, actx.currentTime); g.gain.exponentialRampToValueAtTime(.0001, actx.currentTime + .22);
    o.connect(g).connect(actx.destination); o.start(); o.stop(actx.currentTime + .24);
  } catch { /* audio not available */ }
}
export function systemNotify(title, body) {
  try { if ('Notification' in window && Notification.permission === 'granted' && document.hidden) new Notification(title, { body }); } catch { /* ignore */ }
}
export async function askNotifyPermission() {
  if (!('Notification' in window)) return 'unsupported';
  if (Notification.permission === 'default') return await Notification.requestPermission();
  return Notification.permission;
}
let baseTitle = document.title;
export function setTitleCount(n) { document.title = (n > 0 ? `(${n}) ` : '') + baseTitle; }
export const debounce = (fn, ms) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };
