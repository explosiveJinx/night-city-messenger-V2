import { $, esc } from './ui.js';
import { isConfigured, isDemo } from './backend.js';

const root = $('#app');

function showSetup() {
  root.innerHTML = `<div class="login"><div class="ang"><div class="in">
    <div class="logo">NIGHT CITY<small>// SETUP REQUIRED</small></div>
    <p style="margin-top:18px">This site isn't connected to a Supabase project yet.</p>
    <p class="hint">Open <span class="mono">js/config.js</span> and set <b>SUPABASE_URL</b> and <b>SUPABASE_PUBLISHABLE_KEY</b> (Project Settings → API), then reload.<br>Full instructions are in <span class="mono">README.md</span>.</p>
    <p class="hint">Just want to look around? Add <span class="mono">?demo</span> to the address.</p>
  </div></div></div>`;
}

async function boot() {
  if (!isConfigured && !isDemo) return showSetup();
  const api = await import('./api.js');
  const { showLogin } = await import('./login.js');

  async function route(note = '') {
    root.innerHTML = '<div class="loading"><span class="spin"></span>ESTABLISHING LINK…</div>';
    let profile = null;
    try { profile = await api.myProfile(); }
    catch (e) { await api.signOut(); return showLogin(root, route, 'Connection problem: ' + e.message); }
    if (!profile) return showLogin(root, route, note);
    if (profile.disabled) { await api.signOut(); return showLogin(root, route, 'This account has been disabled. Contact your GM.'); }
    const out = async () => { await api.signOut(); showLogin(root, route); };
    if (profile.role === 'gm') (await import('./gm.js')).startGm(root, profile, out);
    else (await import('./player.js')).startPlayer(root, profile, out);
  }
  api.sb.auth.onAuthStateChange((ev) => { if (ev === 'SIGNED_OUT' && !$('.login')) showLogin(root, route); });
  route();
}
boot().catch((e) => { console.error(e); root.innerHTML = `<div class="login"><div class="ang"><div class="in"><div class="logo">ERROR</div><p class="err">${esc(e.message)}</p></div></div></div>`; });
