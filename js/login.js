import * as api from './api.js';
import { esc, $ } from './ui.js';
import { isDemo } from './backend.js';

export function showLogin(root, onDone, note = '') {
  root.innerHTML = `<div class="login"><div class="ang"><div class="in">
    <div class="logo">NIGHT CITY<small>// MESSENGER · 2078</small></div>
    <form id="lf" autocomplete="on" style="margin-top:22px">
      <label for="lu">Handle</label><input id="lu" name="username" autocomplete="username" autocapitalize="none" spellcheck="false" required>
      <label for="lp">Passcode</label><input id="lp" name="password" type="password" autocomplete="current-password" required>
      <div class="err" id="le">${esc(note)}</div>
      <div class="row sp" style="margin-top:12px"><span class="tiny mono mut">NETWATCH RELAY</span><button class="btn red" id="lb">JACK IN</button></div>
    </form>
    ${isDemo ? `<div class="note">DEMO MODE · no server. Try <b>gm / gm</b>, <b>vex / vex</b> or <b>kira / kira</b> (use two tabs to see live delivery).</div>` : ''}
    <div class="deco"><span>NET//MSG v1.0</span><span>${'0x' + Math.floor(Math.random() * 0xffffff).toString(16).toUpperCase().padStart(6, '0')}</span></div>
  </div></div></div>`;
  const f = $('#lf', root);
  f.addEventListener('submit', async (e) => {
    e.preventDefault();
    const b = $('#lb', root), err = $('#le', root);
    b.disabled = true; err.textContent = ''; b.innerHTML = '<span class="spin"></span>LINKING';
    try {
      await api.signIn(f.username.value, f.password.value);
      await onDone();
    } catch (ex) {
      err.textContent = '✖ ' + ex.message;
      b.disabled = false; b.textContent = 'JACK IN';
    }
  });
  setTimeout(() => $('#lu', root)?.focus(), 30);
}
