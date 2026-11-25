(() => { 'use strict';
const $ = s => document.getElementById(s);
const el = (t, c, x) => { const e = document.createElement(t); if (c) e.className = c; if (x != null) e.textContent = x; return e; };
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const S = { sessions: [], status: {}, board: {}, cur: null, es: null, esAll: null, seen: new Set(), cursor: null, typing: '', queue: [], atts: [], shown: 60, gen: 0, drafts: {}, sending: false };
let toastT; const toast = (t, ms = 3500) => { const e = $('toast'); e.textContent = t; e.classList.add('on'); clearTimeout(toastT); toastT = setTimeout(() => e.classList.remove('on'), ms); };
const view = v => { for (const x of ['vLogin', 'vList', 'vChat', 'vNew']) $(x).hidden = x !== v; };
async function api(p, body) {
  const r = await fetch(p, body === undefined ? {} : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  if (r.status === 401 && p !== '/api/login') { closeAll(); view('vLogin'); throw new Error('Entre com a senha'); }
  const j = await r.json().catch(() => ({})); if (!r.ok) throw new Error(j.error || 'Erro ' + r.status); return j;
}
const ago = t => { const s = (Date.now() - new Date(t)) / 1000; return s < 60 ? 'agora' : s < 3600 ? Math.floor(s / 60) + ' min' : s < 86400 ? Math.floor(s / 3600) + ' h' : Math.floor(s / 86400) + ' d'; };
const base = p => String(p || '').split('/').filter(Boolean).pop() || '~';
const running = id => !!(S.status[id] && S.status[id].running);
function closeAll() { if (S.es) S.es.close(); if (S.esAll) S.esAll.close(); S.es = S.esAll = null; }

/* texto -> html seguro: escapa tudo antes de formatar */
function inl(t) {
  const keep = []; const hold = h => '\u0000' + (keep.push(h) - 1) + '\u0000';
  t = String(t).replace(/\u0000/g, '').replace(/`([^`\n]+)`/g, (_, c) => hold('<code>' + esc(c) + '</code>'));
  t = t.replace(/\[([^\]\n]+)\]\((https?:\/\/[^\s)]+)\)/g, (_, a, u) => hold(`<a href="${esc(u)}" target="_blank" rel="noopener noreferrer">${esc(a)}</a>`));
  t = t.replace(/https?:\/\/[^\s<>"'\u0000)*]+/g, u => hold(`<a href="${esc(u)}" target="_blank" rel="noopener noreferrer">${esc(u)}</a>`));
  t = esc(t).replace(/\*\*([^*\n]+)\*\*/g, '<b>$1</b>');
  for (let i = 0; i < 3; i++) t = t.replace(/\u0000(\d+)\u0000/g, (_, n) => keep[+n] || '');
  return t;
}
function md(src) {
  const L = String(src).replace(/\r/g, '').split('\n'); let h = '', i = 0, p = [];
  const flush = () => { if (p.length) { h += '<p>' + p.map(inl).join('<br>') + '</p>'; p = []; } };
  while (i < L.length) {
    const l = L[i]; let m;
    if (/^\s*```/.test(l)) { flush(); const c = []; i++; while (i < L.length && !/^\s*```/.test(L[i])) c.push(L[i++]); i++; h += '<pre><code>' + esc(c.join('\n')) + '</code></pre>'; continue; }
    if ((m = l.match(/^#{1,6}\s+(.*)/))) { flush(); h += '<h3>' + inl(m[1]) + '</h3>'; i++; continue; }
    if (/^\s*\|.*\|\s*$/.test(l) && /^\s*\|[\s:|-]+\|\s*$/.test(L[i + 1] || '')) {
      flush(); const row = (r, t) => '<tr>' + r.trim().replace(/^\||\|$/g, '').split('|').map(c => `<${t}>${inl(c.trim())}</${t}>`).join('') + '</tr>';
      h += '<div class="tw"><table>' + row(l, 'th'); i += 2; while (i < L.length && /^\s*\|.*\|\s*$/.test(L[i])) h += row(L[i++], 'td'); h += '</table></div>'; continue;
    }
    if (/^\s*([-*]|\d+[.)])\s+/.test(l)) {
      flush(); const n = l.match(/^\s*(\d+)/), tag = n ? 'ol' : 'ul'; h += n ? `<ol start="${+n[1]}">` : '<ul>';
      while (i < L.length && (m = L[i].match(/^\s*(?:[-*]|(\d+)[.)])\s+(.*)/)) && !!m[1] === !!n) { h += '<li>' + inl(m[2]) + '</li>'; i++; }
      h += `</${tag}>`; continue;
    }
    if (!l.trim()) flush(); else p.push(l); i++;
  }
  flush(); return h;
}

/* lista */
async function load() {
  const j = await api('/api/state'); S.sessions = j.sessions || []; S.status = j.status || {}; S.board = j.board || {}; S.models = j.models || {}; S.home = j.home; renderList(); renderProg();
}
async function checkClaude() { try { const j = await (await fetch('/api/claude/vps-status')).json(); for (const w of ['w1', 'w2']) $(w).hidden = j.loggedIn !== false; } catch { } }
function renderList() {
  const q = $('q').value.trim().toLowerCase(); const L = $('list'); const top = L.scrollTop;
  const m = S.sessions.filter(s => !q || [s.title, s.firstPrompt, s.lastText, s.cwd].join(' ').toLowerCase().includes(q));
  const n = S.sessions.filter(s => running(s.id)).length; $('lsub').textContent = `${S.sessions.length} conversas` + (n ? ` · ${n} rodando` : '');
  L.textContent = '';
  for (const s of m.slice(0, S.shown)) {
    const b = el('button', 'it'); b.append(el('b', '', s.title)); if (s.lastText) b.append(el('p', '', s.lastText.slice(0, 220)));
    const f = el('span'); if (running(s.id)) f.append(el('em', 'run', '● rodando')); f.append(el('i', '', base(s.cwd)), el('em', '', ago(s.mtime))); b.append(f);
    b.onclick = () => { location.hash = s.id; }; L.append(b);
  }
  if (m.length > S.shown) { const b = el('button', 'more', `Mostrar mais (${m.length - S.shown})`); b.onclick = () => { S.shown += 60; renderList(); }; L.append(b); }
  if (!m.length) L.append(el('p', 'm sys', q ? 'Nenhuma conversa encontrada' : 'Nenhuma conversa ainda'));
  L.scrollTop = top;
}
$('q').oninput = () => { S.shown = 60; renderList(); };

/* conversa */
const M = $('msgs'); const atEnd = () => M.scrollHeight - M.scrollTop - M.clientHeight < 140; const toEnd = () => { M.scrollTop = M.scrollHeight; };
function det(title, text, err) { const d = el('details', err ? 'err' : ''); const s = el('summary'); s.append(el('span', '', title)); d.append(s); let done; d.ontoggle = () => { if (d.open && !done) { done = 1; d.append(el('pre', '', text || '(vazio)')); } }; return d; }
function node(it) {
  if (it.kind === 'user') { const d = el('div', 'm user', it.text || ''); if (it.img && /^(data:image\/|https?:)/.test(it.img)) { const g = el('img'); g.src = it.img; g.alt = 'Imagem enviada'; d.append(g); } return d; }
  if (it.kind === 'assistant' || it.kind === 'local') { const d = el('div', 'm assistant'); d.innerHTML = md(it.text || ''); return d; }
  if (it.kind === 'system') return el('div', 'm sys', it.text);
  if (it.kind === 'thinking') return det('Pensamento', it.text);
  if (it.kind === 'tool') {
    if (it.questions) { const d = el('div', 'm assistant'); for (const q of it.questions) { d.append(el('p', '', q.q)); const u = el('ul'); for (const o of q.o || []) u.append(el('li', '', o)); d.append(u); } return d; }
    return det(it.name + (it.summary ? ': ' + it.summary : ''), it.cmd || it.input);
  }
  if (it.kind === 'tool_result') return it.error ? det('Erro da ferramenta', it.text, true) : det('Resultado', it.text);
  return null;
}
const norm = t => String(t || '').replace(/\s+/g, ' ').trim();
function add(items, before) {
  const fr = document.createDocumentFragment(); const end = atEnd(); const h = M.scrollHeight; let any = false;
  for (const it of items) {
    if (S.seen.has(it.id)) continue; S.seen.add(it.id);
    if (it.kind === 'user') { const p = [...M.querySelectorAll('.pend')].find(x => norm(it.text).includes(norm(x.dataset.t)) || !norm(it.text)); if (p) p.remove(); }
    if (it.kind === 'assistant') { S.typing = ''; typing(); }
    const n = node(it); if (n) { fr.append(n); any = true; }
  }
  if (!any) return;
  if (before) { const b = $('older'); M.insertBefore(fr, b ? b.nextSibling : M.firstChild); M.scrollTop += M.scrollHeight - h; }
  else { const first = M.querySelector('.pend,#typing'); M.insertBefore(fr, first); if (end) toEnd(); }
}
function typing() { let t = $('typing'); if (!S.typing) { if (t) t.remove(); return; } const end = atEnd(); if (!t) { t = el('div', 'm assistant'); t.id = 'typing'; M.append(t); } t.innerHTML = md(S.typing); if (end) toEnd(); }
function older() {
  let b = $('older'); if (S.cursor == null) { if (b) b.remove(); return; }
  if (!b) { b = el('button', 'more', 'Mensagens anteriores'); b.id = 'older'; M.prepend(b);
    b.onclick = async () => { const id = S.cur, g = S.gen; b.disabled = true; try { const j = await api(`/api/session/${id}/messages?before=${S.cursor}`); if (g !== S.gen) return; S.cursor = j.cursor; add(j.items, true); older(); } catch (e) { toast(e.message); } b.disabled = false; }; }
}
function renderProg() {
  const id = S.cur; if (!id) return; const st = S.status[id] || {}; $('bStop').hidden = !st.running; $('prog').hidden = !st.running;
  if (st.running) $('prog').textContent = '● ' + (st.tool ? `${st.phase || 'trabalhando'}: ${st.tool}` : st.phase || 'trabalhando');
}
function renderQueue() {
  const Q = $('queue'); Q.textContent = '';
  S.queue.forEach((m, i) => { const d = el('div'); d.append(el('span', '', 'Na fila: ' + (m.text || `${m.n} anexo(s)`)));
    const a = el('button', '', 'Já'); a.title = 'Enviar agora'; a.setAttribute('aria-label', 'Interromper e enviar agora'); a.onclick = () => api(`/api/session/${S.cur}/promote`, { index: i }).catch(e => toast(e.message));
    const x = el('button', '', '✕'); x.setAttribute('aria-label', 'Tirar da fila'); x.onclick = () => api(`/api/session/${S.cur}/unqueue`, { index: i }).catch(e => toast(e.message)); d.append(a, x); Q.append(d); });
}
function head() { const s = S.sessions.find(x => x.id === S.cur); $('ct').textContent = s ? s.title : 'Conversa nova'; $('cs').textContent = s ? base(s.cwd) : ''; }
async function open(id, keep) {
  const g = ++S.gen; if (S.es) { S.es.close(); S.es = null; }
  if (S.cur !== id) { if (S.cur) S.drafts[S.cur] = $('tx').value; S.atts = []; renderAtts(); $('tx').value = S.drafts[id] || ''; grow(); }
  S.cur = id; view('vChat'); head(); S.typing = '';
  if (!keep) { S.seen.clear(); S.cursor = null; S.queue = []; M.textContent = ''; M.append(el('div', 'm sys', 'Carregando…')); renderQueue(); }
  renderProg();
  try {
    let j; for (let k = 0; ; k++) { try { j = await api(`/api/session/${id}/messages`); break; } catch (e) { if (k < 8 && /não encontrada/.test(e.message)) { await new Promise(r => setTimeout(r, 1000)); if (g !== S.gen) return; continue; } throw e; } }
    if (g !== S.gen) return; if (!keep) { M.textContent = ''; S.cursor = j.cursor; add(j.items); older(); toEnd(); } else add(j.items);
    stream(id, g);
  } catch (e) { if (g !== S.gen) return; if (!keep) M.textContent = ''; toast(e.message, 6000); }
}
function stream(id, g) {
  const es = new EventSource(`/api/session/${id}/stream`); S.es = es; let first = true; const ok = () => g === S.gen;
  const on = (ev, f) => es.addEventListener(ev, e => { if (ok()) f(JSON.parse(e.data)); });
  /* ao abrir (ou reconectar) relê o fim da conversa: nada se perde no intervalo */
  es.onopen = async () => { if (!ok()) return; try { const j = await api(`/api/session/${id}/messages`); if (ok()) { if (!first) { S.typing = ''; typing(); } first = false; add(j.items); } } catch { } };
  on('state', d => { S.status[id] = d; renderProg(); }); on('items', d => add(d.items || [])); on('queue', d => { S.queue = d.queue || []; renderQueue(); });
  on('delta', d => { S.typing += d.text || ''; typing(); }); on('delta_reset', () => { S.typing = ''; typing(); }); on('notice', d => toast(d.text, 6000));
  on('done', d => { S.typing = ''; typing(); S.status[id] = { running: false, ...d }; renderProg(); if (d.error) { const end = atEnd(); M.append(el('div', 'm err', String(d.error).slice(0, 600))); if (end) toEnd(); checkClaude(); } });
}
function grow() { const t = $('tx'); t.style.height = 'auto'; t.style.height = Math.min(t.scrollHeight + 4, innerHeight * .34) + 'px'; } $('tx').oninput = grow;
function renderAtts() { const A = $('atts'); A.textContent = ''; S.atts.forEach((a, i) => { const b = el('button', '', a.name + ' ✕'); b.type = 'button'; b.setAttribute('aria-label', 'Remover ' + a.name); b.onclick = () => { S.atts.splice(i, 1); renderAtts(); }; A.append(b); }); }
$('bAtt').onclick = () => $('file').click();
$('file').onchange = async () => {
  const id = S.cur; const fs = [...$('file').files]; $('file').value = '';
  for (const f of fs) { try { if (f.size > 45e6) throw new Error(f.name + ': maior que 45 MB'); toast('Enviando ' + f.name + '…', 60000);
    const data = await new Promise((r, x) => { const R = new FileReader(); R.onload = () => r(R.result); R.onerror = () => x(new Error('Não consegui ler o arquivo')); R.readAsDataURL(f); });
    const j = await api('/api/upload', { name: f.name, data }); if (S.cur === id) { S.atts.push({ path: j.path, name: j.name }); renderAtts(); } toast('Anexado'); } catch (e) { toast(e.message, 5000); } }
};
$('cf').onsubmit = async ev => {
  ev.preventDefault(); const text = $('tx').value.trim(), id = S.cur, atts = S.atts; if (S.sending || (!text && !atts.length)) return;
  S.sending = true; $('bSend').disabled = true; const p = (S.board.prefs || {})[id] || {};
  try {
    const r = await api(`/api/session/${id}/send`, { text, model: p.model || 'opus', effort: p.effort || 'medium', permission: p.perm || 'bypassPermissions', attachments: atts });
    if (S.cur === id) { $('tx').value = ''; S.atts = []; renderAtts(); grow(); if (!r.queued && text) { const d = el('div', 'm user pend', text); d.dataset.t = text; M.append(d); toEnd(); } }
    delete S.drafts[id]; if (r.queued) toast('Entrou na fila');
  } catch (e) { toast(e.message, 6000); }
  S.sending = false; $('bSend').disabled = false;
};
$('bStop').onclick = async () => { if (!confirm('Parar esta conversa? A fila dela também é apagada.')) return; try { await api(`/api/session/${S.cur}/stop`, {}); toast('Parando…'); } catch (e) { toast(e.message); } };
/* nova */
$('bNew').onclick = () => { location.hash = 'nova'; };
function openNew() {
  view('vNew'); const c = new Map(); for (const s of S.sessions) if (s.cwd) c.set(s.cwd, (c.get(s.cwd) || 0) + 1); if (S.home && !c.has(S.home)) c.set(S.home, 0);
  const D = $('ndir'); D.textContent = ''; for (const [d] of [...c].sort((a, b) => b[1] - a[1]).slice(0, 80)) { const o = el('option', '', d.replace(S.home || '\u0000', '~')); o.value = d; D.append(o); }
  const N = $('nmodel'); N.textContent = ''; for (const k of Object.keys(S.models).length ? Object.keys(S.models) : ['opus']) { const o = el('option', '', k); o.value = k; N.append(o); } N.value = 'opus';
}
$('nf').onsubmit = async ev => { ev.preventDefault(); const text = $('ntx').value.trim(); if (!text) return; $('nGo').disabled = true;
  try { const j = await api('/api/new', { text, cwd: $('ndir').value, model: $('nmodel').value, effort: 'medium', permission: 'bypassPermissions' }); $('ntx').value = ''; await load(); location.replace('#' + j.id); } catch (e) { toast(e.message, 6000); } $('nGo').disabled = false; };
$('bBack').onclick = $('bBack2').onclick = () => { location.hash = ''; };
/* rota e início */
function route() {
  if (!S.ready) return; const h = location.hash.slice(1);
  if (/^[0-9a-f-]{36}$/.test(h)) return void open(h); S.gen++; if (S.es) { S.es.close(); S.es = null; } if (S.cur) S.drafts[S.cur] = $('tx').value; S.cur = null; S.atts = []; renderAtts();
  if (h === 'nova') return openNew(); view('vList'); renderList();
}
addEventListener('hashchange', route);
function events() {
  if (S.esAll) S.esAll.close(); const es = new EventSource('/api/events'); S.esAll = es; let t;
  const again = () => { clearTimeout(t); t = setTimeout(() => load().then(() => S.cur && head()).catch(() => { }), 600); };
  es.addEventListener('status', e => { const d = JSON.parse(e.data); S.status[d.id] = d.state; if (!$('vList').hidden) { clearTimeout(S.rt); S.rt = setTimeout(renderList, 400); } if (d.id === S.cur) renderProg(); });
  es.addEventListener('index', again);
}
async function boot() { try { await load(); S.ready = true; events(); checkClaude(); route(); } catch (e) { if ($('vLogin').hidden) { view('vList'); toast(e.message, 8000); } } }
$('lf').onsubmit = async ev => { ev.preventDefault(); $('lerr').textContent = ''; try { await api('/api/login', { password: $('pw').value }); $('pw').value = ''; $('pw').blur(); boot(); } catch (e) { $('lerr').textContent = e.message; } };
document.addEventListener('visibilitychange', () => { if (document.hidden || !S.ready) return; load().then(() => { events(); checkClaude(); if (S.cur) open(S.cur, true); }).catch(() => { }); });
boot();
})();
