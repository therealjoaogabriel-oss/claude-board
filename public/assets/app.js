'use strict';
/* Claude Board: quadro livre das conversas do Claude Code */
const $ = s => document.querySelector(s);
const el = (tag, cls, html) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; };
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const COLORS = ['#C9A24B', '#9A7D4D', '#EFE3C4', '#E0BF6E', '#6F6F6F', '#B9A27A', '#C0392B', '#F4F2EC'];
const MODEL_LABEL = { default: 'modelo da conversa', opus: 'Opus 5.5', sonnet: 'Sonnet 5.5', haiku: 'Haiku 5.5', fable: 'Fable 5.1' };
const FAMS = [['opus', 'Opus'], ['sonnet', 'Sonnet'], ['haiku', 'Haiku'], ['fable', 'Fable']];
function modelLabel(k) { if (MODEL_LABEL[k]) return MODEL_LABEL[k]; const m = (S.modelList || []).find(x => x.id === k); return m ? m.label : shortModel(k); }
function setModels(models, list) { // lista oficial vinda do servidor: atalho de cada família = o mais novo
  if (list && list.length) S.modelList = list;
  for (const [f] of FAMS) { const id = models && models[f]; if (id) { const m = (S.modelList || []).find(x => x.id === id); MODEL_LABEL[f] = m ? m.label : shortModel(id); } }
  for (const [sel, wd] of [['#nModel', false], ['#pModel', true]]) { const el = $(sel); if (!el) continue; const v = el.value; modelOptions(el, wd); if (v && [...el.options].some(o => o.value === v)) el.value = v; }
}

const S = { sessions: [], byId: {}, board: null, status: {}, models: {}, home: '', cur: null, tabs: [], view: { x: 40, y: 30, z: 1 }, items: [], cursor: null, es: null, typing: '' };
try { Object.assign(S.view, JSON.parse(localStorage.getItem('cb.view') || '{}')); } catch { }
try { S.tabs = JSON.parse(localStorage.getItem('cb.tabs') || '[]'); } catch { }

async function api(path, opt = {}) {
  const r = await fetch(path, { ...opt, headers: { 'Content-Type': 'application/json', ...(opt.headers || {}) }, body: opt.body && typeof opt.body !== 'string' ? JSON.stringify(opt.body) : opt.body });
  if (r.status === 401) { location.href = '/login'; throw new Error('login'); }
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || ('Erro ' + r.status));
  return j;
}
function toast(t, ms = 2600) { const e = $('#toast'); e.textContent = t; e.classList.add('on'); clearTimeout(toast.t); toast.t = setTimeout(() => e.classList.remove('on'), ms); }
function ago(ts) {
  if (!ts) return ''; const d = (Date.now() - (typeof ts === 'number' ? ts : Date.parse(ts))) / 1000;
  if (d < 45) return 'agora'; if (d < 3600) return Math.round(d / 60) + ' min'; if (d < 86400) return Math.round(d / 3600) + ' h';
  if (d < 86400 * 30) return Math.round(d / 86400) + ' d'; return new Date(ts).toLocaleDateString('pt-BR');
}
function dur(ms) { const s = Math.max(0, Math.round(ms / 1000)); return s < 60 ? s + 's' : Math.floor(s / 60) + 'min ' + String(s % 60).padStart(2, '0') + 's'; }
function ktok(n) { n = n || 0; return n >= 1e6 ? (n / 1e6).toFixed(1).replace('.0', '') + 'M' : n >= 1000 ? (n / 1000).toFixed(n >= 1e4 ? 0 : 1).replace('.0', '') + 'k' : '' + n; }
function tokLabel(t) { if (!t || (!t.in && !t.out)) return ''; return `↑${ktok(t.in)} ↓${ktok(t.out)} tokens`; }
function shortModel(m) { if (!m) return ''; const x = m.match(/(opus|sonnet|haiku|fable)-(\d+)-(\d+)/); return x ? x[1][0].toUpperCase() + x[1].slice(1) + ' ' + x[2] + '.' + x[3] : String(m).replace(/[^\w.:\[\] -]/g, ''); }
function projName(s) { const c = s.cwd || s.project || ''; const b = c.split('/').filter(Boolean).pop() || '~'; return c === S.home ? '~ (home)' : b; }
function uid() { return Math.random().toString(36).slice(2, 10); }

/* ---------- persistência do quadro ---------- */
let saveT = null;
function saveBoard() { clearTimeout(saveT); saveT = setTimeout(() => api('/api/board', { method: 'PUT', body: S.data }).catch(e => toast('Não salvou: ' + e.message)), 350); }
function curBoard() { return S.data.boards.find(b => b.id === S.data.currentBoardId) || S.data.boards[0]; }
function saveView() { localStorage.setItem('cb.view', JSON.stringify(S.view)); }

/* ---------- estado de cada sessão ---------- */
function stateOf(id) {
  const st = S.status[id] || {}; const s = S.byId[id] || {};
  if (st.running && st.external) return { cls: 'run', label: 'rodando no servidor', st };
  if (st.running) return { cls: 'run', label: st.phase === 'compactando' ? 'compactando' : st.phase === 'ferramenta' ? 'usando ferramenta' : st.phase === 'escrevendo' ? 'escrevendo' : 'pensando', st };
  if (s.liveElsewhere) return { cls: 'live', label: 'ativa na extensão', st };
  if (st.endedAt && st.error) return { cls: 'err', label: 'erro', st };
  if (st.endedAt) return { cls: 'ok', label: 'terminou', st };
  return { cls: '', label: '', st };
}

/* ---------- carga ---------- */
async function load() {
  const j = await api('/api/state');
  S.sessions = j.sessions; S.byId = Object.fromEntries(j.sessions.map(s => [s.id, s]));
  S.status = j.status; S.models = j.models; setModels(j.models, j.modelList); S.home = j.home; S.rateLimit = j.rateLimit; S.mode = j.mode || 'vps'; S.version = j.version; if (j.account) S.account = j.account; applyMode();
  if (!S.data) {
    const d = Object.assign({ names: {}, prefs: {}, folders: [], folderOf: {}, boards: [], currentBoardId: null, init: false }, j.board || {});
    d.names = d.names || {}; d.prefs = d.prefs || {}; d.folders = d.folders || []; d.folderOf = d.folderOf || {};
    // migra formato antigo (um só quadro no raiz) para boards[]
    if (!d.boards || !d.boards.length) {
      d.boards = [{ id: uid(), name: 'Quadro 1', cards: d.cards || {}, frames: d.frames || [], links: d.links || [], notes: d.notes || [] }];
      delete d.cards; delete d.frames; delete d.links; delete d.notes;
    }
    d.currentBoardId = d.currentBoardId && d.boards.some(b => b.id === d.currentBoardId) ? d.currentBoardId : d.boards[0].id;
    S.data = d; S.board = curBoard();
    renderBoardSelector();
    if (!S.data.init) firstRun();
  }
  fillProjects(); renderBoardSelector(); renderList(); renderBoard(); renderRunning(); renderUsageMini(); if (S.usageOpen) renderUsage();
  if (S.tabs.length) { S.tabs = S.tabs.filter(id => S.byId[id]); renderTabs(); }
}
function firstRun() {
  const b = S.board;
  const recent = S.sessions.filter(s => !s.project.startsWith('-tmp')).slice(0, 9);
  recent.forEach((s, i) => { b.cards[s.id] = { x: (i % 3) * 330, y: Math.floor(i / 3) * 280 }; });
  S.data.init = true; saveBoard();
}

/* ---------- lista lateral ---------- */
function fillProjects() {
  const sel = $('#projFilter'); const cur = sel.value; const ps = {};
  for (const s of S.sessions) ps[s.cwd || s.project] = (ps[s.cwd || s.project] || 0) + 1;
  sel.innerHTML = '<option value="">Todos os projetos (' + S.sessions.length + ')</option>' + Object.entries(ps).sort((a, b) => b[1] - a[1]).map(([p, n]) => `<option value="${esc(p)}">${esc(p.replace(S.home, '~'))} (${n})</option>`).join('');
  sel.value = cur;
  $('#cwdList').innerHTML = Object.keys(ps).filter(p => p.startsWith('/')).map(p => `<option value="${esc(p)}">`).join('');
}
function liEl(s) {
  const on = !!S.board.cards[s.id]; const st = stateOf(s.id);
  const d = el('div', 'li' + (S.cur === s.id ? ' on' : ''));
  d.draggable = true; d.dataset.id = s.id;
  d.innerHTML = `<div class="t"><i class="dot ${st.cls}"></i><span>${esc(s.title)}</span></div>
    <div class="s">${esc(s.lastText || s.firstPrompt || '')}</div>
    <div class="m"><span>${esc(projName(s))}</span><span>${ago(s.mtime)}</span>${s.model ? `<span>${shortModel(s.model)}</span>` : ''}${on ? '<span class="onb">● no quadro</span>' : ''}</div>`;
  d.addEventListener('dragstart', e => { e.dataTransfer.setData('text/cb-session', s.id); e.dataTransfer.effectAllowed = 'copyMove'; });
  d.addEventListener('click', () => { openSession(s.id); if (innerWidth < 820) document.body.classList.add('noside'); });
  d.addEventListener('contextmenu', e => { e.preventDefault(); cardMenu(s.id, e.clientX, e.clientY); });
  return d;
}
function renderList() {
  const q = $('#q').value.trim().toLowerCase(); const pf = $('#projFilter').value; const off = $('#onlyOff').checked;
  const L = $('#list'); L.innerHTML = ''; L.classList.remove('drop-root');
  const match = s => { if (pf && (s.cwd || s.project) !== pf) return false; if (off && S.board.cards[s.id]) return false; if (q && !((s.title + ' ' + (s.firstPrompt || '') + ' ' + (s.lastText || '') + ' ' + (s.cwd || '')).toLowerCase().includes(q))) return false; return true; };
  const shown = S.sessions.filter(match);
  const folders = S.data.folders || [];
  // pastas primeiro
  for (const f of folders) {
    const items = shown.filter(s => S.data.folderOf[s.id] === f.id);
    const fd = el('div', 'folder'); fd.dataset.fid = f.id;
    const head = el('div', 'folder-head' + (f.collapsed ? ' collapsed' : ''));
    head.innerHTML = `<span class="farrow">▾</span><span class="fname" spellcheck="false">${esc(f.name)}</span><span class="fcount">${items.length}</span><button class="fdel" title="Excluir pasta">✕</button>`;
    const body = el('div', 'folder-body' + (f.collapsed ? ' hidden' : ''));
    items.forEach(s => body.appendChild(liEl(s)));
    const fname = head.querySelector('.fname');
    head.addEventListener('click', e => { if (e.target.closest('.fdel') || fname.isContentEditable) return; f.collapsed = !f.collapsed; saveBoard(); head.classList.toggle('collapsed'); body.classList.toggle('hidden'); });
    fname.addEventListener('dblclick', e => { e.stopPropagation(); fname.contentEditable = 'true'; fname.focus(); });
    fname.addEventListener('blur', () => { fname.contentEditable = 'false'; f.name = fname.textContent.trim() || 'Pasta'; saveBoard(); });
    fname.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); fname.blur(); } });
    head.querySelector('.fdel').addEventListener('click', e => { e.stopPropagation(); if (confirm('Excluir a pasta “' + f.name + '”? As conversas voltam pra lista.')) { S.data.folders = S.data.folders.filter(x => x.id !== f.id); for (const k in S.data.folderOf) if (S.data.folderOf[k] === f.id) delete S.data.folderOf[k]; saveBoard(); renderList(); } });
    // soltar conversa na pasta
    fd.addEventListener('dragover', e => { if (e.dataTransfer.types.includes('text/cb-session')) { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; fd.classList.add('drop'); } });
    fd.addEventListener('dragleave', () => fd.classList.remove('drop'));
    fd.addEventListener('drop', e => { const sid = e.dataTransfer.getData('text/cb-session'); if (sid) { e.preventDefault(); e.stopPropagation(); fd.classList.remove('drop'); moveToFolder(sid, f.id); } });
    fd.appendChild(head); fd.appendChild(body); L.appendChild(fd);
  }
  // sem pasta
  const loose = shown.filter(s => !S.data.folderOf[s.id] || !folders.some(f => f.id === S.data.folderOf[s.id]));
  if (folders.length && loose.length) L.appendChild(el('div', 'nofolder-label', 'Sem pasta'));
  loose.slice(0, 500).forEach(s => L.appendChild(liEl(s)));
  if (!shown.length) L.innerHTML = '<div style="padding:14px;color:var(--dim)">Nada encontrado</div>';
}
// soltar na área vazia da lista = tirar da pasta
$('#list').addEventListener('dragover', e => { if (e.dataTransfer.types.includes('text/cb-session') && !e.target.closest('.folder')) { e.preventDefault(); $('#list').classList.add('drop-root'); } });
$('#list').addEventListener('dragleave', e => { if (e.target === $('#list')) $('#list').classList.remove('drop-root'); });
$('#list').addEventListener('drop', e => { if (e.target.closest('.folder')) return; const sid = e.dataTransfer.getData('text/cb-session'); if (sid) { e.preventDefault(); $('#list').classList.remove('drop-root'); moveToFolder(sid, null); } });

/* ---------- quadro ---------- */
const stage = $('#stage'), world = $('#world');
function applyView() { world.style.transform = `translate(${S.view.x}px,${S.view.y}px) scale(${S.view.z})`; $('#zoomPct').textContent = Math.round(S.view.z * 100) + '%'; }
function toWorld(cx, cy) { const r = stage.getBoundingClientRect(); return { x: (cx - r.left - S.view.x) / S.view.z, y: (cy - r.top - S.view.y) / S.view.z }; }
function zoomAt(cx, cy, f) {
  const r = stage.getBoundingClientRect(); const z = Math.min(2.2, Math.max(0.15, S.view.z * f));
  const px = cx - r.left, py = cy - r.top;
  S.view.x = px - (px - S.view.x) * (z / S.view.z); S.view.y = py - (py - S.view.y) * (z / S.view.z); S.view.z = z;
  applyView(); saveView();
}

function renderBoard() {
  const F = $('#frames'), C = $('#cards'); F.innerHTML = ''; C.innerHTML = '';
  for (const f of S.board.frames) F.appendChild(frameEl(f));
  for (const [id, c] of Object.entries(S.board.cards)) { if (!S.byId[id]) continue; C.appendChild(cardEl(id, c)); }
  for (const n of S.board.notes || []) C.appendChild(noteEl(n));
  applyView(); requestAnimationFrame(() => drawLinks());
}
function frameEl(f) {
  const d = el('div', 'frame'); d.dataset.fid = f.id;
  d.style.cssText = `left:${f.x}px;top:${f.y}px;width:${f.w}px;height:${f.h}px;--fc:${f.color}`;
  const count = Object.entries(S.board.cards).filter(([id, c]) => S.byId[id] && inside(c, f)).length;
  d.innerHTML = `<div class="fh"><span class="ft">${esc(f.title)}</span><span class="fc">${count}</span><button class="ico fx" title="Opções">⋯</button></div><div class="rs"></div>`;
  const fh = d.querySelector('.fh'), ft = d.querySelector('.ft');
  ft.addEventListener('dblclick', e => { e.stopPropagation(); ft.contentEditable = 'true'; ft.focus(); document.execCommand('selectAll', false, null); });
  ft.addEventListener('blur', () => { ft.contentEditable = 'false'; f.title = ft.textContent.trim() || 'Área'; saveBoard(); });
  ft.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); ft.blur(); } });
  d.querySelector('.fx').addEventListener('pointerdown', e => e.stopPropagation());
  d.querySelector('.fx').addEventListener('click', e => { e.stopPropagation(); frameMenu(f, e.clientX, e.clientY); });
  d.addEventListener('contextmenu', e => { e.preventDefault(); e.stopPropagation(); frameMenu(f, e.clientX, e.clientY); });
  fh.addEventListener('pointerdown', e => {
    if (ft.isContentEditable || e.button !== 0) return; e.stopPropagation();
    // leva junto os cartões e notas que estão dentro
    const members = Object.entries(S.board.cards).filter(([id, c]) => inside(c, f)).map(([id, c]) => ({ c, x: c.x, y: c.y, e: document.querySelector(`.card[data-id="${id}"]`) }));
    const notes = (S.board.notes || []).filter(n => inside(n, f)).map(n => ({ c: n, x: n.x, y: n.y, e: document.querySelector(`.note[data-nid="${n.id}"]`) }));
    const all = members.concat(notes);
    drag(e, fh, (dx, dy) => {
      d.style.left = (f.x + dx) + 'px'; d.style.top = (f.y + dy) + 'px';
      for (const m of all) if (m.e) { m.e.style.left = (m.x + dx) + 'px'; m.e.style.top = (m.y + dy) + 'px'; }
      drawLinks(all.map(m => ({ ...m, dx, dy })));
    }, (dx, dy) => { f.x += dx; f.y += dy; for (const m of all) { m.c.x = m.x + dx; m.c.y = m.y + dy; } saveBoard(); drawLinks(); });
  });
  d.querySelector('.rs').addEventListener('pointerdown', e => {
    e.stopPropagation(); const w = f.w, h = f.h;
    drag(e, null, (dx, dy) => { d.style.width = Math.max(240, w + dx) + 'px'; d.style.height = Math.max(160, h + dy) + 'px'; },
      (dx, dy) => { f.w = Math.max(240, w + dx); f.h = Math.max(160, h + dy); saveBoard(); renderFrameCounts(); });
  });
  return d;
}
function inside(c, f) { const cx = c.x + 140, cy = c.y + 40; return cx > f.x && cx < f.x + f.w && cy > f.y + 30 && cy < f.y + f.h; }
function renderFrameCounts() { for (const f of S.board.frames) { const d = document.querySelector(`.frame[data-fid="${f.id}"] .fc`); if (d) d.textContent = Object.entries(S.board.cards).filter(([id, c]) => S.byId[id] && inside(c, f)).length; } }

function cardInner(id) {
  const s = S.byId[id]; const st = stateOf(id); const c = S.board.cards[id] || {};
  const tags = [];
  if (st.cls === 'run') tags.push(`<span class="tag run">● ${st.label} · <span data-since="${st.st.startedAt}">${dur(Date.now() - st.st.startedAt)}</span>${st.st.tokens && (st.st.tokens.in || st.st.tokens.out) ? ' · ' + tokLabel(st.st.tokens) : ''}</span>`);
  else if (st.cls === 'live') tags.push('<span class="tag live">ativa na extensão</span>');
  else if (st.cls === 'wait') tags.push('<span class="tag wait">esperando você</span>');
  else if (st.cls === 'err') tags.push('<span class="tag err">erro</span>');
  else if (st.cls === 'ok') tags.push(`<span class="tag ok">pronto${st.st.tokens && (st.st.tokens.in || st.st.tokens.out) ? ' · ' + tokLabel(st.st.tokens) : ''}</span>`);
  const pm = S.data.prefs[id]?.model; const model = pm && pm !== 'default' ? modelLabel(pm) : shortModel(s.model);
  if (model) tags.push(`<span class="tag">${esc(model)}</span>`);
  if (s.ctx && ctxLevel(s.ctx)) tags.push(`<span class="tag ctx ${ctxLevel(s.ctx)}" title="Contexto grande: cada passo relê ${ktok(s.ctx)} tokens">ctx ${ktok(s.ctx)}</span>`);
  tags.push(`<span>${ago(s.mtime)}</span>`);
  const live = st.cls === 'run' || st.cls === 'live';
  const toolTxt = st.cls === 'run' ? st.st.tool : (st.cls === 'live' ? s.lastTool : null);
  const thought = st.cls === 'run' ? st.st.thought : (st.cls === 'live' ? s.lastThought : null);
  const todos = (st.cls === 'run' && st.st.todos) || s.todos;
  let tool = '';
  if (live && thought) tool += `<div class="cthink">💭 …${esc(thought.slice(-180).replace(/^\S*\s/, ""))}</div>`;
  if (live && toolTxt) tool += `<div class="ctool">⚙ ${esc(toolTxt)}</div>`;
  if (todos && todos.length) {
    const done = todos.filter(t => t.s === 'completed').length; const act = todos.find(t => t.s === 'in_progress');
    tool += `<div class="ctodo"><div class="tb"><i style="width:${Math.round(done / todos.length * 100)}%"></i></div><span>${done}/${todos.length} tarefas${act ? ' · ' + esc(act.a || act.c) : ''}</span></div>`;
  }
  if (!live && s.question) tool += `<div class="cq">❓ ${esc(s.question)}</div>`;
  return `<div class="cbar" style="--cc:${c.color || 'var(--gold-l)'}"></div><div class="cb">
    <div class="ct"><i class="dot ${st.cls}"></i><span>${esc(s.title)}</span></div>
    <div class="cp">${esc(projName(s))} · ${esc(s.id.slice(0, 8))}</div>
    <div class="cs ${s.lastRole === 'user' ? 'u' : ''}">${esc((s.lastRole === 'user' ? '› ' : '') + (s.lastText || s.firstPrompt || ''))}</div>
    ${tool}<div class="cf">${tags.join('')}</div></div>
    <div class="port in"></div><div class="port out" title="Puxe pra ligar a outra conversa"></div>`;
}
function cardEl(id, c) {
  const d = el('div', 'card' + (S.cur === id ? ' sel' : '') + (stateOf(id).cls === 'run' ? ' running' : ''));
  d.dataset.id = id; d.style.left = c.x + 'px'; d.style.top = c.y + 'px'; d.innerHTML = cardInner(id);
  d.addEventListener('pointerdown', e => {
    if (e.button !== 0) return;
    if (e.target.classList.contains('out')) { e.stopPropagation(); return linkDrag(e, id); }
    e.stopPropagation(); const x = c.x, y = c.y;
    d.style.zIndex = 5;
    drag(e, d, (dx, dy) => { d.style.left = (x + dx) + 'px'; d.style.top = (y + dy) + 'px'; drawLinks([{ c, x, y, dx, dy }]); },
      (dx, dy, moved) => { d.style.zIndex = ''; if (!moved) return openSession(id); c.x = x + dx; c.y = y + dy; saveBoard(); renderFrameCounts(); drawLinks(); });
  });
  d.addEventListener('contextmenu', e => { e.preventDefault(); e.stopPropagation(); cardMenu(id, e.clientX, e.clientY); });
  return d;
}
function updateCard(id) {
  const d = document.querySelector(`.card[data-id="${id}"]`); if (!d || !S.byId[id]) return;
  d.innerHTML = cardInner(id); d.classList.toggle('running', stateOf(id).cls === 'run'); d.classList.toggle('sel', S.cur === id);
}
function noteEl(n) {
  const d = el('div', 'note'); d.dataset.nid = n.id; d.style.left = n.x + 'px'; d.style.top = n.y + 'px';
  d.innerHTML = `<div class="nt" contenteditable="true" spellcheck="false">${esc(n.text)}</div><button class="nx" title="Apagar">✕</button>`;
  const t = d.querySelector('.nt');
  t.addEventListener('pointerdown', e => e.stopPropagation());
  t.addEventListener('input', () => { n.text = t.innerText; saveBoard(); });
  d.querySelector('.nx').addEventListener('click', () => { S.board.notes = S.board.notes.filter(x => x !== n); saveBoard(); d.remove(); });
  d.addEventListener('pointerdown', e => {
    if (e.button !== 0) return; e.stopPropagation(); const x = n.x, y = n.y;
    drag(e, d, (dx, dy) => { d.style.left = (x + dx) + 'px'; d.style.top = (y + dy) + 'px'; }, (dx, dy) => { n.x = x + dx; n.y = y + dy; saveBoard(); });
  });
  return d;
}

/* arrasto genérico em coordenadas do mundo */
function drag(e, captureEl, onMove, onEnd) {
  const sx = e.clientX, sy = e.clientY; let moved = false; const z = S.view.z;
  const mv = ev => { const dx = (ev.clientX - sx) / z, dy = (ev.clientY - sy) / z; if (!moved && Math.hypot(ev.clientX - sx, ev.clientY - sy) < 5) return; moved = true; onMove(dx, dy); };
  const up = ev => { removeEventListener('pointermove', mv); removeEventListener('pointerup', up); removeEventListener('pointercancel', up); onEnd((ev.clientX - sx) / z, (ev.clientY - sy) / z, moved); };
  addEventListener('pointermove', mv); addEventListener('pointerup', up); addEventListener('pointercancel', up);
}

/* ligações entre conversas */
function anchor(id, side, off) {
  const c = S.board.cards[id]; const d = document.querySelector(`.card[data-id="${id}"]`); if (!c || !d) return null;
  const o = Array.isArray(off) && off.find(m => m.c === c); const x = o ? o.x + o.dx : c.x, y = o ? o.y + o.dy : c.y;
  return { x: side === 'out' ? x + d.offsetWidth : x, y: y + d.offsetHeight / 2 };
}
function bez(a, b) { const k = Math.max(60, Math.abs(b.x - a.x) / 2); return `M${a.x},${a.y} C${a.x + k},${a.y} ${b.x - k},${b.y} ${b.x},${b.y}`; }
function drawLinks(off) {
  const svg = $('#links'); let h = '';
  S.board.links = S.board.links.filter(l => S.board.cards[l.from] && S.board.cards[l.to]);
  for (const l of S.board.links) {
    const a = anchor(l.from, 'out', off), b = anchor(l.to, 'in', off); if (!a || !b) continue;
    h += `<path data-lid="${l.id}" d="${bez(a, b)}" marker-end="url(#arr)"></path>`;
  }
  svg.innerHTML = `<defs><marker id="arr" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" fill="#59606e" style="pointer-events:none"></path></marker></defs>` + h;
}
$('#links').addEventListener('click', e => {
  const lid = e.target.dataset && e.target.dataset.lid; if (!lid) return;
  if (confirm('Remover essa ligação?')) { S.board.links = S.board.links.filter(l => l.id !== lid); saveBoard(); drawLinks(); }
});
function linkDrag(e, from) {
  const svg = $('#links'); const tmp = document.createElementNS('http://www.w3.org/2000/svg', 'path'); tmp.setAttribute('class', 'tmp'); svg.appendChild(tmp);
  const a = anchor(from, 'out');
  const mv = ev => { const p = toWorld(ev.clientX, ev.clientY); tmp.setAttribute('d', bez(a, p)); };
  const up = ev => {
    removeEventListener('pointermove', mv); removeEventListener('pointerup', up); tmp.remove();
    const t = document.elementsFromPoint(ev.clientX, ev.clientY).find(x => x.classList && x.classList.contains('card'));
    if (t && t.dataset.id !== from && !S.board.links.some(l => l.from === from && l.to === t.dataset.id)) { S.board.links.push({ id: uid(), from, to: t.dataset.id }); saveBoard(); }
    drawLinks();
  };
  addEventListener('pointermove', mv); addEventListener('pointerup', up);
}

/* pan + zoom (mouse, roda, pinça) */
const pointers = new Map(); let pinch = null;
stage.addEventListener('pointerdown', e => {
  if (e.target.closest('.card,.note,.fh,.rs,#zoomCtl')) return;
  hideMenu(); pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
  if (pointers.size === 2) { const [p1, p2] = [...pointers.values()]; pinch = { d: Math.hypot(p1.x - p2.x, p1.y - p2.y), z: S.view.z }; return; }
  const sx = e.clientX - S.view.x, sy = e.clientY - S.view.y; stage.classList.add('panning');
  const mv = ev => {
    if (pointers.has(ev.pointerId)) pointers.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });
    if (pinch && pointers.size === 2) { const [p1, p2] = [...pointers.values()]; const d = Math.hypot(p1.x - p2.x, p1.y - p2.y); zoomAt((p1.x + p2.x) / 2, (p1.y + p2.y) / 2, (pinch.z * d / pinch.d) / S.view.z); return; }
    if (pinch) return;
    S.view.x = ev.clientX - sx; S.view.y = ev.clientY - sy; applyView();
  };
  const up = ev => { pointers.delete(ev.pointerId); if (pointers.size < 2) pinch = null; if (pointers.size) return; stage.classList.remove('panning'); saveView(); removeEventListener('pointermove', mv); removeEventListener('pointerup', up); removeEventListener('pointercancel', up); };
  addEventListener('pointermove', mv); addEventListener('pointerup', up); addEventListener('pointercancel', up);
});
stage.addEventListener('wheel', e => {
  e.preventDefault();
  if (e.ctrlKey || e.metaKey || Math.abs(e.deltaY) > 40 && !e.shiftKey && e.deltaMode === 0 && Math.abs(e.deltaX) < 1 && Number.isInteger(e.deltaY)) zoomAt(e.clientX, e.clientY, Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0015)));
  else { S.view.x -= e.deltaX; S.view.y -= e.deltaY; applyView(); saveView(); }
}, { passive: false });
$('#zoomCtl').addEventListener('click', e => {
  const z = e.target.dataset.z; if (!z) return; const r = stage.getBoundingClientRect();
  if (z === 'in') zoomAt(r.left + r.width / 2, r.top + r.height / 2, 1.2);
  if (z === 'out') zoomAt(r.left + r.width / 2, r.top + r.height / 2, 1 / 1.2);
  if (z === 'fit') fitAll();
  if (z === 'arrange') arrangeLoose();
});
function fitAll() {
  const boxes = [...S.board.frames.map(f => [f.x, f.y, f.x + f.w, f.y + f.h]), ...Object.entries(S.board.cards).filter(([id]) => S.byId[id]).map(([, c]) => [c.x, c.y, c.x + 280, c.y + 160]), ...(S.board.notes || []).map(n => [n.x, n.y, n.x + 220, n.y + 100])];
  if (!boxes.length) return;
  const x1 = Math.min(...boxes.map(b => b[0])), y1 = Math.min(...boxes.map(b => b[1])), x2 = Math.max(...boxes.map(b => b[2])), y2 = Math.max(...boxes.map(b => b[3]));
  const r = stage.getBoundingClientRect(); const z = Math.min(1.2, Math.max(0.15, Math.min((r.width - 60) / (x2 - x1), (r.height - 60) / (y2 - y1))));
  S.view = { z, x: (r.width - (x2 - x1) * z) / 2 - x1 * z, y: (r.height - (y2 - y1) * z) / 2 - y1 * z }; applyView(); saveView();
}
function arrangeLoose() {
  const loose = Object.entries(S.board.cards).filter(([id, c]) => S.byId[id] && !S.board.frames.some(f => inside(c, f)));
  if (!loose.length) return toast('Nenhum cartão solto');
  const maxX = Math.max(0, ...S.board.frames.map(f => f.x + f.w)) + 60;
  loose.sort((a, b) => S.byId[b[0]].mtime - S.byId[a[0]].mtime).forEach(([, c], i) => { c.x = maxX + (i % 3) * 300; c.y = Math.floor(i / 3) * 190; });
  saveBoard(); renderBoard(); fitAll();
}

/* soltar conversa da lateral no quadro */
stage.addEventListener('dragover', e => { if (e.dataTransfer.types.includes('text/cb-session')) { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; } });
stage.addEventListener('drop', e => {
  const id = e.dataTransfer.getData('text/cb-session'); if (!id) return; e.preventDefault();
  const p = toWorld(e.clientX, e.clientY); placeCard(id, p.x - 140, p.y - 30);
});
function placeCard(id, x, y) { S.board.cards[id] = Object.assign(S.board.cards[id] || {}, { x: Math.round(x), y: Math.round(y) }); saveBoard(); renderBoard(); renderList(); }
function centerWorld() { const r = stage.getBoundingClientRect(); return toWorld(r.left + r.width / 2, r.top + r.height / 2); }
function freeSpotIn(f) {
  for (let row = 0; row < 40; row++) for (let col = 0; col < Math.max(1, Math.floor((f.w - 20) / 300)); col++) {
    const x = f.x + 20 + col * 300, y = f.y + 64 + row * 190;
    if (!Object.values(S.board.cards).some(c => Math.abs(c.x - x) < 200 && Math.abs(c.y - y) < 120)) { if (y + 170 > f.y + f.h) f.h = y + 190 - f.y; return { x, y }; }
  }
  return { x: f.x + 20, y: f.y + 64 };
}

/* ---------- menus ---------- */
function showMenu(x, y, html, bind) { const m = $('#ctx'); m.innerHTML = html; m.classList.remove('hidden'); m.style.left = Math.min(x, innerWidth - 210) + 'px'; m.style.top = Math.min(y, innerHeight - m.offsetHeight - 8) + 'px'; bind(m); }
function hideMenu() { $('#ctx').classList.add('hidden'); }
addEventListener('pointerdown', e => { if (!e.target.closest('#ctx')) hideMenu(); });
function cardMenu(id, x, y) {
  const on = !!S.board.cards[id];
  showMenu(x, y, `<button data-a="open">💬 Abrir conversa</button><button data-a="rename">✎ Renomear</button>
    ${on ? '' : '<button data-a="add">＋ Pôr no quadro</button>'}
    ${S.board.frames.map(f => `<button data-a="mv" data-f="${f.id}">→ Mover pra “${esc(f.title)}”</button>`).join('')}
    ${on ? `<div class="sw">${COLORS.map(c => `<i data-c="${c}" style="background:${c}"></i>`).join('')}<i data-c="" style="background:#2a2e36" title="sem cor"></i></div>` : ''}
    <hr><button data-a="copy">⎘ Copiar comando resume</button>${on ? '<button data-a="rm">✕ Tirar do quadro</button>' : ''}`, m => {
    m.onclick = e => {
      const b = e.target.closest('[data-a],[data-c]'); if (!b) return; hideMenu();
      if (b.dataset.c !== undefined && !b.dataset.a) { S.board.cards[id].color = b.dataset.c; saveBoard(); updateCard(id); return; }
      const a = b.dataset.a;
      if (a === 'open') openSession(id);
      if (a === 'rename') { const n = prompt('Nome da conversa', S.byId[id].title); if (n != null) rename(id, n); }
      if (a === 'add') { const p = centerWorld(); placeCard(id, p.x - 140, p.y - 60); }
      if (a === 'mv') { const f = S.board.frames.find(x => x.id === b.dataset.f); const p = freeSpotIn(f); placeCard(id, p.x, p.y); }
      if (a === 'copy') copyResume(id);
      if (a === 'rm') { delete S.board.cards[id]; saveBoard(); renderBoard(); renderList(); }
    };
  });
}
function frameMenu(f, x, y) {
  showMenu(x, y, `<button data-a="rename">✎ Renomear área</button><div class="sw">${COLORS.map(c => `<i data-c="${c}" style="background:${c}"></i>`).join('')}</div>
    <button data-a="new">＋ Nova conversa aqui</button><hr><button data-a="del">✕ Apagar área (mantém as conversas)</button>`, m => {
    m.onclick = e => {
      const b = e.target.closest('[data-a],[data-c]'); if (!b) return; hideMenu();
      if (b.dataset.c) { f.color = b.dataset.c; saveBoard(); renderBoard(); return; }
      if (b.dataset.a === 'rename') { const n = prompt('Nome da área', f.title); if (n) { f.title = n; saveBoard(); renderBoard(); } }
      if (b.dataset.a === 'new') openNew(f.id);
      if (b.dataset.a === 'del') { S.board.frames = S.board.frames.filter(x => x !== f); saveBoard(); renderBoard(); }
    };
  });
}
function rename(id, n) { n = n.trim(); if (n) S.data.names[id] = n; else delete S.data.names[id]; S.byId[id].title = n || S.byId[id].aiTitle || (S.byId[id].firstPrompt || '').slice(0, 80); saveBoard(); updateCard(id); renderList(); renderTabs(); if (S.cur === id) $('#pTitle').value = S.byId[id].title; }
function copyResume(id) { const s = S.byId[id]; const cmd = `cd ${s.cwd || '~'} && claude --resume ${id}`; navigator.clipboard?.writeText(cmd).then(() => toast('Copiado: ' + cmd), () => prompt('Copie:', cmd)); }

/* ---------- topo ---------- */
$('#btnSide').onclick = () => document.body.classList.toggle('noside');
if (innerWidth < 820) document.body.classList.add('noside');
$('#btnFrame').onclick = () => { const p = centerWorld(); S.board.frames.push({ id: uid(), x: Math.round(p.x - 320), y: Math.round(p.y - 250), w: 640, h: 520, title: 'Nova área', color: COLORS[S.board.frames.length % COLORS.length] }); saveBoard(); renderBoard(); };
$('#btnNote').onclick = () => { const p = centerWorld(); (S.board.notes = S.board.notes || []).push({ id: uid(), x: Math.round(p.x - 110), y: Math.round(p.y - 45), text: 'Nota…' }); saveBoard(); renderBoard(); };
$('#logout').onclick = async e => { e.preventDefault(); await fetch('/api/logout'); location.href = '/login'; };
$('#q').oninput = renderList; $('#projFilter').onchange = renderList; $('#onlyOff').onchange = renderList;

/* ---------- vários quadros ---------- */
function renderBoardSelector() {
  const sel = $('#boardSel'); if (!S.data) return;
  sel.innerHTML = S.data.boards.map(b => `<option value="${b.id}"${b.id === S.data.currentBoardId ? ' selected' : ''}>${esc(b.name)}</option>`).join('');
}
$('#boardSel').onchange = () => switchBoard($('#boardSel').value);
function switchBoard(id) {
  if (!S.data.boards.some(b => b.id === id)) return;
  S.data.currentBoardId = id; S.board = curBoard(); saveBoard();
  S.view = { x: 40, y: 30, z: 1 }; renderBoard(); renderList(); if (!localStorage.getItem('cb.view.' + id)) fitAll();
}
$('#btnBoardMenu').onclick = e => {
  showMenu(e.clientX, e.clientY, S.data.boards.map(b => `<button data-sw="${b.id}">${b.id === S.data.currentBoardId ? '● ' : '○ '}${esc(b.name)}</button>`).join('') +
    `<hr><button data-a="new">＋ Novo quadro</button><button data-a="ren">✎ Renomear este</button>${S.data.boards.length > 1 ? '<button data-a="del">✕ Excluir este quadro</button>' : ''}`, m => {
    m.onclick = ev => { const b = ev.target.closest('[data-sw],[data-a]'); if (!b) return; hideMenu();
      if (b.dataset.sw) switchBoard(b.dataset.sw);
      else if (b.dataset.a === 'new') { const n = prompt('Nome do novo quadro', 'Quadro ' + (S.data.boards.length + 1)); if (n) { const id = uid(); S.data.boards.push({ id, name: n, cards: {}, frames: [], links: [], notes: [] }); switchBoard(id); renderBoardSelector(); } }
      else if (b.dataset.a === 'ren') { const n = prompt('Nome do quadro', curBoard().name); if (n) { curBoard().name = n; saveBoard(); renderBoardSelector(); } }
      else if (b.dataset.a === 'del') { if (confirm('Excluir o quadro “' + curBoard().name + '”? As conversas continuam, só saem deste quadro.')) { S.data.boards = S.data.boards.filter(x => x.id !== S.data.currentBoardId); S.data.currentBoardId = S.data.boards[0].id; S.board = curBoard(); saveBoard(); renderBoardSelector(); renderBoard(); renderList(); } }
    };
  });
};

/* ---------- pastas na sidebar ---------- */
$('#btnFolder').onclick = () => { const n = prompt('Nome da pasta'); if (n) { S.data.folders.push({ id: uid(), name: n, collapsed: false }); saveBoard(); renderList(); } };
function moveToFolder(sid, folderId) { if (folderId) S.data.folderOf[sid] = folderId; else delete S.data.folderOf[sid]; saveBoard(); renderList(); }

/* ---------- painel de uso ---------- */
function pct(u) { return u == null ? null : Math.round(u * 100); }
function resetTxt(ms) { if (!ms) return ''; if (ms < Date.now()) return 'já reiniciou (atualizando…)'; const d = new Date(ms); const dias = (d - Date.now()) / 864e5; const hh = d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }); return dias < 1 && d.getDate() === new Date().getDate() ? 'reinicia hoje ' + hh : 'reinicia ' + d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' }) + ' ' + hh; }
// janela que já passou da hora do reinício = zerou (não espera a próxima consulta pra mostrar)
function liveWin(w) { return w && w.resetsAt && w.resetsAt < Date.now() ? { ...w, util: 0, resetsAt: null, wasReset: true } : w; }
function renderUsageMini() {
  const rl0 = S.rateLimit; const rl = rl0 && { ...rl0, fiveHour: liveWin(rl0.fiveHour), sevenDay: liveWin(rl0.sevenDay) }; const m = $('#usageMini'); if (!rl || !rl.fiveHour || rl.fiveHour.util == null) { m.textContent = ''; return; }
  const p = pct(rl.fiveHour.util); const stale = !rl.at || Date.now() - rl.at > 12 * 60000;
  m.innerHTML = `5h <span class="mm"><i style="width:${p}%;background:${p > 85 ? 'var(--err)' : p > 60 ? 'var(--warn)' : 'var(--ok)'}"></i></span> ${p}%${rl.sevenDay ? ' · 7d ' + pct(rl.sevenDay.util) + '%' : ''}${stale ? ' ⚠' : ''}`;
  m.title = 'Uso oficial da conta · ' + (rl.at ? 'atualizado ' + ago(rl.at) : 'sem atualização') + ' · clique pra abrir';
  m.onclick = openUsage;
}
function meter(label, w) {
  if (!w) return ''; w = liveWin(w); if (w.wasReset) return `<div class="ulimit"><div class="ul-top"><b>${label}</b><span>0%</span></div><div class="umeter"><i style="width:0%"></i></div><div class="ul-reset">reiniciou agora · confirmando com a Anthropic…</div></div>`;
  const p = w.util == null ? null : pct(w.util);
  return `<div class="ulimit"><div class="ul-top"><b>${label}</b><span>${p == null ? '—' : p + '%'}</span></div><div class="umeter"><i class="${p > 80 ? 'hi' : ''}" style="width:${p || 0}%"></i></div><div class="ul-reset">${resetTxt(w.resetsAt)}</div></div>`;
}
async function renderUsage() {
  const box = $('#usageBody');
  if (!box.dataset.loaded) box.innerHTML = 'Buscando o uso oficial…';
  let u; try { u = await api('/api/usage?refresh=1'); } catch (e) { box.innerHTML = 'Erro: ' + esc(e.message); return; }
  box.dataset.loaded = '1';
  const rl = u.rateLimit || {}; S.rateLimit = rl; renderUsageMini();
  const fresh = rl.at ? `atualizado ${ago(rl.at)} · fonte oficial da conta (a mesma do /usage)` : '';
  const extra = (rl.scoped || []).map(s => meter('Semanal só ' + esc(s.name), s)).join('') +
    ((rl.breakdown || []).length ? `<div class="ul-reset" style="margin-top:4px">Uso semanal por origem: ${rl.breakdown.map(b => `${esc(b.name)} <b>${b.percent}%</b>`).join(' · ')}</div>` : '');
  const maxH = Math.max(1, ...u.hours.map(h => h.in + h.out));
  const maxD = Math.max(1, ...u.days.map(d => d.in + d.out));
  const stat = (o, l) => `<div class="s"><div class="n">${ktok(o.in + o.out)}</div><div class="l">${l} · ${o.runs} ${o.runs === 1 ? 'envio' : 'envios'}</div></div>`;
  box.innerHTML = `
    <div class="ucard"><h4>Limites do seu plano Claude</h4>
      ${rl.fiveHour ? meter('Sessão (janela de 5 horas)', rl.fiveHour) : '<div class="ul-reset">Sem dado ainda.</div>'}
      ${rl.sevenDay ? meter('Semanal (todos os modelos)', rl.sevenDay) : ''}
      ${extra}
      <div class="ul-reset" style="margin-top:8px">${esc(fresh)}${rl.error ? ` · <span style="color:var(--err)">última tentativa falhou (${esc(rl.error)}), mostrando o último valor bom</span>` : ''}</div>
    </div>
    <div class="ucard"><h4>Tokens que o painel disparou</h4>
      <div class="ustat">${stat(u.today, 'hoje')}${stat(u.d7, '7 dias')}${stat(u.d30, '30 dias')}</div>
    </div>
    <div class="ucard"><h4>Por hora (últimas 24h)</h4>
      <div class="ubars">${u.hours.map(h => `<div class="b" title="${ktok(h.in + h.out)} tokens" style="height:${Math.round((h.in + h.out) / maxH * 100)}%"></div>`).join('')}</div>
      <div class="ubar-x"><span>24h atrás</span><span>agora</span></div>
    </div>
    <div class="ucard"><h4>Por dia (14 dias)</h4>
      <div class="ubars">${u.days.map(d => `<div class="b" title="${new Date(d.d).toLocaleDateString('pt-BR')} · ${ktok(d.in + d.out)}" style="height:${Math.round((d.in + d.out) / maxD * 100)}%"></div>`).join('')}</div>
    </div>
    ${u.top.length ? `<div class="ucard"><h4>Conversas que mais usaram (30 dias)</h4><div class="utop">${u.top.map(c => `<div class="r"><span class="t" data-open="${c.id}">${esc(c.title)}</span><span class="v">${ktok(c.in + c.out)} tokens · ${c.runs}×</span></div>`).join('')}</div></div>` : ''}`;
  box.querySelectorAll('[data-open]').forEach(e => e.onclick = () => { $('#dlgUsage').close(); S.usageOpen = false; openSession(e.dataset.open); });
}
function openUsage(tab) { S.usageOpen = true; $('#dlgUsage').showModal(); dashTab(tab || 'uso'); }
function dashTab(t) {
  S.dashTab = t;
  document.querySelectorAll('.dtab').forEach(b => b.classList.toggle('on', b.dataset.tab === t));
  $('#usageBody').classList.toggle('hidden', t !== 'uso');
  $('#vpsBody').classList.toggle('hidden', t !== 'vps');
  $('#filesBody').classList.toggle('hidden', t !== 'files');
  $('#claudeBody').classList.toggle('hidden', t !== 'claude');
  if (t === 'uso') renderUsage();
  else if (t === 'vps') { renderVps(); startVpsPoll(); }
  else if (t === 'files') openFiles(S.filesPath || S.home);
  else if (t === 'claude') renderClaudeTab();
  if (t !== 'vps') stopVpsPoll();
}
document.querySelectorAll('.dtab').forEach(b => b.onclick = () => dashTab(b.dataset.tab));
$('#btnUsage').onclick = () => openUsage('uso');
$('#uClose').onclick = () => { $('#dlgUsage').close(); S.usageOpen = false; stopVpsPoll(); };
$('#dlgUsage').addEventListener('close', () => { S.usageOpen = false; stopVpsPoll(); });

/* ---------- aba VPS ---------- */
let vpsTimer = null;
function startVpsPoll() { stopVpsPoll(); vpsTimer = setInterval(() => { if (S.usageOpen && S.dashTab === 'vps') renderVps(); }, 4000); }
function stopVpsPoll() { clearInterval(vpsTimer); vpsTimer = null; }
function gib(n) { const v = n / 1073741824; return (v >= 10 ? Math.round(v) : v.toFixed(1)) + ' GB'; } // disco na mesma conta do provedor/df (potência de 2)
function gb(n) { return (n / 1e9).toFixed(n >= 1e10 ? 0 : 1) + ' GB'; }
function upfmt(s) { const d = Math.floor(s / 86400), h = Math.floor(s % 86400 / 3600), m = Math.floor(s % 3600 / 60); return (d ? d + 'd ' : '') + h + 'h ' + m + 'min'; }
async function renderVps() {
  const box = $('#vpsBody'); let v; try { v = await api('/api/vps'); } catch (e) { box.innerHTML = 'Erro: ' + esc(e.message); return; }
  const memP = Math.round(v.mem.used / v.mem.total * 100), diskP = Math.round(v.disk.used / v.disk.total * 100);
  const col = p => p > 85 ? 'var(--err)' : p > 65 ? 'var(--warn)' : 'var(--ok)';
  box.innerHTML = `
    <div class="vgrid">
      <div class="vtile"><div class="vn">${v.cpu}%</div><div class="vl">CPU · ${v.ncpu} núcleos · load ${v.load.join(' ')}</div><div class="vbar"><i style="width:${v.cpu}%;background:${col(v.cpu)}"></i></div></div>
      <div class="vtile"><div class="vn">${memP}%</div><div class="vl">RAM · ${gb(v.mem.used)} / ${gb(v.mem.total)}</div><div class="vbar"><i style="width:${memP}%;background:${col(memP)}"></i></div></div>
      <div class="vtile"><div class="vn">${diskP}%</div><div class="vl">Disco / · ${gib(v.disk.used)} / ${gib(v.disk.total)} (livre ${gib(v.disk.avail || v.disk.total - v.disk.used)})</div><div class="vbar"><i style="width:${diskP}%;background:${col(diskP)}"></i></div></div>
      <div class="vtile"><div class="vn">${upfmt(v.uptime)}</div><div class="vl">ligada · host ${esc(v.host)}</div></div>
    </div>
    ${v.phys && v.phys.unallocated > 1e9 ? `<div class="cfwarn">⚠ O disco do servidor tem <b>${gib(v.phys.size)}</b>, mas só <b>${gib(v.phys.partSize)}</b> estão em uso: <b>${gib(v.phys.unallocated)}</b> foram comprados e ainda não foram liberados pro sistema (a partição ${esc(v.phys.partition)} não foi expandida). Até expandir, o espaço livre continua ${gib(v.disk.avail)}.</div>` : ''}
    ${v.phys ? `<div class="ul-reset" style="margin:-4px 0 10px">Disco físico ${esc(v.phys.device)}: ${gib(v.phys.size)} · atualiza sozinho a cada 4 s</div>` : ''}
    <div class="vsec"><h4>Serviços</h4>${v.services.map(s => `<div class="vrow"><span>${esc(s.name)}</span><span class="vbadge ${s.active === 'active' ? 'ok' : s.active === 'inactive' || s.active === 'failed' ? 'off' : 'na'}">${esc(s.active || '?')}</span></div>`).join('')}</div>
    <div class="vsec"><h4>Containers Docker (${v.docker.length})</h4>${v.docker.length ? v.docker.map(d => `<div class="vrow"><span>${esc(d.name)}</span><span class="vbadge ${/^Up/.test(d.status) ? 'ok' : 'off'}">${esc(d.status)}</span></div>`).join('') : '<div class="vl">nenhum</div>'}</div>
    <div class="vsec"><h4>Rede</h4><div class="vrow"><span>IP público</span><span>${esc((v.ips[0] || '?'))}</span></div></div>`;
}

/* ---------- aba Arquivos ---------- */
const FI = { dir: '📁', js: '📜', json: '🧾', md: '📄', txt: '📄', log: '📋', png: '🖼️', jpg: '🖼️', jpeg: '🖼️', gif: '🖼️', webp: '🖼️', sh: '⚙️', py: '🐍', css: '🎨', html: '🌐', env: '🔑', service: '⚙️', yml: '🧩', yaml: '🧩' };
function ficon(e) { if (e.dir) return '📁'; const x = (e.name.split('.').pop() || '').toLowerCase(); return FI[x] || '📄'; }
function fsz(n) { return n >= 1e6 ? (n / 1e6).toFixed(1) + ' MB' : n >= 1000 ? Math.round(n / 1024) + ' KB' : n + ' B'; }
async function openFiles(dirPath) {
  S.filesPath = dirPath; const box = $('#filesBody');
  const shots = [S.home, S.home + '/.claude/projects', S.home + '/.claude/skills', '/var/log', '/etc'];
  box.innerHTML = `<div class="fbar"><input id="fpath" value="${esc(dirPath)}" spellcheck="false"><button class="btn small" id="fgo">Ir</button></div>
    <div class="fbar" style="gap:4px">${shots.map(s => `<button class="btn small fshot" data-p="${esc(s)}">${esc(s.replace(S.home, '~'))}</button>`).join('')}</div>
    <div class="fcrumb" id="fcrumb"></div><div class="flist" id="flist">Carregando…</div><div id="fview"></div>`;
  $('#fgo').onclick = () => openFiles($('#fpath').value.trim());
  $('#fpath').addEventListener('keydown', e => { if (e.key === 'Enter') openFiles($('#fpath').value.trim()); });
  box.querySelectorAll('.fshot').forEach(b => b.onclick = () => openFiles(b.dataset.p));
  let d; try { d = await api('/api/files?path=' + encodeURIComponent(dirPath)); } catch (e) { $('#flist').innerHTML = '<div style="padding:12px;color:var(--err)">' + esc(e.message) + '</div>'; return; }
  S.filesPath = d.path; $('#fpath').value = d.path;
  // breadcrumb
  const parts = d.path.split('/').filter(Boolean); let acc = '';
  $('#fcrumb').innerHTML = `<a data-p="/">/</a>` + parts.map(p => { acc += '/' + p; return ` <a data-p="${esc(acc)}">${esc(p)}</a> /`; }).join('');
  $('#fcrumb').querySelectorAll('a').forEach(a => a.onclick = () => openFiles(a.dataset.p));
  const L = $('#flist'); L.innerHTML = '';
  if (d.parent) { const up = el('div', 'frow', `<span class="fi">↩</span><span class="fnm">.. (subir)</span>`); up.onclick = () => openFiles(d.parent); L.appendChild(up); }
  for (const e of d.entries) {
    const r = el('div', 'frow', `<span class="fi">${ficon(e)}</span><span class="fnm">${esc(e.name)}${e.link ? ' ↗' : ''}</span><span class="fsz">${e.dir ? '' : fsz(e.size)}</span>`);
    const full = (d.path === '/' ? '' : d.path) + '/' + e.name;
    r.onclick = () => e.dir ? openFiles(full) : viewFile(full);
    L.appendChild(r);
  }
  $('#fview').innerHTML = '';
}
async function viewFile(f) {
  const V = $('#fview'); V.innerHTML = '<div class="fview"><div class="fvh">carregando…</div></div>';
  let d; try { d = await api('/api/file?path=' + encodeURIComponent(f)); } catch (e) { V.innerHTML = '<div class="fview"><div class="fvh">' + esc(e.message) + '</div></div>'; return; }
  const head = `<div class="fvh"><span>${esc(f.split('/').pop())} · ${fsz(d.size)}</span><span>${esc(f)}</span></div>`;
  if (d.kind === 'image') V.innerHTML = `<div class="fview">${head}<img src="${esc(d.url)}"></div>`;
  else if (d.kind === 'text') V.innerHTML = `<div class="fview">${head}<pre>${esc(d.content)}${d.truncated ? '\n\n… (arquivo cortado)' : ''}</pre></div>`;
  else if (d.kind === 'toobig') V.innerHTML = `<div class="fview">${head}<pre>Arquivo grande demais pra mostrar (${fsz(d.size)}).</pre></div>`;
  else V.innerHTML = `<div class="fview">${head}<pre>Arquivo binário — não dá pra mostrar como texto.</pre></div>`;
}
function renderRunning() {
  const R = $('#runningBar'); const ids = Object.keys(S.status).filter(id => S.status[id].running && S.byId[id]);
  R.innerHTML = ids.map(id => `<span class="chip" data-id="${id}"><i class="dot run"></i><span>${esc(S.byId[id].title)}</span></span>`).join('');
  R.querySelectorAll('.chip').forEach(c => c.onclick = () => openSession(c.dataset.id));
  document.title = ids.length ? `(${ids.length}) Claude Board` : 'Claude Board';
}

/* ---------- nova conversa ---------- */
function modelOptions(sel, withDefault) {
  const L = S.modelList || [];
  sel.innerHTML = (withDefault ? '<option value="default">modelo da conversa</option>' : '<option value="default">padrão da conta</option>')
    + '<optgroup label="Sempre o mais novo">' + FAMS.map(([k]) => `<option value="${k}">${esc(MODEL_LABEL[k])}</option>`).join('') + '</optgroup>'
    + FAMS.map(([f, name]) => { const v = L.filter(x => x.family === f); return v.length ? `<optgroup label="${name}: versão fixa">` + v.map(x => `<option value="${esc(x.id)}">${esc(x.label)}</option>`).join('') + '</optgroup>' : ''; }).join('');
}
modelOptions($('#nModel'), false); modelOptions($('#pModel'), true);
function openNew(frameId) {
  $('#nErr').textContent = ''; $('#nText').value = ''; $('#nName').value = ''; attState.new = []; renderAttachs('new');
  $('#nCwd').value = localStorage.getItem('cb.lastCwd') || S.home;
  $('#nModel').value = localStorage.getItem('cb.lastModel') || 'opus'; $('#nEffort').value = localStorage.getItem('cb.lastEffort') || 'medium';
  $('#nFrame').innerHTML = '<option value="">— solto no quadro —</option>' + S.board.frames.map(f => `<option value="${f.id}">${esc(f.title)}</option>`).join('');
  $('#nFrame').value = frameId || S.board.frames[0]?.id || '';
  $('#dlgNew').showModal(); setTimeout(() => $('#nText').focus(), 50);
}
$('#btnNew').onclick = () => openNew();
$('#nGo').onclick = async e => {
  e.preventDefault(); const btn = $('#nGo'); btn.disabled = true; $('#nErr').textContent = '';
  if (attState.new.some(a => !a.done)) { btn.disabled = false; return $('#nErr').textContent = 'Espere o anexo subir'; }
  try {
    const atts = attState.new.filter(a => a.done).map(a => ({ path: a.path, name: a.name }));
    const body = { name: $('#nName').value.trim(), cwd: $('#nCwd').value.trim() || S.home, model: $('#nModel').value, effort: $('#nEffort').value, permission: $('#nPerm').value, fast: $('#nFast').value === '1', text: $('#nText').value, attachments: atts };
    localStorage.setItem('cb.lastCwd', body.cwd); localStorage.setItem('cb.lastModel', body.model); localStorage.setItem('cb.lastEffort', body.effort);
    const { id } = await api('/api/new', { method: 'POST', body });
    S.data.prefs[id] = { model: body.model, effort: body.effort, perm: body.permission, fast: body.fast };
    if (body.name) S.data.names[id] = body.name;
    await load();
    const f = S.board.frames.find(x => x.id === $('#nFrame').value);
    const p = f ? freeSpotIn(f) : (c => ({ x: c.x - 140, y: c.y - 60 }))(centerWorld());
    if (!S.byId[id]) S.byId[id] = { id, title: body.name || body.text.slice(0, 60), cwd: body.cwd, project: '', mtime: Date.now(), firstPrompt: body.text };
    placeCard(id, p.x, p.y);
    $('#dlgNew').close(); openSession(id);
  } catch (err) { $('#nErr').textContent = err.message; }
  finally { btn.disabled = false; }
};

/* ---------- painel de conversa ---------- */
function renderTabs() {
  const T = $('#tabs'); T.innerHTML = '';
  for (const id of S.tabs) {
    const s = S.byId[id]; if (!s) continue; const st = stateOf(id);
    const t = el('div', 'tab' + (id === S.cur ? ' on' : ''), `<i class="dot ${st.cls}"></i><span>${esc(s.title)}</span><button class="x" title="Fechar aba">✕</button>`);
    t.onclick = e => { if (e.target.classList.contains('x')) { e.stopPropagation(); closeTab(id); } else openSession(id); };
    T.appendChild(t);
  }
  const on = T.querySelector('.tab.on'); if (on) on.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  localStorage.setItem('cb.tabs', JSON.stringify(S.tabs));
}
function closeTab(id) { S.tabs = S.tabs.filter(x => x !== id); if (S.cur === id) { if (S.tabs.length) openSession(S.tabs[S.tabs.length - 1]); else closePanel(); } else renderTabs(); }
function closePanel() { if (S.es) S.es.close(); S.es = null; const prev = S.cur; S.cur = null; $('#panel').classList.add('hidden'); if (prev) updateCard(prev); renderList(); }
$('#pClose').onclick = () => closePanel();

async function openSession(id) {
  const s = S.byId[id]; if (!s) return toast('Conversa não encontrada');
  const prev = S.cur; S.cur = id; if (!S.tabs.includes(id)) S.tabs.push(id); if (S.tabs.length > 10) S.tabs.shift();
  if (prev && prev !== id) updateCard(prev); updateCard(id);
  $('#panel').classList.remove('hidden'); renderTabs(); renderList();
  $('#pTitle').value = s.title;
  $('#pMeta').innerHTML = `<span id="sessUse"></span>`; $('#pTitle').title = `Pasta: ${(s.cwd || '').replace(S.home, '~') || '~'}\nID: ${id}${s.entrypoint ? '\nCriada via: ' + s.entrypoint.replace('claude-', '') : ''}\n(clique pra renomear)`;
  renderCtx(id);
  const pr = S.data.prefs[id] || {};
  $('#pModel').value = pr.model || 'opus'; $('#pEffort').value = pr.effort || 'medium'; $('#pPerm').value = pr.perm || 'bypassPermissions'; setFastBtn(!!pr.fast); // padrão explícito: nunca cair no default global (Opus 4.8 1M + xhigh)
  S.items = []; S.cursor = null; S.typing = ''; S.thinking = ''; S.queue = []; renderQueue(); attState.main = []; renderAttachs('main'); $('#msgs').innerHTML = '<div class="msg system">Carregando…</div>';
  renderProgress();
  if (S.es) S.es.close();
  const es = new EventSource(`/api/session/${id}/stream`); S.es = es; let opened = false;
  // Toda vez que a conexão (re)abre, recarrega o histórico do arquivo: garante que o que o Claude
  // falou e as ferramentas que rodou enquanto a aba esteve fora/offline apareçam (não só o custo).
  es.onopen = () => { if (opened && S.cur === id) reloadMessages(id); opened = true; };
  es.addEventListener('items', e => { if (S.cur !== id) return; const { items } = JSON.parse(e.data); addItems(items); });
  es.addEventListener('notice', e => { if (S.cur === id) toast(JSON.parse(e.data).text, 6000); });
  es.addEventListener('queue', e => { if (S.cur !== id) return; S.queue = JSON.parse(e.data).queue || []; renderQueue(); });
  es.addEventListener('delta', e => { if (S.cur !== id) return; S.typing += JSON.parse(e.data).text; renderTyping(); });
  es.addEventListener('think', e => { if (S.cur !== id) return; S.thinking = (S.thinking || '') + JSON.parse(e.data).text; renderTyping(); });
  es.addEventListener('think_reset', () => { if (S.cur !== id) return; S.thinking = ''; renderTyping(); });
  es.addEventListener('delta_reset', () => { if (S.cur !== id) return; S.typing = ''; renderTyping(); });
  es.addEventListener('done', async e => { if (S.cur !== id) return; S.typing = ''; S.thinking = ''; renderTyping(); const d = JSON.parse(e.data); S.status[id] = { running: false, ...d }; renderProgress(); if (d.error) toast('Erro: ' + d.error.slice(0, 200), 6000); else if (d.external) toast('Conversa terminou — sua vez'); try { const j = await api(`/api/session/${id}/messages`); if (S.cur === id) { S.items = keepLocal(j.items); S.cursor = j.cursor; renderMsgs(true); } } catch { } });
  // conversa recém-criada: o servidor pode levar alguns segundos pra indexar o arquivo → tenta de novo em vez de desistir
  for (let tent = 0; tent < 12; tent++) {
    try {
      const j = await api(`/api/session/${id}/messages`);
      if (S.cur !== id) return;
      S.items = keepLocal(j.items); S.cursor = j.cursor; renderMsgs(true); break;
    } catch (e) {
      if (S.cur !== id) return;
      if (!/não encontrada/.test(e.message) || tent === 11) { $('#msgs').innerHTML = `<div class="msg system">${esc(e.message)}</div>`; break; }
      $('#msgs').innerHTML = '<div class="msg system">Abrindo a conversa nova…</div>';
      await new Promise(r => setTimeout(r, 1200));
    }
  }
  if (innerWidth > 820) $('#input').focus();
}
async function reloadMessages(id) {
  // recarrega preservando a posição de rolagem; addItems/renderMsgs deduplicam por id
  try {
    const box = $('#msgs'); const atBottom = box.scrollHeight - box.scrollTop - box.clientHeight < 140;
    const j = await api(`/api/session/${id}/messages`); if (S.cur !== id) return;
    const have = new Set(S.items.map(i => i.id));
    if (j.items.length === S.items.length && j.items.every(i => have.has(i.id))) return; // nada novo
    S.items = keepLocal(j.items); S.cursor = j.cursor; renderMsgs(atBottom);
  } catch { }
}
async function loadOlder() {
  const id = S.cur; if (!S.cursor) return;
  const j = await api(`/api/session/${id}/messages?before=${S.cursor}`); if (S.cur !== id) return;
  const box = $('#msgs'); const h = box.scrollHeight;
  S.items = j.items.concat(S.items); S.cursor = j.cursor; renderMsgs(false); box.scrollTop = box.scrollHeight - h;
}
function addItems(items) {
  const have = new Set(S.items.map(i => i.id)); const fresh = items.filter(i => !have.has(i.id)); if (!fresh.length) return;
  if (fresh.some(i => i.kind === 'assistant' || i.kind === 'tool')) { S.typing = ''; S.thinking = ''; }
  const box = $('#msgs'); const atBottom = box.scrollHeight - box.scrollTop - box.clientHeight < 120;
  S.items = S.items.concat(fresh); renderMsgs(atBottom);
  const s = S.byId[S.cur]; const last = fresh.filter(i => i.kind === 'assistant' || i.kind === 'user').pop();
  if (s && last) { s.lastText = last.text.slice(0, 260); s.lastRole = last.kind; s.mtime = Date.now(); updateCard(S.cur); }
}
function renderMsgs(scroll) {
  const box = $('#msgs'); box.innerHTML = '';
  if (S.cursor) { const b = el('button', 'btn small more', 'Carregar mensagens anteriores'); b.onclick = loadOlder; box.appendChild(b); }
  const results = {}; for (const i of S.items) if (i.kind === 'tool_result') results[i.toolId] = i;
  let lastTs = null;
  for (const i of S.items) {
    if (i.kind === 'tool_result') { if (!S.items.some(t => t.kind === 'tool' && t.toolId === i.toolId)) continue; else continue; }
    if (i.kind === 'thinking') {
      const d = el('details', 'think'); d.innerHTML = `<summary>💭 <span>${esc(i.text.replace(/\s+/g, ' ').slice(0, 160))}</span></summary><div class="md">${md(i.text)}</div>`;
      box.appendChild(d); continue;
    }
    if (i.kind === 'tool' && i.todos) {
      const d = el('div', 'todos'); d.innerHTML = '<div class="th">Tarefas</div>' + i.todos.map(t => `<div class="td ${t.s}">${t.s === 'completed' ? '☑' : t.s === 'in_progress' ? '◐' : '☐'} ${esc(t.s === 'in_progress' ? (t.a || t.c) : t.c)}</div>`).join('');
      box.appendChild(d); continue;
    }
    if (i.kind === 'tool' && i.questions) {
      const r = results[i.toolId];
      const d = el('div', 'askq'); d.innerHTML = i.questions.map(q => `<div class="qq">❓ ${esc(q.q)}</div><div class="qo">${q.o.map(o => `<span>${esc(o)}</span>`).join('')}</div>`).join('') + (r ? `<div class="qr">${esc(r.text.slice(0, 400))}</div>` : '<div class="qr">Responda escrevendo abaixo</div>');
      box.appendChild(d); continue;
    }
    if (i.kind === 'tool') {
      const r = results[i.toolId];
      const d = el('details', 'tool' + (r && r.error ? ' err' : ''));
      d.innerHTML = `<summary><b>${esc(i.name)}</b><span>${esc(i.summary)}</span><span class="st">${r ? (r.error ? '✕' : '✓') : '<i class="dot run"></i>'}</span></summary>${toolBody(i)}${r ? `<pre class="res">${esc(r.text)}</pre>` : ''}`;
      if (i.diff || i.cmd) d.open = !r || i.diff != null;
      box.appendChild(d); continue;
    }
    const d = el('div', 'msg ' + i.kind);
    if (i.kind === 'assistant' || i.kind === 'local') d.innerHTML = (i.kind === 'local' ? '<div class="lochead">resposta do comando</div>' : '') + `<div class="md">${md(i.text)}</div>`;
    if (i.kind === 'assistant' || i.kind === 'local') { const cb = el('button', 'cpmsg', 'copiar resposta'); cb.type = 'button'; cb.title = 'Copiar a resposta inteira (texto em markdown)'; cb.dataset.iid = i.id; d.appendChild(cb); }
    else if (i.img) { const im = el('img', 'mimg'); im.src = i.img; im.onclick = () => showImg(i.img); if (i.text) d.appendChild(el('div', null, esc(i.text))); d.appendChild(im); }
    else d.textContent = i.text;
    if (i.kind !== 'system' && i.ts && (!lastTs || Date.parse(i.ts) - lastTs > 120000)) { const w = el('div', 'when', new Date(i.ts).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) + (i.model ? ' · ' + shortModel(i.model) : '')); d.appendChild(w); }
    if (i.ts) lastTs = Date.parse(i.ts);
    box.appendChild(d);
  }
  if (!S.items.length) box.appendChild(el('div', 'msg system', 'Sem mensagens ainda'));
  const th = el('div', 'livethink'); th.id = 'thinking'; th.style.display = 'none'; box.appendChild(th);
  const t = el('div', 'msg assistant typing'); t.id = 'typing'; t.style.display = 'none'; box.appendChild(t); renderTyping();
  if (scroll) box.scrollTop = box.scrollHeight;
}
function toolBody(i) {
  if (i.cmd) return `<pre class="cmd">$ ${esc(i.cmd)}</pre>`;
  if (i.diff) {
    const o = (i.diff.old || '').split('\n'), n = (i.diff.new || '').split('\n');
    const lines = (i.diff.old ? o.slice(0, 60).map(l => `<span class="dm">- ${esc(l)}</span>`) : []).concat(n.slice(0, 80).map(l => `<span class="dp">+ ${esc(l)}</span>`));
    return `<div class="dfile">${esc(i.diff.file || '')}</div><pre class="diff">${lines.join('\n')}</pre>`;
  }
  return `<pre>${esc(i.input)}</pre>`;
}
function renderTyping() {
  const t = $('#typing'); if (!t) return; const run = S.status[S.cur]?.running;
  const th = $('#thinking'); if (th) { th.style.display = S.thinking && run ? '' : 'none'; th.textContent = '💭 ' + (S.thinking || '').slice(-600); }
  if (S.typing) { t.style.display = ''; t.textContent = S.typing; }
  else if (run) { t.style.display = ''; t.textContent = ''; }
  else t.style.display = 'none';
  const box = $('#msgs'); if (box.scrollHeight - box.scrollTop - box.clientHeight < 200) box.scrollTop = box.scrollHeight;
}
function renderProgress() {
  const id = S.cur; if (!id) return; const st = stateOf(id); const P = $('#pProg'); $('#pDot').className = 'dot ' + st.cls;
  const run = st.cls === 'run';
  // campo SEMPRE ativo: rodando → "Enfileirar" + botão "Enviar agora"; parado → "Enviar"
  $('#pStop').classList.toggle('hidden', !run);
  $('#pSend').textContent = run ? 'Enfileirar' : 'Enviar'; $('#pSend').disabled = false;
  if (run) P.innerHTML = `<span>● ${st.label}${st.st.tool ? ': <code>' + esc(st.st.tool.slice(0, 90)) + '</code>' : ''}</span><span class="bar"><i></i></span>${st.st.tokens && (st.st.tokens.in || st.st.tokens.out) ? '<span>' + tokLabel(st.st.tokens) + '</span>' : ''}<span data-since="${st.st.startedAt}">${dur(Date.now() - st.st.startedAt)}</span>`;
  else if (st.cls === 'live') P.innerHTML = '<span style="color:var(--live)">● Essa conversa está ativa agora na extensão do VS Code. Dá pra acompanhar aqui; mandar mensagem junto pode embaralhar.</span>';
  else if (st.st.endedAt) P.innerHTML = st.st.error ? `<span style="color:var(--err)">✕ ${esc(st.st.error.slice(0, 180))}</span>` : (st.st.external ? `<span style="color:var(--ok)">✓ terminou — sua vez. Veja a última resposta acima e responda se quiser.</span>` : `<span style="color:var(--ok)">✓ terminou em ${dur(st.st.endedAt - st.st.startedAt)}${st.st.tokens && (st.st.tokens.in || st.st.tokens.out) ? ' · ' + tokLabel(st.st.tokens) : ''}${st.st.turns ? ' · ' + st.st.turns + ' passos' : ''}${st.st.fast === 'on' ? ' · ⚡ rápido' : ''}</span>${fastNote(st.st)}`);
  else P.innerHTML = `<span>Última atividade: ${ago(S.byId[id].mtime)}${S.byId[id].model ? ' · ' + esc(shortModel(S.byId[id].model)) : ''}</span>`;
}
// ⚡ modo rápido: liga por conversa; roda com --fast-mode on na assinatura (cobra como uso extra)
function setFastBtn(on) { const b = $('#pFast'); if (!b) return; b.classList.toggle('on', on); b.title = on ? 'Modo rápido LIGADO nesta conversa (clique pra desligar). Conta como uso extra da assinatura.' : 'Modo rápido: o mesmo modelo respondendo bem mais rápido, pela sua assinatura (conta como uso extra)'; }
const FAST_WHY = { extra_usage_disabled: 'o modo rápido precisa do "uso extra" ligado na sua conta: claude.ai → Configurações → Uso', model_not_allowed: 'o modo rápido não vale pra esse modelo; troque pro Opus', preference: 'o modo rápido está desligado pela sua organização' };
function fastNote(st) { if (!st || !st.fastOff || !(S.data.prefs[S.cur] || {}).fast) return ''; return `<div style="color:var(--warn);margin-top:4px">⚡ não rodou no modo rápido: ${esc(FAST_WHY[st.fastOff] || st.fastOff)}</div>`; }
$('#pFast').onclick = () => { const id = S.cur; if (!id) return; const pr = S.data.prefs[id] || (S.data.prefs[id] = { model: $('#pModel').value, effort: $('#pEffort').value, perm: $('#pPerm').value }); pr.fast = !pr.fast; setFastBtn(pr.fast); saveBoard(); renderProgress(); toast(pr.fast ? '⚡ Modo rápido ligado nesta conversa (vale a partir da próxima mensagem)' : 'Modo rápido desligado'); };
['#pModel', '#pEffort', '#pPerm'].forEach(s => $(s).onchange = () => { const id = S.cur; S.data.prefs[id] = { model: $('#pModel').value, effort: $('#pEffort').value, perm: $('#pPerm').value, fast: !!S.data.prefs[id]?.fast }; saveBoard(); renderProgress(); updateCard(id); });
$('#pTitle').onchange = () => rename(S.cur, $('#pTitle').value);
$('#pCopy').onclick = () => copyResume(S.cur);
$('#pStop').onclick = async () => { await api(`/api/session/${S.cur}/stop`, { method: 'POST' }); toast('Parando…'); };
const input = $('#input');
input.addEventListener('input', () => { input.style.height = 'auto'; input.style.height = Math.min(input.scrollHeight, innerHeight * 0.4) + 'px'; });
input.addEventListener('keydown', e => {
  const sm = $('#slashMenu');
  if (!sm.classList.contains('hidden')) {
    const items = [...sm.querySelectorAll('.si')];
    if (e.key === 'ArrowDown') { e.preventDefault(); slashSel = Math.min(slashSel + 1, items.length - 1); updateSlashSel(); return; }
    if (e.key === 'ArrowUp') { e.preventDefault(); slashSel = Math.max(slashSel - 1, 0); updateSlashSel(); return; }
    if (e.key === 'Enter' || e.key === 'Tab') { if (items[slashSel]) { e.preventDefault(); pickMenuItem(items[slashSel]); return; } }
    if (e.key === 'Escape') { e.preventDefault(); hideSlash(); return; }
  }
  if (e.key === 'Enter' && !e.shiftKey && !e.isComposing && innerWidth > 820) { e.preventDefault(); $('#composer').requestSubmit(); }
});
input.addEventListener('input', updateSlash);
let slashSel = 0;
/* ---------- menu "/" = catálogo REAL do Claude Code (igual à extensão) + "@" pra citar arquivo ---------- */
const catalogs = {}; // cwd -> catálogo
function curCwd() { const s = S.byId[S.cur]; return (s && s.cwd) || S.home; }
async function getCatalog(cwd, force) {
  if (!force && catalogs[cwd]) return catalogs[cwd];
  try { catalogs[cwd] = await api('/api/claude/catalog?cwd=' + encodeURIComponent(cwd) + (force ? '&force=1' : '')); } catch { catalogs[cwd] = null; }
  return catalogs[cwd];
}
// comandos que na extensão abrem uma TELA: aqui viram a tela equivalente do painel
const UI_CMDS = {
  model: { desc: 'Trocar o modelo desta conversa', run: () => { $('#pModel').focus(); try { $('#pModel').showPicker(); } catch { } } },
  effort: { desc: 'Trocar o esforço desta conversa', run: () => { $('#pEffort').focus(); try { $('#pEffort').showPicker(); } catch { } } },
  usage: { desc: 'Uso do plano, limites e o que está gastando', run: () => openUsage('uso') },
  config: { desc: 'Configurações do Claude Code (modelo/esforço padrão, permissões…)', run: () => openUsage('claude') },
  mcp: { desc: 'Servidores MCP e status de conexão', run: () => openUsage('claude') },
  clear: { desc: 'Começar conversa nova nesta pasta (a atual fica salva)', run: () => { openNew(); $('#nCwd').value = curCwd(); } },
  rename: { desc: 'Renomear esta conversa', run: () => { $('#pTitle').focus(); $('#pTitle').select(); } },
  resume: { desc: 'Abrir outra conversa (lista à esquerda)', run: () => { document.body.classList.remove('noside'); $('#q').focus(); } },
  export: { desc: 'Baixar esta conversa em Markdown', run: () => exportConv() },
};
const HIDE = /^(__|workflow-launch-exec$|heapdump$|extra-usage$|agents$|design-consent$|design-revoke$|team-onboarding$)/;
function cmdGroup(c, cat) {
  if (UI_CMDS[c.name]) return 'Painel';
  if (/^\(MCP\)/.test(c.desc)) return 'MCP';
  if (cat.skills.includes(c.name) || c.name.includes(':')) return 'Skills';
  return 'Claude Code';
}
async function updateSlash() {
  const v = input.value, pos = input.selectionStart;
  const before = v.slice(0, pos);
  const at = before.match(/(^|\s)@([^\s@]*)$/);
  if (at) return showAtMenu(at[2]);
  const m = v.match(/^\/([\w:.\- ]*)$/);
  if (!m || m[1].includes(' ')) return hideSlash();
  const cat = await getCatalog(curCwd());
  if (!cat) return hideSlash();
  const q = m[1].toLowerCase(), term = new Set(cat.terminalOnly || []);
  const list = cat.commands.filter(c => !term.has(c.name) && !HIDE.test(c.name) && !/^\((removed|Renamed)/i.test(c.desc) && !/^Renamed to/.test(c.desc));
  for (const k of Object.keys(UI_CMDS)) if (!list.some(c => c.name === k)) list.push({ name: k, desc: UI_CMDS[k].desc, hint: '' });
  const order = ['Painel', 'Claude Code', 'Skills', 'MCP'];
  const hit = list.filter(c => c.name.toLowerCase().includes(q) || (q.length > 2 && c.desc.toLowerCase().includes(q)))
    .map(c => ({ ...c, g: cmdGroup(c, cat), desc: UI_CMDS[c.name] ? UI_CMDS[c.name].desc : c.desc }))
    .sort((a, b) => (order.indexOf(a.g) - order.indexOf(b.g)) || ((b.name.toLowerCase().startsWith(q)) - (a.name.toLowerCase().startsWith(q))) || a.name.localeCompare(b.name)).slice(0, 80);
  if (!hit.length) return hideSlash();
  let html = '', last = '';
  hit.forEach((c, i) => { if (c.g !== last) { html += `<div class="sg">${c.g}${c.g === 'Painel' ? ' · abre a tela' : ''}</div>`; last = c.g; }
    html += `<div class="si" data-kind="cmd" data-cmd="${esc(c.name)}"><b>/${esc(c.name)}</b>${c.hint ? `<i>${esc(c.hint)}</i>` : ''}<span>${esc(c.desc.replace(/^\(MCP\)\s*/, ''))}</span></div>`; });
  showMenuBox(html);
}
async function showAtMenu(frag) {
  const base = curCwd(); const dirPart = frag.includes('/') ? frag.slice(0, frag.lastIndexOf('/') + 1) : '';
  const dir = dirPart.startsWith('/') ? dirPart : (base.replace(/\/$/, '') + '/' + dirPart);
  let d; try { d = await api('/api/files?path=' + encodeURIComponent(dir)); } catch { return hideSlash(); }
  const q = frag.slice(dirPart.length).toLowerCase();
  const hit = d.entries.filter(e => !e.hung && e.name.toLowerCase().includes(q) && (q.startsWith('.') || !e.name.startsWith('.'))).slice(0, 60);
  if (!hit.length) return hideSlash();
  showMenuBox(`<div class="sg">Arquivos · ${esc(dir.replace(S.home, '~'))}</div>` + hit.map(e => `<div class="si" data-kind="at" data-path="${esc(dirPart + e.name + (e.dir ? '/' : ''))}" data-dir="${e.dir ? 1 : ''}"><b>${e.dir ? '📁' : '📄'} ${esc(e.name)}${e.dir ? '/' : ''}</b><span>${e.dir ? 'pasta' : fsz(e.size)}</span></div>`).join(''));
}
function showMenuBox(html) {
  const sm = $('#slashMenu'); slashSel = 0; sm.innerHTML = html;
  const first = sm.querySelector('.si'); if (first) first.classList.add('on');
  sm.querySelectorAll('.si').forEach(el => { el.onmousedown = e => { e.preventDefault(); pickMenuItem(el); }; });
  const r = input.getBoundingClientRect(); sm.style.left = r.left + 'px'; sm.style.width = Math.max(r.width, 360) + 'px'; sm.classList.remove('hidden');
  sm.style.bottom = (innerHeight - r.top + 6) + 'px'; sm.style.top = 'auto';
}
function pickMenuItem(el) {
  if (el.dataset.kind === 'at') {
    const pos = input.selectionStart, v = input.value; const before = v.slice(0, pos).replace(/@([^\s@]*)$/, '@' + el.dataset.path + (el.dataset.dir ? '' : ' '));
    input.value = before + v.slice(pos); input.selectionStart = input.selectionEnd = before.length; input.focus();
    if (el.dataset.dir) updateSlash(); else hideSlash(); return;
  }
  const name = el.dataset.cmd;
  if (UI_CMDS[name]) { input.value = ''; hideSlash(); UI_CMDS[name].run(); return; }
  input.value = '/' + name + ' '; hideSlash(); input.focus();
}
function updateSlashSel() { const items = [...$('#slashMenu').querySelectorAll('.si')]; items.forEach((el, i) => el.classList.toggle('on', i === slashSel)); items[slashSel]?.scrollIntoView({ block: 'nearest' }); }
function hideSlash() { $('#slashMenu').classList.add('hidden'); }
function exportConv() { if (S.cur) location.href = `/api/session/${S.cur}/export`; }
input.addEventListener('blur', () => setTimeout(hideSlash, 150));
function renderQueue() {
  const row = $('#queueRow'); const q = S.queue || []; row.innerHTML = '';
  if (!q.length) return;
  const head = el('div', 'qhead', `<span>Fila · ${q.length}</span><a id="qclear" title="Tirar todas da fila">limpar</a>`);
  head.title = 'Cada uma é enviada sozinha quando a resposta atual terminar';
  row.appendChild(head); head.querySelector('#qclear').onclick = async () => { try { await api(`/api/session/${S.cur}/unqueue`, { method: 'POST', body: { all: true } }); } catch { } };
  q.forEach((m, i) => {
    const d = el('div', 'qitem', `<span class="qn">${i + 1}</span><span class="qt" title="${esc(m.text || '')}">${esc(m.text || (m.n ? '(' + m.n + ' anexo)' : ''))}${m.n ? ' 📎' + m.n : ''}</span><button class="btn small qnow" title="Mandar esta agora (interrompe a resposta atual)">⏩ agora</button><button class="qx" title="Tirar da fila">✕</button>`);
    d.querySelector('.qnow').onclick = async ev => { ev.currentTarget.disabled = true; try { await api(`/api/session/${S.cur}/promote`, { method: 'POST', body: { index: i } }); toast('Enviando esta agora…'); } catch (e) { toast(e.message, 4000); ev.currentTarget.disabled = false; } };
    d.querySelector('.qx').onclick = async () => { try { await api(`/api/session/${S.cur}/unqueue`, { method: 'POST', body: { index: i } }); } catch { } };
    row.appendChild(d);
  });
}
async function sendMsg(now) {
  const text = input.value.trim(); const id = S.cur; if (!id) return;
  const atts = attState.main.filter(a => a.done);
  if (!text && !atts.length) return;
  if (attState.main.some(a => !a.done)) return toast('Espere o anexo subir');
  try {
    const r = await api(`/api/session/${id}/send`, { method: 'POST', body: { text, now: !!now, model: $('#pModel').value, effort: $('#pEffort').value, permission: $('#pPerm').value, fast: !!(S.data.prefs[id] || {}).fast, attachments: atts.map(a => ({ path: a.path, name: a.name })) } });
    input.value = ''; input.style.height = 'auto'; attState.main = []; renderAttachs('main');
    if (r.compacting) toast(`Contexto em ${ktok(r.ctx)}: compactando antes, pra gastar menos token. Sua mensagem vai logo em seguida.`, 6000);
    else if (r.queued) toast('Na fila · ' + r.position);
    else if (r.now) toast('Interrompendo e enviando…');
    else { S.status[id] = { running: true, startedAt: Date.now(), phase: 'iniciando' }; renderProgress(); renderTyping(); }
  } catch (err) { toast(err.message, 4000); }
}
$('#composer').onsubmit = e => { e.preventDefault(); sendMsg(false); };

/* ---------- anexos (imagens e arquivos, igual extensão) ---------- */
const attState = { main: [], new: [] };
const FILE_ICON = { pdf: '📕', doc: '📄', docx: '📄', txt: '📄', md: '📄', csv: '📊', xlsx: '📊', xls: '📊', json: '🧾', zip: '🗜️', mp4: '🎬', mov: '🎬', webm: '🎬', mp3: '🎵', wav: '🎵', svg: '🖼️' };
function showImg(src) { const v = $('#imgview'); v.querySelector('img').src = src; v.classList.add('on'); }
function renderAttachs(which) {
  const row = $(which === 'main' ? '#attachRow' : '#nAttachRow'); row.innerHTML = '';
  for (const a of attState[which]) {
    const d = el('div', 'att' + (a.done ? '' : ' up'));
    const ext = (a.name.split('.').pop() || '').toLowerCase();
    const thumb = a.kind === 'image' && a.preview ? `<img src="${a.preview}">` : `<span class="ai">${FILE_ICON[ext] || '📎'}</span>`;
    d.innerHTML = `${thumb}<div style="min-width:0"><div class="an">${esc(a.name)}</div><div class="as">${a.done ? (a.size > 1e6 ? (a.size / 1e6).toFixed(1) + ' MB' : Math.max(1, Math.round(a.size / 1024)) + ' KB') : 'enviando…'}</div></div><button class="ax" title="Remover">✕</button>${a.done ? '' : '<span class="bar" style="width:40%"></span>'}`;
    if (a.kind === 'image' && a.preview) d.querySelector('img').onclick = () => showImg(a.preview);
    d.querySelector('.ax').onclick = () => { attState[which] = attState[which].filter(x => x !== a); renderAttachs(which); };
    row.appendChild(d);
  }
}
function fileToDataURL(f) { return new Promise((ok, bad) => { const r = new FileReader(); r.onload = () => ok(r.result); r.onerror = bad; r.readAsDataURL(f); }); }
async function addFiles(which, files) {
  const au = files.filter(isAudio); if (au.length) { transcribeFiles(au, which === 'new' ? $('#nText') : input); files = files.filter(f => !isAudio(f)); if (!files.length) return; }
  for (const f of files) {
    if (f.size > 60e6) { toast(`${f.name}: maior que 60 MB`); continue; }
    const a = { name: f.name || 'colado.png', kind: f.type.startsWith('image/') ? 'image' : 'file', done: false, preview: null };
    attState[which].push(a);
    if (a.kind === 'image') fileToDataURL(f).then(u => { a.preview = u; renderAttachs(which); });
    renderAttachs(which);
    try {
      const data = await fileToDataURL(f);
      const r = await api('/api/upload', { method: 'POST', body: { name: a.name, data } });
      Object.assign(a, { done: true, path: r.path, size: r.size, url: r.url, kind: r.kind });
    } catch (e) { toast('Falha no anexo: ' + e.message); attState[which] = attState[which].filter(x => x !== a); }
    renderAttachs(which);
  }
}
function wireAttach(which, zone, clipBtn, fileInput) {
  clipBtn.onclick = () => fileInput.click();
  fileInput.onchange = () => { if (fileInput.files.length) addFiles(which, [...fileInput.files]); fileInput.value = ''; };
  zone.addEventListener('paste', e => { const fs = [...(e.clipboardData?.files || [])]; if (fs.length) { e.preventDefault(); addFiles(which, fs); } });
  zone.addEventListener('dragover', e => { if ([...(e.dataTransfer.types || [])].includes('Files')) { e.preventDefault(); zone.classList.add('drop'); } });
  zone.addEventListener('dragleave', e => { if (e.target === zone) zone.classList.remove('drop'); });
  zone.addEventListener('drop', e => { if (e.dataTransfer.files.length) { e.preventDefault(); zone.classList.remove('drop'); addFiles(which, [...e.dataTransfer.files]); } });
}
/* ---------- voz: grava no navegador, converte pra PCM 16 kHz e o Board transcreve com o serviço de voz do próprio Claude ---------- */
const AUDIO_RE = /\.(ogg|oga|opus|mp3|m4a|aac|wav|webm|flac|amr|3gp|caf)$/i;
const isAudio = f => (f.type || '').startsWith('audio/') || AUDIO_RE.test(f.name || '');
function f32ToPcm(f32) { const o = new Int16Array(f32.length); for (let i = 0; i < f32.length; i++) { const v = Math.max(-1, Math.min(1, f32[i])); o[i] = v < 0 ? v * 0x8000 : v * 0x7fff; } return o; }
async function toPcm16k(buf) { // AudioBuffer qualquer → mono 16 kHz
  const len = Math.ceil(buf.duration * 16000); const oc = new OfflineAudioContext(1, Math.max(1, len), 16000);
  const src = oc.createBufferSource(); src.buffer = buf; src.connect(oc.destination); src.start(); return f32ToPcm((await oc.startRendering()).getChannelData(0));
}
async function transcribe(pcm) { const r = await fetch('/api/transcribe?lang=pt', { method: 'POST', headers: { 'Content-Type': 'application/octet-stream' }, body: pcm.buffer }); const j = await r.json().catch(() => ({})); if (!r.ok) throw new Error(j.error || 'HTTP ' + r.status); return j.text || ''; }
function putText(ta, t) { if (!t) return toast('Não entendi nada no áudio', 3500); ta.value = (ta.value.trim() ? ta.value.replace(/\s*$/, ' ') : '') + t; ta.focus(); ta.dispatchEvent(new Event('input')); }
const mic = { on: false };
// Grava com o MediaRecorder do próprio navegador: segue gravando com a aba em segundo plano (você pode ir pra outra aba ou app e voltar)
async function micToggle(btn, ta) {
  if (mic.on) return micStop();
  if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) return toast('Este navegador não deixa gravar aqui', 4000);
  let stream; try { stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 } }); } catch { return toast('Microfone bloqueado: libere no cadeado da barra de endereço', 5000); }
  const mime = ['audio/webm;codecs=opus', 'audio/mp4', 'audio/webm', ''].find(m => !m || MediaRecorder.isTypeSupported(m));
  const rec = new MediaRecorder(stream, mime ? { mimeType: mime, audioBitsPerSecond: 64000 } : undefined); const chunks = [];
  rec.ondataavailable = e => { if (e.data && e.data.size) chunks.push(e.data); };
  rec.start(1000); // pedaço a cada 1 s: nada se perde se a aba ficar em segundo plano
  const t0 = Date.now(), label = btn.textContent, title0 = document.title; btn.classList.add('rec');
  const draw = () => { const s = Math.floor((Date.now() - t0) / 1000), t = Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); btn.textContent = '■ ' + t; document.title = '🔴 ' + t + ' gravando · Claude Board'; if (s >= 1200) micStop(); };
  const tick = setInterval(draw, 500); draw();
  Object.assign(mic, { on: true, btn, ta, label, stream, rec, chunks, tick, title0 });
  toast('Gravando. Pode ir pra outra aba ou app e falar à vontade; volte aqui e clique em ■ pra transcrever.', 5000);
}
async function micStop(cancel) {
  if (!mic.on) return; const { btn, ta, label, stream, rec, chunks, tick, title0 } = mic; mic.on = false;
  clearInterval(tick); document.title = title0; btn.classList.remove('rec');
  await new Promise(r => { rec.onstop = r; try { rec.stop(); } catch { r(); } }); stream.getTracks().forEach(t => t.stop());
  if (cancel) { btn.textContent = label; return toast('Gravação descartada', 2000); }
  const blob = new Blob(chunks, { type: rec.mimeType || 'audio/webm' });
  btn.textContent = '… transcrevendo'; btn.disabled = true;
  try {
    const ac = new (window.AudioContext || window.webkitAudioContext)(); const buf = await ac.decodeAudioData(await blob.arrayBuffer()); ac.close();
    if (buf.duration < 0.4) throw new Error('gravação curta demais');
    putText(ta, await transcribe(await toPcm16k(buf)));
  } catch (e) { toast('Transcrição falhou: ' + e.message, 6000); }
  finally { btn.textContent = label; btn.disabled = false; }
}
window.addEventListener('beforeunload', e => { if (mic.on) { e.preventDefault(); e.returnValue = ''; } });
async function transcribeFiles(files, ta) {
  for (const f of files) {
    toast('Transcrevendo ' + f.name + '…', 60000);
    try { const ac = new (window.AudioContext || window.webkitAudioContext)(); const buf = await ac.decodeAudioData(await f.arrayBuffer()); ac.close(); putText(ta, await transcribe(await toPcm16k(buf))); toast('Áudio transcrito: ' + f.name, 2500); }
    catch (e) { toast('Não consegui transcrever ' + f.name + ': ' + (e.message || 'formato não suportado'), 6000); }
  }
}
$('#btnMic').onclick = () => micToggle($('#btnMic'), input);
$('#nMic').onclick = () => micToggle($('#nMic'), $('#nText'));
document.addEventListener('keydown', e => { if (e.key === 'Escape' && mic.on) { e.preventDefault(); micStop(true); } }, true);
wireAttach('main', $('#composer'), $('#btnClip'), $('#fileInput'));
wireAttach('new', $('#newForm'), $('#nClip'), $('#nFileInput'));
$('#imgview').onclick = () => $('#imgview').classList.remove('on');

/* ---------- markdown leve ---------- */
function md(src) {
  const blocks = []; let s = String(src).replace(/```([\w+-]*)\n?([\s\S]*?)```/g, (_, l, c) => { blocks.push(`<div class="codebox"><button class="cpbtn" type="button" title="Copiar">copiar</button><pre><code>${esc(c.replace(/\n$/, ''))}</code></pre></div>`); return `\u0000${blocks.length - 1}\u0000`; });
  s = esc(s);
  const inline = t => t.replace(/`([^`]+)`/g, '<code>$1</code>').replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>').replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<i>$2</i>')
    .replace(/\[([^\]]+)\]\((https?:[^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>').replace(/(^|[\s(])(https?:\/\/[^\s<)]+)/g, '$1<a href="$2" target="_blank" rel="noopener">$2</a>');
  const out = []; const lines = s.split('\n'); let i = 0;
  while (i < lines.length) {
    const l = lines[i];
    if (/^\u0000\d+\u0000$/.test(l.trim())) { out.push(blocks[+l.trim().slice(1, -1)]); i++; continue; }
    if (/^#{1,4} /.test(l)) { const n = l.match(/^#+/)[0].length; out.push(`<h${n}>${inline(l.slice(n + 1))}</h${n}>`); i++; continue; }
    if (/^\s*\|.*\|\s*$/.test(l) && /^\s*\|[\s:|-]+\|\s*$/.test(lines[i + 1] || '')) {
      const row = (r, t) => '<tr>' + r.trim().replace(/^\||\|$/g, '').split('|').map(c => `<${t}>${inline(c.trim())}</${t}>`).join('') + '</tr>';
      let h = '<table>' + row(l, 'th'); i += 2; while (i < lines.length && /^\s*\|.*\|\s*$/.test(lines[i])) h += row(lines[i++], 'td'); out.push(h + '</table>'); continue;
    }
    if (/^\s*([-*]|\d+\.) /.test(l)) {
      const ord = /^\s*\d+\./.test(l); let h = ord ? '<ol>' : '<ul>';
      while (i < lines.length && /^\s*([-*]|\d+\.) /.test(lines[i])) h += '<li>' + inline(lines[i++].replace(/^\s*([-*]|\d+\.) /, '')) + '</li>';
      out.push(h + (ord ? '</ol>' : '</ul>')); continue;
    }
    if (!l.trim()) { i++; continue; }
    let p = [l]; i++; while (i < lines.length && lines[i].trim() && !/^(#{1,4} |\s*([-*]|\d+\.) |\s*\|)/.test(lines[i]) && !/^\u0000/.test(lines[i].trim())) p.push(lines[i++]);
    out.push('<p>' + inline(p.join('<br>')) + '</p>');
  }
  return out.join('').replace(/\u0000(\d+)\u0000/g, (_, n) => blocks[+n]);
}

/* ---------- tempo real ---------- */
let reloadT = null;
function connectEvents() {
  const es = new EventSource('/api/events');
  es.addEventListener('status', e => {
    const { id, state } = JSON.parse(e.data); S.status[id] = state;
    if (!S.byId[id]) { clearTimeout(reloadT); reloadT = setTimeout(load, 500); return; }
    updateCard(id); renderRunning(); if (id === S.cur) { renderProgress(); renderTyping(); }
    const li = document.querySelector(`.li[data-id="${id}"] .dot`); if (li) li.className = 'dot ' + stateOf(id).cls;
    renderTabs();
  });
  es.addEventListener('index', () => { clearTimeout(reloadT); reloadT = setTimeout(refreshSessions, 300); });
  es.addEventListener('update', e => onUpdateEvent(JSON.parse(e.data)));
  es.addEventListener('account', e => { S.account = JSON.parse(e.data); renderAccount(); });
  es.addEventListener('models', e => { const d = JSON.parse(e.data); S.models = d.models; setModels(d.models, d.modelList); toast('Lista de modelos atualizada', 3000); });
  es.addEventListener('usage', e => { const d = JSON.parse(e.data); if (d.rateLimit) { S.rateLimit = d.rateLimit; renderUsageMini(); if (S.usageOpen) renderUsage(); } });
  es.addEventListener('queue', e => { const d = JSON.parse(e.data); if (d.id === S.cur) { S.queue = d.queue || []; renderQueue(); } });
  es.onerror = () => { };
}
async function refreshSessions() {
  const j = await api('/api/state');
  S.sessions = j.sessions; S.byId = Object.fromEntries(j.sessions.map(s => [s.id, s])); S.status = j.status; S.rateLimit = j.rateLimit;
  fillProjects(); renderList(); renderRunning(); renderUsageMini();
  const C = $('#cards'); const shown = new Set([...C.querySelectorAll('.card')].map(c => c.dataset.id));
  const want = Object.keys(S.board.cards).filter(id => S.byId[id]);
  if (want.length !== shown.size || want.some(id => !shown.has(id))) renderBoard(); else want.forEach(updateCard);
  if (S.cur) { renderProgress(); renderCtx(S.cur); }
}
setInterval(() => { document.querySelectorAll('[data-since]').forEach(e => e.textContent = dur(Date.now() - +e.dataset.since)); }, 1000);
setInterval(() => { if (!document.hidden) refreshSessions().catch(() => { }); }, 30000);
setInterval(() => { renderUsageMini(); }, 30000); // vira o uso na hora do reinício mesmo sem dado novo
// Ao voltar pra aba (ou destravar o celular), recarrega a conversa aberta e a lista:
// mostra tudo que rolou enquanto você esteve fora.
document.addEventListener('visibilitychange', () => { if (!document.hidden) { refreshSessions().catch(() => { }); if (S.cur) reloadMessages(S.cur); } });
addEventListener('focus', () => { if (S.cur) reloadMessages(S.cur); });
addEventListener('keydown', e => { if (e.key === 'Escape') { hideMenu(); } });

function fitFirstFrame() { const f = S.board.frames[0]; if (!f) return fitAll(); const r = stage.getBoundingClientRect(); const z = Math.min(1, (r.width - 24) / f.w); S.view = { z, x: 12 - f.x * z, y: 12 - f.y * z }; applyView(); saveView(); }
load().then(() => { connectEvents(); if (!localStorage.getItem('cb.view')) (innerWidth < 820 ? fitFirstFrame : fitAll)(); });

/* ---------- modo dia / noite ---------- */
function applyThemeIcon() { const dark = document.documentElement.dataset.theme === 'dark'; const b = $('#btnTheme'); if (b) { b.textContent = dark ? '☀' : '☾'; b.title = dark ? 'Mudar para modo dia' : 'Mudar para modo noite'; } }
$('#btnTheme').onclick = () => {
  const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
  document.documentElement.dataset.theme = next; try { localStorage.setItem('cb.theme', next); } catch { }
  const b = $('#btnTheme'); b.classList.remove('spin'); void b.offsetWidth; b.classList.add('spin'); applyThemeIcon();
};
applyThemeIcon();

/* ---------- painel da conversa À ESQUERDA (lista | conversa | quadro) + tela cheia ---------- */
const PW_MIN = 380, MINI = 300;   // MINI = largura do quadro no modo tela cheia
function sideW() { const b = document.body.classList; return (b.contains('noside') || b.contains('chat-full')) ? 0 : $('#side').getBoundingClientRect().width; }
function pwMax() { return Math.max(PW_MIN, innerWidth - sideW() - 260); }   // sempre sobra quadro clicável
function curPw() { return parseInt(getComputedStyle(document.documentElement).getPropertyValue('--pw')) || 640; }
function savedPw() { try { return +localStorage.getItem('cb.pw') || 640; } catch { return 640; } }
function setPw(px, save) {
  if (innerWidth < 820) { document.documentElement.style.removeProperty('--pw'); return; }
  px = Math.max(PW_MIN, Math.min(pwMax(), Math.round(px)));
  document.documentElement.style.setProperty('--pw', px + 'px');
  if (save) try { localStorage.setItem('cb.pw', px); } catch { }
}
function isFull() { return document.body.classList.contains('chat-full'); }
function savedFullPw() { let v = 0; try { v = +localStorage.getItem('cb.pwFull') || 0; } catch { } return v || innerWidth - MINI; }
function setFull(on) {
  if (on === isFull()) return;
  if (on) { S.prevView = { ...S.view }; document.body.classList.add('chat-full'); setPw(savedFullPw(), false); }
  else { document.body.classList.remove('chat-full'); setPw(savedPw(), false); }
  $('#pWide').textContent = on ? '⤡' : '⤢'; $('#pWide').title = on ? 'Sair da tela cheia' : 'Conversa em tela cheia (quadro fica no canto)';
  setTimeout(() => { if (on) fitAll(); else if (S.prevView) { S.view = S.prevView; applyView(); saveView(); } }, 230); // espera a transição do quadro
}
setPw(savedPw(), false);
addEventListener('resize', () => setPw(isFull() ? savedFullPw() : curPw(), false));
$('#pResize').addEventListener('pointerdown', e => {
  if (innerWidth < 820) return; e.preventDefault(); const h = $('#pResize'); h.classList.add('on'); document.body.classList.add('resizing');
  const left = $('#panel').getBoundingClientRect().left;
  const mv = ev => setPw(ev.clientX - left, false);
  const up = ev => { removeEventListener('pointermove', mv); removeEventListener('pointerup', up); h.classList.remove('on'); document.body.classList.remove('resizing');
    if (isFull()) { setPw(ev.clientX - left, false); try { localStorage.setItem('cb.pwFull', curPw()); } catch { } setTimeout(fitAll, 60); } // tela cheia continua: só muda a divisão
    else setPw(ev.clientX - left, true); };
  addEventListener('pointermove', mv); addEventListener('pointerup', up);
});
$('#pResize').addEventListener('dblclick', () => setFull(!isFull()));
$('#pWide').onclick = () => setFull(!isFull());
// fechar o painel sai da tela cheia; abrir/esconder a lista reajusta a largura
const _closePanel = closePanel; closePanel = function () { if (isFull()) setFull(false); return _closePanel.apply(this, arguments); };
$('#btnSide').addEventListener('click', () => { if (isFull()) { document.body.classList.remove('noside'); setFull(false); } setTimeout(() => setPw(curPw(), false), 220); });

/* ---------- tamanho do contexto: cada passo do Claude relê isso tudo ---------- */
const CTX_WARN = 250000, CTX_HIGH = 500000;
function ctxLevel(n) { return n >= CTX_HIGH ? 'high' : n >= CTX_WARN ? 'warn' : ''; }
function renderCtx(id) {
  const s = S.byId[id]; const el = $('#sessUse'); if (!s || !el || S.cur !== id) return;
  const n = s.ctx; if (n == null) { el.innerHTML = ''; return; }
  const lv = ctxLevel(n);
  el.innerHTML = n === 0 ? '<b>contexto:</b> recém-compactado' :
    `<span class="ctxpill ${lv}" title="Tamanho do histórico que o Claude relê a CADA passo (cada comando, cada leitura). Quanto maior, mais token por passo.">contexto ${ktok(n)}</span>` +
    (lv ? ` <button class="btn small ctxbtn" id="btnCompact" title="Resume o histórico mantendo o que importa. Reduz o custo de cada passo.">🗜 Compactar</button>` : '');
  const b = $('#btnCompact'); if (b) b.onclick = async () => {
    if (!confirm(`Compactar esta conversa? O histórico de ${ktok(n)} tokens vira um resumo e cada passo fica bem mais barato. O Claude continua lembrando do que importa.`)) return;
    try { const r = await api(`/api/session/${id}/send`, { method: 'POST', body: { text: '/compact', model: $('#pModel').value, effort: $('#pEffort').value, permission: $('#pPerm').value, fast: !!(S.data.prefs[id] || {}).fast } });
      toast(r.queued ? 'Compactação na fila: roda quando a atual terminar' : 'Compactando…'); } catch (e) { toast(e.message, 4000); }
  };
}

function keepLocal(items) { const loc = (S.items || []).filter(x => x.kind === 'local' && !items.some(y => y.id === x.id)); return items.concat(loc); }
$('#pExport').onclick = exportConv;

/* ---------- aba ⚙ Claude: configurações do próprio Claude Code + MCP, agentes, plugins, skills, memória ---------- */
const EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max'];
async function renderClaudeTab(force) {
  const box = $('#claudeBody'); box.innerHTML = '<div class="ucard">Lendo as configurações do Claude Code…</div>';
  let st, cat;
  try { [st, cat] = await Promise.all([api('/api/claude/settings'), getCatalog(curCwd(), force)]); } catch (e) { box.innerHTML = '<div class="ucard">Erro: ' + esc(e.message) + '</div>'; return; }
  let cfg = {}; try { cfg = JSON.parse(st.text); } catch { }
  const env = cfg.env || {}, perm = (cfg.permissions || {}).defaultMode || '';
  const sel = (id, opts, cur) => `<select id="${id}">${opts.map(o => `<option value="${esc(o[0])}"${o[0] === cur ? ' selected' : ''}>${esc(o[1])}</option>`).join('')}</select>`;
  const mcpBadge = s => ({ connected: ['ok', 'conectado'], 'needs-auth': ['na', 'precisa autorizar'], pending: ['na', 'conectando'], failed: ['off', 'falhou'] }[s] || ['na', s]);
  const op = Object.assign({ autoCompact: true, threshold: 250000 }, S.data.optim || {});
  box.innerHTML = `
  <div class="ucard"><h4>Otimização de token (automática, do Board)</h4>
    <div class="cfgrid">
      <label class="cfchk"><input type="checkbox" id="opAuto"${op.autoCompact !== false ? ' checked' : ''}> Compactar sozinho conversas longas antes de enviar</label>
      <label>Compactar quando o contexto passar de ${sel('opTh', [['150000', '150 mil (economiza mais)'], ['250000', '250 mil (recomendado)'], ['400000', '400 mil'], ['600000', '600 mil']], String(op.threshold))}</label>
    </div>
    <div class="cfnote">Cada passo do Claude relê a conversa inteira. Ao passar do limite, o Board roda <b>/compact</b> preservando decisões, pedidos pendentes, arquivos, comandos, erros e preferências; o resto vira resumo. Sua mensagem vai logo depois. Não compacta duas vezes em menos de 15 min.</div>
  </div>
  <div class="ucard"><h4>Configurações do Claude Code <span class="ul-reset">(valem pra extensão, terminal e painel quando o seletor está em "padrão")</span></h4>
    <div class="cfgrid">
      <label>Modelo padrão ${sel('cfModel', [['', '(não definido)'], ['opus', 'Opus (mais recente)'], ['sonnet', 'Sonnet'], ['haiku', 'Haiku'], ['fable', 'Fable'], ].concat((S.modelList || []).map(m => [m.id, m.label + ' (fixo)']), [['claude-opus-4-8[1m]', 'Opus 4.8 · 1M contexto (fixo)']]), cfg.model || '')}</label>
      <label>Modelo forçado (env ANTHROPIC_MODEL) <input id="cfEnvModel" value="${esc(env.ANTHROPIC_MODEL || '')}" placeholder="vazio = usa o modelo padrão"></label>
      <label>Esforço padrão ${sel('cfEffort', [['', '(não definido)']].concat(EFFORTS.map(e => [e, e])), cfg.effortLevel || '')}</label>
      <label>Permissões padrão ${sel('cfPerm', [['', '(não definido)'], ['default', 'perguntar'], ['acceptEdits', 'aceitar edições'], ['plan', 'só planejar'], ['bypassPermissions', 'sem pedir permissão']], perm)}</label>
      <label class="cfchk"><input type="checkbox" id="cfThink"${cfg.alwaysThinkingEnabled ? ' checked' : ''}> Pensamento estendido sempre ligado</label>
    </div>
    ${env.ANTHROPIC_MODEL ? `<div class="cfwarn">⚠ "Modelo forçado" (${esc(env.ANTHROPIC_MODEL)}) passa por cima do "Modelo padrão". Deixe vazio se quiser que o padrão valha.</div>` : ''}
    ${Object.keys(cfg.modelSettings || {}).length ? `<div class="cfnote"><b>Esforço por modelo</b> (tem prioridade sobre o esforço padrão): ${Object.entries(cfg.modelSettings).map(([m, v]) => `${esc(m)} = <b>${esc((v || {}).effortLevel || '—')}</b>`).join(' · ')}</div>` : ''}
    ${(cfg.effortLevel === 'xhigh' || cfg.effortLevel === 'max') ? `<div class="cfwarn">⚠ Esforço padrão ${esc(cfg.effortLevel)}: vale pros modelos SEM ajuste próprio acima. Pensa mais em cada passo e gasta mais token; medium costuma bastar.</div>` : ''}
    <div class="cfrow"><button class="btn primary" id="cfSave">Salvar configurações</button><button class="btn small" id="cfRawT">Editar JSON completo</button><span class="ul-reset">${esc(st.path)} · backup automático antes de salvar</span></div>
    <textarea id="cfRaw" class="hidden" spellcheck="false">${esc(st.text)}</textarea>
  </div>
  ${cat ? `
  <div class="ucard"><h4>Servidores MCP (${cat.mcp.length})</h4>${cat.mcp.map(m => { const b = mcpBadge(m.status); return `<div class="vrow"><span>${esc(m.name)} <small class="ul-reset">${esc(m.source || '')}</small></span><span class="vbadge ${b[0]}">${esc(b[1])}</span></div>`; }).join('')}
    <div class="ul-reset" style="margin-top:6px">Os que "precisam autorizar" se conectam pelo claude.ai (conectores) ou rodando /mcp no terminal.</div></div>
  <div class="ucard"><h4>Skills <span id="skCount" class="ul-reset"></span> <input id="skQ" placeholder="buscar skill…" class="skq"></h4>
    <div class="skfilt" id="skFilt"><button data-f="all" class="on">Todas</button><button data-f="on">Ativas</button><button data-f="off">Desativadas</button></div>
    <div id="skList" class="sklist skgroups"></div>
    <div class="cfnote">Skill desativada não entra no contexto (economiza token em todo passo) e fica guardada em ~/.claude/skills-desativadas. Ativar ou desativar vale a partir da próxima mensagem.</div></div>
  <div class="ucard"><h4>Agentes (${cat.agents.length})</h4><div class="chips">${cat.agents.map(a => `<span class="tag">${esc(a)}</span>`).join('')}</div></div>
  <div class="ucard"><h4>Plugins (${cat.plugins.length})</h4>${cat.plugins.map(p => `<div class="vrow"><span>${esc(p.name)}</span><span class="ul-reset">${esc(p.version || '')}</span></div>`).join('')}</div>
  <div class="ucard"><h4>Memória e instruções</h4>
    ${[['~/.claude/CLAUDE.md (todas as conversas)', S.home + '/.claude/CLAUDE.md'], ['CLAUDE.md desta pasta', curCwd() + '/CLAUDE.md'], ['Memória automática', (cat.memory.auto || '').replace(/\/$/, '')]].filter(x => x[1]).map(x => `<div class="vrow"><span>${esc(x[0])}</span><a class="oplink" data-p="${esc(x[1])}">abrir ↗</a></div>`).join('')}</div>
  <div class="ul-reset">Claude Code ${esc(cat.version || '')} · estilo de saída: ${esc(cat.outputStyle || 'default')} · <a class="oplink" id="catRefresh">reler catálogo</a></div>` : '<div class="ucard">Não consegui ler o catálogo do Claude Code agora.</div>'}`;
  // skills: ativas e desativadas, por grupo, com botão de ativar/desativar
  let skData = [], skF = 'all'; const skOpen = S.skOpen || (S.skOpen = new Set());
  const loadSk = async () => { try { skData = (await api('/api/claude/skills')).skills; } catch { skData = []; }
    const local = new Set(skData.map(x => x.name));
    for (const n of cat.skills) if (!local.has(n)) { const c = cat.commands.find(c => c.name === n) || {}; skData.push({ name: n, desc: c.desc || '', active: true, group: 'Da conta e plugins', fixed: true }); }
    drawSk(); };
  const drawSk = () => { const q = ($('#skQ') || {}).value?.toLowerCase() || '';
    const on = skData.filter(x => x.active).length; $('#skCount').textContent = `· ${on} ativas · ${skData.length - on} desativadas`;
    const vis = skData.filter(x => (skF === 'all' || (skF === 'on') === x.active) && (!q || (x.name + ' ' + x.desc).toLowerCase().includes(q)));
    const groups = {}; for (const x of vis) (groups[x.group] = groups[x.group] || []).push(x);
    const order = Object.keys(groups).sort((a, b) => (a === 'Da conta e plugins') - (b === 'Da conta e plugins') || (a === 'Outras') - (b === 'Outras') || a.localeCompare(b));
    $('#skList').innerHTML = order.map(g => { const L = groups[g], n = L.filter(x => x.active).length, all = skData.filter(x => x.group === g);
      return `<details class="skg"${q || skOpen.has(g) ? ' open' : ''} data-g="${esc(g)}"><summary><b>${esc(g)}</b><span class="skgc">${all.filter(x => x.active).length}/${all.length} ativas</span>${!g.startsWith('Da conta') && all.length > 1 ? `<span class="skgall"><button class="btn small" data-ga="1">ativar todas</button><button class="btn small" data-ga="0">desativar todas</button></span>` : ''}</summary>
        ${L.map(x => `<div class="skrow${x.active ? '' : ' off'}" data-n="${esc(x.name)}"><b title="${x.active ? 'Clique pra usar na conversa aberta' : 'Ative pra usar'}">/${esc(x.name)}</b><span>${esc(x.desc)}</span>${x.fixed ? '<em class="ul-reset">da conta</em>' : `<button class="btn small sktg" data-a="${x.active ? 0 : 1}">${x.active ? 'Desativar' : 'Ativar'}</button>`}</div>`).join('')}</details>`; }).join('') || '<div class="ul-reset" style="padding:8px">nenhuma</div>';
    $('#skList').querySelectorAll('details').forEach(d => d.ontoggle = () => { d.open ? skOpen.add(d.dataset.g) : skOpen.delete(d.dataset.g); });
    $('#skList').querySelectorAll('.skrow b').forEach(b => b.onclick = () => { const r = b.parentElement; if (r.classList.contains('off')) return toast('Essa skill está desativada: clique em Ativar primeiro'); if (!S.cur) return toast('Abra uma conversa primeiro'); $('#dlgUsage').close(); input.value = '/' + r.dataset.n + ' '; input.focus(); });
    const toggle = async (names, active) => { try { for (const n of names) await api('/api/claude/skills', { method: 'POST', body: { name: n, active } }); for (const k in catalogs) delete catalogs[k]; toast(`${names.length > 1 ? names.length + ' skills ' : '/' + names[0] + ' '}${active ? 'ativada' : 'desativada'}${names.length > 1 ? 's' : ''}`, 2500); } catch (e) { toast(e.message, 5000); } loadSk(); };
    $('#skList').querySelectorAll('.sktg').forEach(bt => bt.onclick = () => toggle([bt.closest('.skrow').dataset.n], bt.dataset.a === '1'));
    $('#skList').querySelectorAll('[data-ga]').forEach(bt => bt.onclick = e => { e.preventDefault(); e.stopPropagation(); const g = bt.closest('details').dataset.g, act = bt.dataset.ga === '1'; toggle(skData.filter(x => x.group === g && !x.fixed && x.active !== act).map(x => x.name), act); });
  };
  if (cat) { loadSk(); $('#skQ').oninput = drawSk; $('#skFilt').querySelectorAll('button').forEach(b => b.onclick = () => { skF = b.dataset.f; $('#skFilt').querySelectorAll('button').forEach(x => x.classList.toggle('on', x === b)); drawSk(); }); }
  box.querySelectorAll('.oplink[data-p]').forEach(a => a.onclick = () => { const pth = a.dataset.p; dashTab('files'); if (/\.md$/.test(pth)) { openFiles(pth.replace(/\/[^/]+$/, '')).then(() => viewFile(pth)); } else openFiles(pth); });
  const rf = $('#catRefresh'); if (rf) rf.onclick = () => renderClaudeTab(true);
  const saveOp = () => { S.data.optim = { autoCompact: $('#opAuto').checked, threshold: +$('#opTh').value }; saveBoard(); toast($('#opAuto').checked ? 'Otimização ligada: compacta acima de ' + ktok(+$('#opTh').value) : 'Otimização automática desligada', 3500); };
  $('#opAuto').onchange = saveOp; $('#opTh').onchange = saveOp;
  $('#cfRawT').onclick = () => $('#cfRaw').classList.toggle('hidden');
  $('#cfSave').onclick = async () => {
    let obj; const rawOpen = !$('#cfRaw').classList.contains('hidden');
    try { obj = JSON.parse(rawOpen ? $('#cfRaw').value : st.text); } catch (e) { return toast('JSON inválido: ' + e.message, 5000); }
    if (!rawOpen) {
      const setOr = (o, k, v) => { if (v === '' || v == null || v === false) delete o[k]; else o[k] = v; };
      setOr(obj, 'model', $('#cfModel').value); setOr(obj, 'effortLevel', $('#cfEffort').value); setOr(obj, 'alwaysThinkingEnabled', $('#cfThink').checked);
      obj.env = obj.env || {}; setOr(obj.env, 'ANTHROPIC_MODEL', $('#cfEnvModel').value.trim()); if (!Object.keys(obj.env).length) delete obj.env;
      obj.permissions = obj.permissions || {}; setOr(obj.permissions, 'defaultMode', $('#cfPerm').value); if (!Object.keys(obj.permissions).length) delete obj.permissions;
    }
    try { await api('/api/claude/settings', { method: 'PUT', body: { text: JSON.stringify(obj, null, 2) } }); toast('Configurações salvas (backup feito). Valem a partir da próxima mensagem.', 4000); for (const k in catalogs) delete catalogs[k]; renderClaudeTab(true); }
    catch (e) { toast(e.message, 6000); }
  };
}

/* ---------- copiar: blocos de código (links, comandos) e a resposta inteira ---------- */
async function copyText(t) {
  try { await navigator.clipboard.writeText(t); return true; }
  catch { const ta = document.createElement('textarea'); ta.value = t; ta.style.position = 'fixed'; ta.style.opacity = '0'; document.body.appendChild(ta); ta.select(); let ok = false; try { ok = document.execCommand('copy'); } catch { } ta.remove(); return ok; }
}
function flashCopied(btn, label) { btn.textContent = 'copiado ✓'; btn.classList.add('ok'); clearTimeout(btn._t); btn._t = setTimeout(() => { btn.textContent = label; btn.classList.remove('ok'); }, 1400); }
$('#msgs').addEventListener('click', async e => {
  const b = e.target.closest('.cpbtn, .cpmsg'); if (!b) return; e.preventDefault(); e.stopPropagation();
  let text = '';
  if (b.classList.contains('cpbtn')) text = (b.parentElement.querySelector('code') || b.parentElement).textContent;
  else { const it = (S.items || []).find(x => x.id === b.dataset.iid); text = it ? it.text : ''; }
  if (!text) return;
  if (await copyText(text.replace(/\n$/, ''))) flashCopied(b, b.classList.contains('cpbtn') ? 'copiar' : 'copiar resposta');
  else toast('Não consegui copiar');
});

/* ---------- modo LOCAL (app no Mac de cada pessoa): conta Claude, instalar CLI, atualização ---------- */
function applyMode() {
  if (S.mode !== 'local') return;
  document.body.classList.add('mode-local');
  const vt = document.querySelector('.dtab[data-tab="vps"]'); if (vt) vt.remove();
  const lo = $('#logout'); if (lo) lo.parentElement.innerHTML = 'Claude Board ' + esc(S.version || '') + ' · suas conversas ficam neste Mac';
  if (!$('#acct')) { const a = el('div', '', ''); a.id = 'acct'; $('#top').insertBefore(a, $('#usageMini')); }
  renderAccount();
}
let acctPoll = null;
function renderAccount() {
  const a = $('#acct'); if (!a) return; const ac = S.account || {};
  clearInterval(acctPoll); acctPoll = null;
  if (!ac.installed) {
    const busy = ac.cliInstall && ac.cliInstall.state === 'running';
    a.innerHTML = `<button class="btn primary" id="acctBtn">${busy ? '⏳ Instalando o Claude Code…' : '⬇ Instalar Claude Code'}</button>`;
    $('#acctBtn').disabled = busy;
    $('#acctBtn').onclick = async () => { await api('/api/claude/install', { method: 'POST' }); toast('Instalando o Claude Code (o motor do Board)…', 5000); pollAccount(); };
    if (busy) pollAccount();
  } else if (!ac.loggedIn) {
    a.innerHTML = '<button class="btn primary" id="acctBtn">🔑 Entrar com Claude</button>';
    $('#acctBtn').onclick = async () => { try { await api('/api/claude/login', { method: 'POST' }); toast('Abri uma janela do terminal: entre na sua conta Claude pelo navegador. O Board percebe sozinho quando terminar.', 8000); pollAccount(); } catch (e) { toast(e.message, 5000); } };
  } else {
    a.innerHTML = `<span class="acctchip" title="${esc([ac.name, ac.org, ac.plan].filter(Boolean).join(' · '))}">● ${esc(ac.email || 'conectado')}</span>`;
  }
}
function pollAccount() {
  clearInterval(acctPoll);
  acctPoll = setInterval(async () => {
    try { const ac = await api('/api/claude/account'); const changed = ac.installed !== (S.account || {}).installed || ac.loggedIn !== (S.account || {}).loggedIn || (ac.cliInstall || {}).state !== ((S.account || {}).cliInstall || {}).state;
      S.account = ac; if (changed) { renderAccount(); if (ac.loggedIn) toast('Conectado como ' + (ac.email || 'sua conta') + ' ✓', 4000); if (ac.cliInstall && ac.cliInstall.state === 'error') toast('Não consegui instalar o Claude Code: ' + ac.cliInstall.log.slice(-160), 9000); }
      if (ac.loggedIn) { clearInterval(acctPoll); acctPoll = null; }
    } catch { }
  }, 3000);
}
function onUpdateEvent(u) {
  if (u.state === 'installing') toast('Atualizando o Claude Board para a versão ' + (u.latest || 'nova') + '…', 6000);
  if (u.state === 'restarting') { toast('Atualizado ✓ recarregando…', 4000); setTimeout(() => location.reload(), 4500); }
  if (u.state === 'error') toast('A atualização falhou: ' + (u.error || ''), 8000);
}
