// Claude Board: painel livre (canvas) das conversas do Claude Code desta VPS.
// Lê ~/.claude/projects (mesma base da extensão), cria/continua conversas via `claude -p`.
'use strict';
const http = require('http');
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');

const ROOT = __dirname;
const os = require('os');
// MODO LOCAL (Mac de cada pessoa da equipe): sem senha, só 127.0.0.1, processos destacados, Keychain, auto-update.
// MODO VPS (padrão no Linux do servidor): igual sempre foi (systemd-run, senha, Caddy).
const WIN = process.platform === 'win32';
const LOCAL = process.env.CB_MODE === 'local' || process.platform === 'darwin' || WIN;
const HOME = process.env.HOME || os.homedir();
const PROJECTS = path.join(HOME, '.claude', 'projects');
const DATA = process.env.CB_DATA || path.join(ROOT, 'data'); // no Mac fica FORA da pasta do app (a atualização troca o app sem apagar dados)
const PUB = path.join(ROOT, 'public');
const UPLOADS = path.join(DATA, 'uploads');
const RUNS = path.join(DATA, 'runs');
fs.mkdirSync(DATA, { recursive: true });
fs.mkdirSync(UPLOADS, { recursive: true });
fs.mkdirSync(RUNS, { recursive: true });

// ---------- config ----------
function loadEnv() {
  const f = path.join(ROOT, '.env');
  if (!fs.existsSync(f)) return;
  for (const l of fs.readFileSync(f, 'utf8').split('\n')) {
    const m = l.match(/^\s*([A-Z_]+)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
  }
}
loadEnv();
const PASSWORD = process.env.BOARD_PASSWORD || '';
const SECRET = process.env.BOARD_SECRET || crypto.randomBytes(32).toString('hex');
const PORT = +process.env.PORT || 8830;
const HOSTS = (process.env.BIND || '127.0.0.1').split(',');
// acha o Claude Code CLI a cada uso (a pessoa pode instalar depois do Board já estar aberto)
function claudeBin() {
  if (process.env.CLAUDE_BIN) return process.env.CLAUDE_BIN;
  const cands = WIN ? [path.join(HOME, '.local', 'bin', 'claude.exe'), path.join(process.env.APPDATA || '', 'npm', 'claude.cmd'), path.join(process.env.LOCALAPPDATA || '', 'Programs', 'claude', 'claude.exe')]
    : [path.join(HOME, '.local/bin/claude'), path.join(HOME, '.claude/local/claude'), '/opt/homebrew/bin/claude', '/usr/local/bin/claude', '/usr/bin/claude'];
  for (const c of cands) { try { fs.accessSync(c, WIN ? fs.constants.F_OK : fs.constants.X_OK); return c; } catch { } }
  return null;
}
const CLAUDE_BIN = claudeBin() || 'claude';
const VERSION = (() => { try { return fs.readFileSync(path.join(ROOT, 'VERSION'), 'utf8').trim(); } catch { return 'dev'; } })();
if (!PASSWORD && !LOCAL) { console.error('BOARD_PASSWORD ausente no .env'); process.exit(1); }

// ---------- auth ----------
function sign(v) { return crypto.createHmac('sha256', SECRET).update(v).digest('hex'); }
function makeToken() { const exp = Date.now() + 30 * 864e5; return exp + '.' + sign('' + exp); }
function authed(req) {
  if (LOCAL) return true; // só escuta em 127.0.0.1 e o blockedRequest barra outro site/Host
  const c = (req.headers.cookie || '').split(';').map(s => s.trim()).find(s => s.startsWith('cb='));
  if (!c) return false;
  const [exp, sig] = c.slice(3).split('.');
  if (!exp || !sig || +exp < Date.now()) return false;
  const good = sign(exp);
  return sig.length === good.length && crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(good));
}
const loginFails = new Map();

// ---------- helpers ----------
function send(res, code, body, headers = {}) {
  const isObj = typeof body === 'object' && !Buffer.isBuffer(body);
  res.writeHead(code, { 'Content-Type': isObj ? 'application/json; charset=utf-8' : 'text/plain; charset=utf-8', 'Cache-Control': 'no-store', ...headers });
  res.end(isObj ? JSON.stringify(body) : body);
}
function readBody(req, limit = 5e6) {
  return new Promise((ok, bad) => {
    let n = 0; const chunks = [];
    req.on('data', c => { n += c.length; if (n > limit) { bad(new Error('grande demais')); req.destroy(); } else chunks.push(c); });
    req.on('end', () => { try { ok(chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {}); } catch (e) { bad(e); } });
    req.on('error', bad);
  });
}
async function readRange(file, start, len) {
  const fh = await fsp.open(file, 'r');
  try { const buf = Buffer.alloc(len); const { bytesRead } = await fh.read(buf, 0, len, start); return buf.subarray(0, bytesRead); }
  finally { await fh.close(); }
}
function parseLines(buf, dropFirst) {
  const lines = buf.toString('utf8').split('\n');
  if (dropFirst) lines.shift();
  const out = [];
  for (const l of lines) { if (!l || l[0] !== '{') continue; try { out.push(JSON.parse(l)); } catch { } }
  return out;
}
const UUIDRE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
function cleanText(t) {
  if (typeof t !== 'string') return '';
  return t.replace(/<system-reminder>[\s\S]*?<\/system-reminder>/g, '').replace(/<ide_[a-z_]+>[\s\S]*?<\/ide_[a-z_]+>/g, '').trim();
}
function clip(s, n) { s = String(s ?? ''); return s.length > n ? s.slice(0, n) + `\n… (+${s.length - n} caracteres)` : s; }

// ---------- converter registros do jsonl em itens de chat ----------
function toItems(rec) {
  const items = [];
  if (!rec || rec.isSidechain) return items;
  if (rec.type !== 'user' && rec.type !== 'assistant') return items;
  const m = rec.message || {}; const base = { uuid: rec.uuid, ts: rec.timestamp };
  let content = m.content;
  if (typeof content === 'string') content = [{ type: 'text', text: content }];
  if (!Array.isArray(content)) return items;
  content.forEach((c, i) => {
    const id = rec.uuid + ':' + i;
    if (rec.type === 'user') {
      if (c.type === 'text') {
        if (rec.isMeta) return;
        let t = cleanText(c.text);
        if (!t) return;
        const cmd = t.match(/<command-name>([^<]*)<\/command-name>/);
        if (cmd) { const a = (t.match(/<command-args>([\s\S]*?)<\/command-args>/) || [])[1] || ''; t = cmd[1] + ' ' + a.trim(); }
        if (/^<local-command-std(out|err)>/.test(t)) { items.push({ ...base, id, kind: 'system', text: clip(t.replace(/<\/?local-command-std(out|err)>/g, ''), 1500) }); return; }
        if (t.startsWith('[Request interrupted')) { items.push({ ...base, id, kind: 'system', text: 'Interrompido' }); return; }
        items.push({ ...base, id, kind: 'user', text: clip(t, 20000) });
      } else if (c.type === 'image') {
        const src = c.source || {}; let img = null;
        if (src.type === 'base64' && src.data && src.data.length < 4e6) img = `data:${src.media_type || 'image/png'};base64,${src.data}`;
        else if (src.type === 'url' && src.url) img = src.url;
        items.push({ ...base, id, kind: 'user', text: img ? '' : '[imagem anexada]', img });
      } else if (c.type === 'document') items.push({ ...base, id, kind: 'user', text: '[documento anexado]' });
      else if (c.type === 'tool_result') {
        let r = c.content;
        if (Array.isArray(r)) r = r.map(x => x.type === 'text' ? x.text : '[' + x.type + ']').join('\n');
        items.push({ ...base, id, kind: 'tool_result', toolId: c.tool_use_id, error: !!c.is_error, text: clip(cleanText(String(r ?? '')), 3000) });
      }
    } else {
      if (c.type === 'text' && c.text && c.text.trim()) items.push({ ...base, id, kind: 'assistant', model: m.model, text: clip(c.text, 30000) });
      else if (c.type === 'thinking' && c.thinking && c.thinking.trim()) items.push({ ...base, id, kind: 'thinking', text: clip(c.thinking, 12000) });
      else if (c.type === 'tool_use') {
        const it = { ...base, id, kind: 'tool', toolId: c.id, name: c.name, input: clip(JSON.stringify(c.input, null, 1), 3000), summary: toolSummary(c.name, c.input) };
        const inp = c.input || {};
        if (c.name === 'TodoWrite' && Array.isArray(inp.todos)) it.todos = inp.todos.map(t => ({ c: t.content, s: t.status, a: t.activeForm }));
        if (c.name === 'Edit') it.diff = { file: inp.file_path, old: clip(inp.old_string, 4000), new: clip(inp.new_string, 4000) };
        if (c.name === 'Write') it.diff = { file: inp.file_path, old: '', new: clip(inp.content, 4000) };
        if (c.name === 'Bash') it.cmd = clip(inp.command, 4000);
        if (c.name === 'AskUserQuestion' && Array.isArray(inp.questions)) it.questions = inp.questions.map(q => ({ q: q.question, o: (q.options || []).map(o => o.label) }));
        items.push(it);
      }
    }
  });
  return items;
}
function toolSummary(name, inp) {
  inp = inp || {};
  const v = inp.description || inp.command || inp.file_path || inp.pattern || inp.url || inp.query || inp.prompt || inp.skill || inp.subject || '';
  return String(v).replace(/\s+/g, ' ').slice(0, 140);
}

// ---------- índice de sessões ----------
let index = new Map(); // id -> meta
const indexFile = path.join(DATA, 'index-cache.json');
try { for (const m of JSON.parse(fs.readFileSync(indexFile, 'utf8'))) index.set(m.id, m); } catch { }

async function scanSession(file, st, id, projDir) {
  const head = parseLines(await readRange(file, 0, Math.min(st.size, 200000)), false);
  const tailStart = Math.max(0, st.size - 400000);
  const tail = st.size <= 200000 ? head : parseLines(await readRange(file, tailStart, st.size - tailStart), tailStart > 0);
  const meta = { id, file, project: projDir, mtime: st.mtimeMs, size: st.size, cwd: null, title: null, aiTitle: null, firstPrompt: null, lastText: null, lastRole: null, model: null, created: null, entrypoint: null, lastTool: null, lastThought: null, todos: null, question: null, lastKind: null, ctx: null, compactedAt: null };
  for (const r of head) {
    if (!meta.cwd && r.cwd) meta.cwd = r.cwd;
    if (!meta.created && r.timestamp) meta.created = r.timestamp;
    if (!meta.entrypoint && r.entrypoint) meta.entrypoint = r.entrypoint;
    if (!meta.firstPrompt && r.type === 'user' && !r.isMeta && !r.isSidechain) {
      const it = toItems(r).find(x => x.kind === 'user'); if (it) meta.firstPrompt = it.text.slice(0, 300);
    }
  }
  for (const r of [...head, ...tail]) {
    if (r.type === 'ai-title' && r.aiTitle) meta.aiTitle = r.aiTitle;
    if ((r.type === 'custom-title' || r.type === 'session-name') && (r.customTitle || r.title || r.name)) meta.title = r.customTitle || r.title || r.name;
    if (r.type === 'summary' && r.summary && !meta.aiTitle) meta.aiTitle = r.summary;
    if (!meta.cwd && r.cwd) meta.cwd = r.cwd;
  }
  for (let i = tail.length - 1; i >= 0; i--) {
    const r = tail[i]; if (r.isSidechain) continue;
    if (!meta.model && r.type === 'assistant' && r.message && r.message.model && r.message.model !== '<synthetic>') meta.model = r.message.model;
    if (!meta.lastText) { const its = toItems(r).filter(x => x.kind === 'assistant' || x.kind === 'user'); if (its.length) { const it = its[its.length - 1]; meta.lastText = it.text.slice(0, 260); meta.lastRole = it.kind; } }
    if (!meta.lastTool && r.type === 'assistant') { const t = toItems(r).filter(x => x.kind === 'tool').pop(); if (t) meta.lastTool = t.name + (t.summary ? ': ' + t.summary : ''); }
    if (!meta.lastKind) { const its = toItems(r).filter(x => x.kind !== 'system'); if (its.length) { const it = its[its.length - 1]; meta.lastKind = it.kind; if (it.kind === 'tool' && it.name === 'AskUserQuestion' && it.questions) meta.question = it.questions.map(q => q.q).join(' / ').slice(0, 300); } }
    // contexto REAL = o que a última chamada ao modelo leu (não a soma dos passos); compactação zera
    if (meta.ctx == null && r.type === 'system' && r.subtype === 'compact_boundary') { meta.ctx = 0; meta.compactedAt = r.timestamp || null; }
    if (meta.ctx == null && r.type === 'assistant' && r.message && r.message.usage && r.message.model !== '<synthetic>') { const u = r.message.usage; meta.ctx = (u.input_tokens || 0) + (u.cache_read_input_tokens || 0) + (u.cache_creation_input_tokens || 0); }
    if (!meta.lastThought && r.type === 'assistant') { const t = toItems(r).filter(x => x.kind === 'thinking').pop(); if (t) meta.lastThought = t.text.slice(-300); }
    if (!meta.todos && r.type === 'assistant') { const t = toItems(r).filter(x => x.todos).pop(); if (t) meta.todos = t.todos; }
  }
  return meta;
}

let scanning = false;
async function refreshIndex() {
  if (scanning) return false; scanning = true; let changed = false;
  try {
    const seen = new Set();
    for (const d of await fsp.readdir(PROJECTS, { withFileTypes: true })) {
      if (!d.isDirectory()) continue;
      const pdir = path.join(PROJECTS, d.name);
      let files; try { files = await fsp.readdir(pdir); } catch { continue; }
      for (const f of files) {
        if (!f.endsWith('.jsonl')) continue;
        const id = f.slice(0, -6); if (!UUIDRE.test(id)) continue;
        const file = path.join(pdir, f); let st; try { st = await fsp.stat(file); } catch { continue; }
        seen.add(id);
        const old = index.get(id);
        if (old && old.mtime === st.mtimeMs && old.size === st.size && old.file === file) continue;
        try { const m = await scanSession(file, st, id, d.name); if (m.firstPrompt || m.lastText) { index.set(id, m); changed = true; } } catch (e) { console.error('scan', file, e.message); }
      }
    }
    for (const id of [...index.keys()]) if (!seen.has(id)) { index.delete(id); changed = true; }
    if (changed) fs.writeFile(indexFile, JSON.stringify([...index.values()]), () => { });
  } finally { scanning = false; }
  return changed;
}

// ---------- quadro (layout) ----------
const boardFile = path.join(DATA, 'board.json');
let board = { cards: {}, frames: [], links: [], names: {}, prefs: {}, notes: [], init: false };
try { board = { ...board, ...JSON.parse(fs.readFileSync(boardFile, 'utf8')) }; } catch { }
let boardTimer = null;
function saveBoard() { clearTimeout(boardTimer); boardTimer = setTimeout(() => fs.writeFile(boardFile + '.tmp', JSON.stringify(board), e => { if (!e) fs.rename(boardFile + '.tmp', boardFile, () => { }); }), 400); }

// ---------- execuções ----------
const runs = new Map(); // sessionId -> run (processo que ESTE node iniciou)
const queues = new Map(); // sessionId -> [{text, attachments, model, effort, permission, at}] mensagens enfileiradas
const QUEUES_FILE = path.join(DATA, 'queues.json'); // fila salva em disco: sobrevive a reiniciar o painel
try { for (const [k, v] of Object.entries(JSON.parse(fs.readFileSync(QUEUES_FILE, 'utf8')))) if (Array.isArray(v) && v.length) queues.set(k, v); } catch { }
function saveQueues() { const o = {}; for (const [k, v] of queues) if (v.length) o[k] = v; fs.writeFile(QUEUES_FILE + '.tmp', JSON.stringify(o), e => { if (!e) fs.rename(QUEUES_FILE + '.tmp', QUEUES_FILE, () => { }); }); }
const sessionCwd = new Map(); // sessionId -> cwd do último run (pra enfileirar antes do índice atualizar)

// ---------- uso / limites ----------
const USAGE_LOG = path.join(DATA, 'usage.jsonl');
let rateLimit = null; // { fiveHour:{util,resetsAt}, sevenDay:{util,resetsAt}, overage, at }
try { rateLimit = JSON.parse(fs.readFileSync(path.join(DATA, 'ratelimit.json'), 'utf8')); } catch { }
// Evento do stream: só pede uma atualização da fonte oficial (evita duas fontes com escalas diferentes).
let pollSoonT = null;
function updateRateLimit() { clearTimeout(pollSoonT); pollSoonT = setTimeout(pollOfficialUsage, 4000); }

// Fonte oficial = a mesma do /usage do Claude Code (GET /api/oauth/usage). Não gasta token.
// Cobre TUDO da conta (extensão, painel, chat, cowork), não só o que o painel disparou.
function readOAuthToken() {
  try { return JSON.parse(fs.readFileSync(path.join(HOME, '.claude', '.credentials.json'), 'utf8')).claudeAiOauth.accessToken; } catch { }
  if (process.platform === 'darwin') { try { return JSON.parse(require('child_process').execSync('security find-generic-password -s "Claude Code-credentials" -w', { stdio: ['ignore', 'pipe', 'ignore'], timeout: 5000 }).toString()).claudeAiOauth.accessToken; } catch { } }
  return null;
}
function claudeAccount() {
  let oa = {}; try { oa = JSON.parse(fs.readFileSync(path.join(HOME, '.claude.json'), 'utf8')).oauthAccount || {}; } catch { }
  const bin = claudeBin(); const tok = readOAuthToken();
  return { installed: !!bin, bin, loggedIn: !!tok, email: oa.emailAddress || null, name: oa.displayName || oa.fullName || null, org: oa.organizationName || null, plan: oa.seatTier || oa.billingType || null };
}
// ---------- atualização automática (Mac) ----------
// CB_UPDATE_URL aponta pro latest.json publicado na VPS: {version, url, sha256}. Baixa, confere sha256,
// extrai em app.new, troca as pastas e sai: o launchd (KeepAlive) sobe a versão nova. Dados ficam em CB_DATA.
const UPDATE_URL = process.env.CB_UPDATE_URL || '';
const update = { current: VERSION, latest: null, checkedAt: 0, state: 'idle', error: null };
function verNum(v) { return String(v || '0').split(/[.\-]/).map(n => parseInt(n, 10) || 0); }
function newer(a, b) { const x = verNum(a), y = verNum(b); for (let i = 0; i < Math.max(x.length, y.length); i++) { if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) > (y[i] || 0); } return false; }
async function checkUpdate(apply) {
  if (!LOCAL || !UPDATE_URL || update.state === 'installing') return update;
  try {
    const r = await fetch(UPDATE_URL + '?t=' + Date.now(), { signal: AbortSignal.timeout(15000) }); if (!r.ok) throw new Error('HTTP ' + r.status);
    const info = await r.json(); update.latest = info.version; update.checkedAt = Date.now(); update.error = null;
    if (!newer(info.version, VERSION)) { update.state = 'idle'; return update; }
    update.state = 'available';
    if (apply && !runs.size) await installUpdate(info);   // nunca troca no meio de uma resposta rodando
  } catch (e) { update.error = e.message; }
  return update;
}
async function installUpdate(info) {
  update.state = 'installing'; broadcast('update', update);
  try {
    const cp = require('child_process'); const tmp = path.join(os.tmpdir(), 'cb-update-' + Date.now()); fs.mkdirSync(tmp, { recursive: true });
    const buf = Buffer.from(await (await fetch(info.url, { signal: AbortSignal.timeout(120000) })).arrayBuffer());
    const sum = crypto.createHash('sha256').update(buf).digest('hex');
    if (sum !== info.sha256) throw new Error('arquivo baixado não confere (sha256), atualização cancelada');
    fs.writeFileSync(path.join(tmp, 'app.tgz'), buf);
    const appNew = ROOT + '.new', appOld = ROOT + '.old';
    fs.rmSync(appNew, { recursive: true, force: true }); fs.mkdirSync(appNew, { recursive: true });
    cp.execFileSync('tar', ['-xzf', path.join(tmp, 'app.tgz'), '-C', appNew]);
    if (!fs.existsSync(path.join(appNew, 'server.js'))) throw new Error('pacote sem server.js');
    try { process.chdir(os.homedir()); } catch { } // Windows não deixa renomear a pasta em uso
    fs.rmSync(appOld, { recursive: true, force: true }); fs.renameSync(ROOT, appOld); fs.renameSync(appNew, ROOT);
    fs.rmSync(tmp, { recursive: true, force: true });
    update.state = 'restarting'; broadcast('update', update);
    setTimeout(() => process.exit(0), 800);   // launchd (Mac) ou o run.cmd (Windows) reinicia já na versão nova
  } catch (e) { update.state = 'error'; update.error = e.message; broadcast('update', update); }
}
if (LOCAL && UPDATE_URL) { setTimeout(() => checkUpdate(true), 20000); setInterval(() => checkUpdate(true), 6 * 3600e3); }
let cliInstall = { state: 'idle', log: '' };
function installClaudeCli() {
  if (cliInstall.state === 'running') return;
  cliInstall = { state: 'running', log: '' };
  const c = WIN ? spawn('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', 'irm https://claude.ai/install.ps1 | iex'], { env: cleanEnv(), stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true })
    : spawn('/bin/bash', ['-lc', 'curl -fsSL https://claude.ai/install.sh | bash'], { env: cleanEnv(), stdio: ['ignore', 'pipe', 'pipe'] });
  const add = d => { cliInstall.log = (cliInstall.log + d).slice(-4000); };
  c.stdout.on('data', add); c.stderr.on('data', add);
  c.on('exit', code => { cliInstall.state = code === 0 && claudeBin() ? 'done' : 'error'; broadcast('account', claudeAccount()); catalogCache.clear(); });
}
let usagePolling = false, usageNextOk = 0, usage429 = 0;
async function pollOfficialUsage() {
  if (usagePolling || Date.now() < usageNextOk) return; // throttle: evita 429
  usagePolling = true; usageNextOk = Date.now() + 30000;
  try {
    const tok = readOAuthToken(); if (!tok) throw new Error('sem credencial');
    const r = await fetch('https://api.anthropic.com/api/oauth/usage', { headers: { Authorization: 'Bearer ' + tok, 'anthropic-beta': 'oauth-2025-04-20', 'User-Agent': 'claude-board' }, signal: AbortSignal.timeout(15000) });
    // 429 = a Anthropic pediu pra ir mais devagar: respeita retry-after e dobra a espera (5, 10, 20, 30 min) em vez de insistir e manter o bloqueio
    if (r.status === 429) { usage429++; const ra = +r.headers.get('retry-after') || 0; usageNextOk = Date.now() + Math.max(ra * 1000, Math.min(30, 5 * 2 ** (usage429 - 1)) * 60000); throw Object.assign(new Error('HTTP 429'), { soft: true }); }
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const d = await r.json(); usage429 = 0; usageNextOk = Date.now() + 2.5 * 60000; // consulta normal a cada ~3 min
    const win = w => w ? { util: w.utilization == null ? null : w.utilization / 100, resetsAt: w.resets_at ? Date.parse(w.resets_at) : null } : null;
    rateLimit = {
      source: 'oficial', at: Date.now(), error: null,
      fiveHour: win(d.five_hour), sevenDay: win(d.seven_day),
      scoped: (d.limits || []).filter(l => l.kind === 'weekly_scoped').map(l => ({ name: (l.scope && l.scope.model && l.scope.model.display_name) || 'modelo', util: l.percent / 100, resetsAt: l.resets_at ? Date.parse(l.resets_at) : null })),
      breakdown: d.seven_day_breakdown ? (d.seven_day_breakdown.rows || []).map(x => ({ name: x.display_name, percent: x.percent })) : [],
      extraEnabled: !!(d.extra_usage && d.extra_usage.is_enabled),
    };
    fs.writeFile(path.join(DATA, 'ratelimit.json'), JSON.stringify(rateLimit), () => { });
  } catch (e) {
    // 429 é só "espera um pouco": não mostra como erro se o último valor ainda é recente (< 10 min)
    const recent = rateLimit && rateLimit.at && Date.now() - rateLimit.at < 10 * 60000;
    if (rateLimit) rateLimit.error = (e.soft && recent) ? null : e.message; else rateLimit = { error: e.message, at: 0 };
  } finally { usagePolling = false; broadcast('usage', { rateLimit }); }
}
setInterval(pollOfficialUsage, 60000);
setTimeout(pollOfficialUsage, 1500);
function logUsage(id, model, tokens, extra) {
  const rec = { t: Date.now(), id, model, in: tokens.in || 0, out: tokens.out || 0, cacheRead: tokens.cacheRead || 0, cost: extra.cost || 0, dur: extra.dur || 0 };
  fs.appendFile(USAGE_LOG, JSON.stringify(rec) + '\n', () => { });
}
function readUsage() {
  let lines = []; try { lines = fs.readFileSync(USAGE_LOG, 'utf8').trim().split('\n'); } catch { return []; }
  const out = []; for (const l of lines) { if (!l) continue; try { out.push(JSON.parse(l)); } catch { } }
  return out;
}
function usageSummary() {
  const recs = readUsage(); const now = Date.now();
  const dayMs = 864e5; const since = { today: new Date().setHours(0, 0, 0, 0), d7: now - 7 * dayMs, d30: now - 30 * dayMs };
  const sum = (from) => recs.filter(r => r.t >= from).reduce((a, r) => { a.in += r.in; a.out += r.out; a.cost += r.cost; a.runs++; return a; }, { in: 0, out: 0, cost: 0, runs: 0 });
  // por hora, últimas 24h
  const hours = Array.from({ length: 24 }, (_, i) => ({ h: i, in: 0, out: 0 }));
  const h0 = now - 24 * 36e5;
  for (const r of recs) if (r.t >= h0) { const idx = Math.floor((r.t - h0) / 36e5); if (hours[idx]) { hours[idx].in += r.in; hours[idx].out += r.out; } }
  // por dia, últimos 14
  const days = Array.from({ length: 14 }, (_, i) => { const d = new Date(now - (13 - i) * dayMs); d.setHours(0, 0, 0, 0); return { d: d.getTime(), in: 0, out: 0, cost: 0 }; });
  for (const r of recs) { const d = new Date(r.t); d.setHours(0, 0, 0, 0); const slot = days.find(x => x.d === d.getTime()); if (slot) { slot.in += r.in; slot.out += r.out; slot.cost += r.cost; } }
  // por conversa (top 8 nos últimos 30d)
  const byConv = {}; for (const r of recs) if (r.t >= since.d30) { const c = byConv[r.id] = byConv[r.id] || { id: r.id, in: 0, out: 0, cost: 0, runs: 0 }; c.in += r.in; c.out += r.out; c.cost += r.cost; c.runs++; }
  const top = Object.values(byConv).sort((a, b) => (b.in + b.out) - (a.in + a.out)).slice(0, 8).map(c => ({ ...c, title: (index.get(c.id) || {}).aiTitle || names(c.id) || c.id.slice(0, 8) }));
  return { rateLimit, today: sum(since.today), d7: sum(since.d7), d30: sum(since.d30), hours, days, top };
}
function names(id) { return board.names[id]; }

// ---------- catálogo do Claude Code: comandos, skills, agentes, MCP, plugins (igual à extensão) ----------
// Sobe `claude -p --no-session-persistence`, lê o anúncio de inicialização (init + commands_changed)
// e mata o processo ANTES da chamada ao modelo: custo zero, nenhuma conversa gravada.
const catalogCache = new Map(); // cwd -> {at, data}
function catalogFrom(init, cmds) {
  return {
    at: Date.now(), version: init.claude_code_version, model: init.model, outputStyle: init.output_style,
    permissionMode: init.permissionMode, skills: init.skills || [], agents: init.agents || [], mcp: init.mcp_servers || [],
    plugins: (init.plugins || []).map(p => ({ name: p.name, version: p.version, source: p.source })),
    memory: init.memory_paths || {}, terminalOnly: init.terminal_slash_commands || [],
    commands: (cmds || (init.slash_commands || []).map(n => ({ name: n }))).map(c => ({ name: c.name, desc: c.description || '', hint: c.argumentHint || '' })),
  };
}
function probeCatalog(cwd) {
  return new Promise(resolve => {
    if (!cwd || !fs.existsSync(cwd)) cwd = HOME;
    const bin = claudeBin(); if (!bin) return resolve(null);
    const child = spawn(bin, ['-p', '--no-session-persistence', '--output-format', 'stream-json', '--verbose', '--model', 'haiku', '--permission-mode', 'bypassPermissions'], { cwd, env: cleanEnv(), stdio: ['pipe', 'pipe', 'ignore'] });
    let buf = '', init = null, done = false;
    const finish = cmds => { if (done) return; done = true; try { child.kill('SIGKILL'); } catch { } resolve(init ? catalogFrom(init, cmds) : null); };
    const timer = setTimeout(() => finish(null), 25000);
    child.stdout.on('data', d => {
      buf += d; let i;
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i); buf = buf.slice(i + 1); let ev; try { ev = JSON.parse(line); } catch { continue; }
        if (ev.type === 'system' && ev.subtype === 'init') { init = ev; setTimeout(() => finish(null), 2500); }
        else if (ev.type === 'system' && ev.subtype === 'commands_changed') { clearTimeout(timer); finish(ev.commands); }
        else if (ev.type === 'stream_event' || ev.type === 'assistant') { clearTimeout(timer); finish(null); }
      }
    });
    child.on('error', () => finish(null));
    child.stdin.on('error', () => { }); child.stdin.end('.');
  });
}
async function getCatalog(cwd, force) {
  cwd = cwd && fs.existsSync(cwd) ? cwd : HOME;
  const c = catalogCache.get(cwd);
  if (!force && c && Date.now() - c.at < 10 * 60000) return c.data;
  const data = await probeCatalog(cwd);
  if (data) catalogCache.set(cwd, { at: Date.now(), data });
  return data || (c && c.data) || null;
}

// ---------- configurações do Claude Code (~/.claude/settings.json), com backup antes de salvar ----------
const SETTINGS_FILE = path.join(HOME, '.claude', 'settings.json');
const SETTINGS_BK = path.join(DATA, 'settings-backups');
function readSettings() { try { return fs.readFileSync(SETTINGS_FILE, 'utf8'); } catch { return '{}'; } }
function writeSettings(text) {
  const obj = JSON.parse(text); // lança se o JSON estiver inválido
  if (typeof obj !== 'object' || Array.isArray(obj) || !obj) throw new Error('o arquivo precisa ser um objeto JSON { }');
  fs.mkdirSync(SETTINGS_BK, { recursive: true });
  fs.writeFileSync(path.join(SETTINGS_BK, 'settings-' + new Date().toISOString().replace(/[:.]/g, '-') + '.json'), readSettings());
  fs.writeFileSync(SETTINGS_FILE + '.tmp', JSON.stringify(obj, null, 2) + '\n'); fs.renameSync(SETTINGS_FILE + '.tmp', SETTINGS_FILE);
  catalogCache.clear();
  return obj;
}

// ---------- saúde da VPS ----------
function readProc(f) { try { return fs.readFileSync(f, 'utf8'); } catch { return ''; } }
function cpuSnapshot() { const line = readProc('/proc/stat').split('\n')[0]; const p = line.split(/\s+/).slice(1).map(Number); const idle = p[3] + (p[4] || 0); const total = p.reduce((a, b) => a + b, 0); return { idle, total }; }
async function vpsHealth() {
  const a = cpuSnapshot(); await new Promise(r => setTimeout(r, 150)); const b = cpuSnapshot();
  const dt = b.total - a.total, di = b.idle - a.idle; const cpu = dt > 0 ? Math.max(0, Math.min(100, Math.round((1 - di / dt) * 100))) : 0;
  const mem = {}; for (const l of readProc('/proc/meminfo').split('\n')) { const m = l.match(/^(\w+):\s+(\d+)/); if (m) mem[m[1]] = +m[2] * 1024; }
  const memTotal = mem.MemTotal || 0, memAvail = mem.MemAvailable || 0; const memUsed = memTotal - memAvail;
  const up = parseFloat(readProc('/proc/uptime').split(' ')[0]) || 0;
  const load = readProc('/proc/loadavg').split(' ').slice(0, 3).map(Number);
  const ncpu = (readProc('/proc/cpuinfo').match(/^processor/gm) || []).length || 1;
  let disk = { total: 0, used: 0 };
  // disco FÍSICO (o que o provedor entregou) x partição em uso: detecta espaço comprado e não alocado
  let phys = null;
  try {
    const cp = require('child_process');
    const src = cp.execSync('findmnt -n -o SOURCE /').toString().trim();
    const parent = cp.execSync('lsblk -no PKNAME ' + src).toString().trim().split('\n')[0];
    if (parent) {
      const diskSize = +cp.execSync('lsblk -b -dn -o SIZE /dev/' + parent).toString().trim();
      const parts = cp.execSync('lsblk -b -n -o SIZE,TYPE /dev/' + parent).toString().trim().split('\n').map(l => l.trim().split(/\s+/)).filter(x => x[1] === 'part').reduce((a, x) => a + (+x[0]), 0);
      const partSize = +cp.execSync('lsblk -b -dn -o SIZE ' + src).toString().trim();
      phys = { device: '/dev/' + parent, partition: src, size: diskSize, partSize, unallocated: Math.max(0, diskSize - parts) };
    }
  } catch { }
  try { const o = require('child_process').execSync('df -kP / | tail -1').toString().split(/\s+/); disk = { total: +o[1] * 1024, used: +o[2] * 1024, avail: +o[3] * 1024 }; } catch { }
  const services = [];
  for (const s of (process.env.CB_SERVICES || 'claude-board').split(',').map(x => x.trim()).filter(Boolean)) { try { const st = require('child_process').execSync('systemctl is-active ' + s + ' 2>/dev/null || true').toString().trim(); services.push({ name: s, active: st }); } catch { services.push({ name: s, active: '?' }); } }
  let docker = [];
  try { docker = require('child_process').execSync("docker ps --format '{{.Names}}\t{{.Status}}' 2>/dev/null || true").toString().trim().split('\n').filter(Boolean).map(l => { const [name, ...st] = l.split('\t'); return { name, status: st.join(' ') }; }); } catch { }
  let ips = [];
  try { ips = require('child_process').execSync('hostname -I 2>/dev/null || true').toString().trim().split(/\s+/).filter(x => x.includes('.')); } catch { }
  return { at: Date.now(), cpu, ncpu, load, mem: { total: memTotal, used: memUsed, avail: memAvail }, disk, phys, uptime: up, services, docker, ips, host: require('os').hostname() };
}

// ---------- explorador de arquivos (somente leitura) ----------
const TEXT_EXT = new Set(['txt', 'md', 'js', 'ts', 'py', 'json', 'sh', 'css', 'html', 'yml', 'yaml', 'conf', 'log', 'env', 'csv', 'sql', 'xml', 'ini', 'toml', 'service', 'jsonl', 'mjs', 'cjs', 'tsx', 'jsx', 'php', 'rb', 'go', 'rs', 'c', 'cpp', 'h', 'java', 'gitignore', 'dockerfile', 'lock', 'cfg', 'properties', 'bashrc', 'profile']);
function withTimeout(promise, ms) { return Promise.race([promise, new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), ms))]); }
async function listDir(dir) {
  dir = path.resolve(dir || HOME);
  let names; try { names = await withTimeout(fsp.readdir(dir), 3000); } catch (e) { throw Object.assign(new Error('não deu pra abrir: ' + (e.code || e.message)), { code: 400 }); }
  const out = await Promise.all(names.map(async name => {
    const full = path.join(dir, name);
    // lstat com timeout curto: montagens mortas (sshfs Mac/PC) travam — aí marca como "?"
    let st = null, hung = false, link = false;
    try { st = await withTimeout(fsp.lstat(full), 400); link = st.isSymbolicLink(); } catch { hung = true; }
    return { name, dir: st ? st.isDirectory() : true, size: st ? st.size : 0, mtime: st ? st.mtimeMs : 0, link, hung };
  }));
  out.sort((a, b) => (b.dir - a.dir) || a.name.localeCompare(b.name));
  return { path: dir, parent: dir === '/' ? null : path.dirname(dir), entries: out };
}
async function readFileSafe(f) {
  f = path.resolve(f); let st; try { st = await fsp.stat(f); } catch (e) { throw Object.assign(new Error('não achei'), { code: 404 }); }
  if (st.isDirectory()) throw Object.assign(new Error('é uma pasta'), { code: 400 });
  const ext = (f.split('.').pop() || '').toLowerCase(); const base = path.basename(f).toLowerCase();
  const isImg = IMG_MIME[ext];
  if (isImg) return { path: f, kind: 'image', size: st.size, url: '/api/fileraw?path=' + encodeURIComponent(f) };
  if (st.size > 2e6) return { path: f, kind: 'toobig', size: st.size };
  const buf = await fsp.readFile(f);
  // heurística binário: bytes nulos
  if (buf.includes(0) && !TEXT_EXT.has(ext)) return { path: f, kind: 'binary', size: st.size };
  return { path: f, kind: 'text', size: st.size, mtime: st.mtimeMs, content: buf.toString('utf8').slice(0, 400000), truncated: buf.length > 400000 };
}

// ---------- skills ativas x desativadas (desativar = mover pra ~/.claude/skills-desativadas, reversível) ----------
const SKILLS_ON = path.join(HOME, '.claude', 'skills'), SKILLS_OFF = path.join(HOME, '.claude', 'skills-desativadas');
const SKILL_GROUPS = [
  ['Vídeo e edição', /^(hyperframes|remotion|add-zooms|beat-sync|find-broll|talking-head|shot-composition|faceless|general-video|media-use|estudio-video|watch|ffmpeg|review-animations)/],
  ['Animação e motion', /^(gsap|motion|kinetic|logo-animation|animation-vocabulary|genjutsu)/],
  ['3D e Three.js', /^threejs/],
  ['Impressão 3D e CAD', /^(3d-|bambu|cad$|dfam|parametric)/],
  ['Automação n8n', /^n8n/],
  ['Design e front-end', /^(frontend|design-dna|extension-dev)/],
  ['Imagem e anúncios', /^(nano-banana|image|ads?-)/],
  ['Texto e escrita', /^(humaniz)/],
  ['Navegador', /^playwright/],
  ['Rotina e memória', /^(briefing|fechamento|historico|graphify|caching|synced)/],
];
function skillGroup(n) { for (const [g, re] of SKILL_GROUPS) if (re.test(n)) return g; return 'Outras'; }
function skillDesc(md) {
  let t = ''; try { t = fs.readFileSync(md, 'utf8').slice(0, 6000); } catch { return ''; }
  const fm = (t.match(/^---\n([\s\S]*?)\n---/) || [])[1] || t;
  const m = fm.match(/^description:[ \t]*(.*)$/m); if (!m) return '';
  let v = m[1].trim();
  if (/^[>|][-+]?$/.test(v) || v === '') { const rest = fm.slice(m.index + m[0].length).split('\n'); const L = []; for (const l of rest) { if (/^\s+\S/.test(l) || l === '') L.push(l.trim()); else break; } v = L.join(' ').trim(); }
  return v.replace(/^["']|["']$/g, '').replace(/\s+/g, ' ').slice(0, 180);
}
function listSkillDirs() {
  const out = [];
  for (const [dir, active] of [[SKILLS_ON, true], [SKILLS_OFF, false]]) {
    let entries; try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { continue; }
    for (const e of entries) {
      if (!e.isDirectory() || e.name === 'synced') continue;
      out.push({ name: e.name, desc: skillDesc(path.join(dir, e.name, 'SKILL.md')), active, group: skillGroup(e.name) });
    }
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}
function toggleSkill(name, active) {
  if (!/^[\w.-]+$/.test(name) || name === 'synced') throw new Error('nome inválido');
  const from = path.join(active ? SKILLS_OFF : SKILLS_ON, name), to = path.join(active ? SKILLS_ON : SKILLS_OFF, name);
  if (!fs.existsSync(from)) throw new Error('skill não encontrada');
  if (fs.existsSync(to)) throw new Error('já existe no destino');
  fs.mkdirSync(path.dirname(to), { recursive: true }); fs.renameSync(from, to);
  commandsCache = null; catalogCache.clear();
}

// ---------- voz: transcrição oficial do Claude (o mesmo serviço do microfone do Claude Code), com o login da conta ----------
// Recebe PCM 16 bit, 16 kHz, mono (o navegador converte) e devolve o texto. Nada é gravado em disco.
const STT_TERMS = process.env.CB_STT_TERMS || 'Claude,Claude Code,Opus,Sonnet,Haiku,Fable,VPS'; // nomes próprios da sua empresa: CB_STT_TERMS no .env
function transcribePcm(pcm, lang) {
  let WS; try { WS = require(path.join(__dirname, 'vendor', 'ws')); } catch (e) { return Promise.reject(new Error('módulo de voz ausente')); }
  const tok = readOAuthToken(); if (!tok) return Promise.reject(new Error('sem login do Claude'));
  const q = new URLSearchParams({ encoding: 'linear16', sample_rate: '16000', channels: '1', endpointing_ms: '300', utterance_end_ms: '1000', language: lang || 'pt', use_conversation_engine: 'true' });
  return new Promise((ok, bad) => {
    const s = new WS('wss://api.anthropic.com/api/ws/speech_to_text/voice_stream?' + q, { headers: { Authorization: 'Bearer ' + tok, 'User-Agent': 'claude-cli/2.1.304 (external, cli)', 'x-app': 'cli', 'x-config-keyterms': STT_TERMS } });
    const finals = []; let last = '', err = null, done = false;
    const end = () => { if (done) return; done = true; clearTimeout(guard); if (last) finals.push(last); const t = finals.join(' ').replace(/\s+/g, ' ').trim(); if (t || !err) ok(t); else bad(new Error(err)); };
    const guard = setTimeout(() => { err = err || 'tempo esgotado'; try { s.terminate(); } catch { } end(); }, 60000 + pcm.length / 32000 * 400);
    s.on('unexpected-response', (r, res) => { err = 'HTTP ' + res.statusCode + (res.statusCode === 401 ? ' (login do Claude expirou: mande qualquer mensagem e tente de novo)' : ''); end(); });
    s.on('error', e => { err = err || e.message; end(); });
    s.on('open', () => {
      s.send('{"type":"KeepAlive"}'); let i = 0; const step = 3200; // 100 ms de áudio a cada 20 ms (5x o tempo real)
      (function pump() { if (s.readyState !== 1) return; if (i >= pcm.length) return s.send('{"type":"CloseStream"}'); s.send(pcm.subarray(i, i + step)); i += step; setTimeout(pump, 20); })();
    });
    s.on('message', m => { let d; try { d = JSON.parse(m.toString()); } catch { return; }
      if (d.type === 'TranscriptText' || d.type === 'TranscriptInterim') last = d.data || last;
      else if (d.type === 'TranscriptEndpoint') { if (last) finals.push(last); last = ''; }
      else if (d.type === 'TranscriptError' || d.type === 'error') err = d.description || d.message || d.error_code || 'erro na transcrição'; });
    s.on('close', end);
  });
}

// Comandos "/" (skills + comandos embutidos) pro menu do composer, igual ao / da extensão.
let commandsCache = null, commandsAt = 0;
function listCommands() {
  if (commandsCache && Date.now() - commandsAt < 60000) return commandsCache;
  const builtin = [
    { name: '/clear', desc: 'Limpar o contexto da conversa' },
    { name: '/compact', desc: 'Resumir e compactar o histórico' },
    { name: '/review', desc: 'Revisar as mudanças atuais' },
    { name: '/init', desc: 'Criar/atualizar CLAUDE.md do projeto' },
  ];
  const skills = [];
  const dirs = [path.join(HOME, '.claude', 'skills'), path.join(HOME, '.claude', 'commands')];
  for (const dir of dirs) {
    let entries; try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { continue; }
    for (const e of entries) {
      if (e.isDirectory()) {
        const md = path.join(dir, e.name, 'SKILL.md');
        let desc = ''; try { desc = (fs.readFileSync(md, 'utf8').match(/description:\s*(.+)/) || [])[1] || ''; } catch { }
        skills.push({ name: '/' + e.name, desc: desc.slice(0, 120) });
      } else if (e.name.endsWith('.md')) {
        skills.push({ name: '/' + e.name.slice(0, -3), desc: '' });
      }
    }
  }
  const seen = new Set(); const all = builtin.concat(skills.sort((a, b) => a.name.localeCompare(b.name)));
  commandsCache = all.filter(c => { if (seen.has(c.name)) return false; seen.add(c.name); return true; });
  commandsAt = Date.now();
  return commandsCache;
}
const lastRuns = new Map(); // sessionId -> summary of last finished run
const liveProcs = new Map(); // sessionId -> {pid, since} (processos claude -p vivos no servidor, mesmo de outro node)
const clients = new Set(); // global SSE
const sessionSubs = new Map(); // sessionId -> Set(res)

// Varre /proc por processos `claude -p ... --resume/--session-id <id>` vivos.
// Serve pra reatachar runs depois de um restart do serviço (KillMode=process deixa os filhos vivos):
// o trabalho continua no servidor e o painel volta a mostrar "rodando" sozinho.
let winProcs = '', winProcsBusy = false;
function refreshWinProcs() {
  if (winProcsBusy) return; winProcsBusy = true;
  require('child_process').execFile('powershell.exe', ['-NoProfile', '-Command', "Get-CimInstance Win32_Process -Filter \"Name like 'claude%'\" | ForEach-Object { \"$($_.ProcessId) $($_.CommandLine)\" }"], { windowsHide: true, timeout: 20000 }, (e, out) => { winProcsBusy = false; if (!e) winProcs = String(out); });
}
if (WIN) { refreshWinProcs(); setInterval(refreshWinProcs, 8000); }
function scanLiveProcs() {
  const found = new Map();
  if (process.platform !== 'linux') { // Mac: ps · Windows: lista que o PowerShell atualiza em segundo plano
    let out = ''; if (WIN) out = winProcs; else try { out = require('child_process').execSync('ps -axww -o pid=,command=', { timeout: 5000 }).toString(); } catch { return false; }
    for (const line of out.split('\n')) {
      const m = line.match(/^\s*(\d+)\s+(.*)$/); if (!m || !/claude/.test(m[2]) || !/\s-p(\s|$)/.test(m[2])) continue;
      const id = (m[2].match(/--(?:resume|session-id)\s+([0-9a-f-]{36})/) || [])[1]; if (!id) continue;
      const prev = liveProcs.get(id); found.set(id, { pid: +m[1], since: prev && prev.pid === +m[1] ? prev.since : Date.now() });
    }
    let changed = found.size !== liveProcs.size; for (const id of found.keys()) if (!liveProcs.has(id)) changed = true;
    liveProcs.clear(); for (const [k, v] of found) liveProcs.set(k, v); return changed;
  }
  let pids; try { pids = fs.readdirSync('/proc').filter(n => /^\d+$/.test(n)); } catch { return; }
  for (const pid of pids) {
    let cmd; try { cmd = fs.readFileSync('/proc/' + pid + '/cmdline', 'utf8'); } catch { continue; }
    if (!cmd.includes('claude') || cmd.indexOf('-p') < 0) continue;
    const parts = cmd.split('\0');
    const i = parts.findIndex(a => a === '--resume' || a === '--session-id');
    if (i < 0 || !UUIDRE.test(parts[i + 1] || '')) continue;
    const id = parts[i + 1];
    const prev = liveProcs.get(id);
    found.set(id, { pid: +pid, since: prev && prev.pid === +pid ? prev.since : Date.now() });
  }
  // detecta mudanças pra avisar as telas
  let changed = found.size !== liveProcs.size;
  for (const id of found.keys()) if (!liveProcs.has(id)) changed = true;
  for (const id of liveProcs.keys()) if (!found.has(id)) changed = true;
  liveProcs.clear(); for (const [k, v] of found) liveProcs.set(k, v);
  return changed;
}
function pidAlive(pid) { if (!pid) return false; try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; } }
function procAlive(id) { const p = liveProcs.get(id); if (!p) return false; if (process.platform !== 'linux') return pidAlive(p.pid); try { fs.accessSync('/proc/' + p.pid); return true; } catch { return false; } }

function broadcast(ev, data) { const s = `event: ${ev}\ndata: ${JSON.stringify(data)}\n\n`; for (const c of clients) c.write(s); }
function sessionEmit(id, ev, data) { const subs = sessionSubs.get(id); if (!subs) return; const s = `event: ${ev}\ndata: ${JSON.stringify(data)}\n\n`; for (const c of subs) c.write(s); }
function runState(id) {
  const r = runs.get(id);
  if (r) return { running: true, startedAt: r.startedAt, tool: r.tool, model: r.model, turns: r.turns, phase: r.phase, thought: r.thought.slice(-280), steps: r.steps.slice(-6), todos: r.todos, tokens: { in: r.tokIn || 0, out: r.tokOut || 0 } };
  if (procAlive(id)) return { running: true, external: true, startedAt: liveProcs.get(id).since, phase: 'rodando no servidor' };
  const l = lastRuns.get(id); return l ? { running: false, ...l } : { running: false };
}
function statusAll() { const o = {}; for (const id of new Set([...runs.keys(), ...lastRuns.keys(), ...liveProcs.keys()])) o[id] = runState(id); return o; }

const MODELS = { opus: 'claude-opus-5-5', sonnet: 'claude-sonnet-5-5', haiku: 'claude-haiku-5-5', fable: 'claude-fable-5-1' };
// Lista oficial de modelos da conta (GET /v1/models), relida a cada 6 h: modelo novo aparece sozinho no seletor
// e os atalhos opus/sonnet/haiku/fable passam a apontar pro mais novo de cada família.
const MODELS_FILE = path.join(DATA, 'models.json');
let modelList = []; try { modelList = JSON.parse(fs.readFileSync(MODELS_FILE, 'utf8')); } catch { }
function applyModelAliases() {
  for (const fam of ['opus', 'sonnet', 'haiku', 'fable']) { const m = modelList.find(x => x.family === fam); if (m) MODELS[fam] = m.id; }
}
applyModelAliases();
async function refreshModels() {
  try {
    const tok = readOAuthToken(); if (!tok) return;
    const r = await fetch('https://api.anthropic.com/v1/models?limit=100', { headers: { Authorization: 'Bearer ' + tok, 'anthropic-beta': 'oauth-2025-04-20', 'anthropic-version': '2023-06-01', 'User-Agent': 'claude-board' }, signal: AbortSignal.timeout(15000) });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const d = await r.json();
    const list = (d.data || []).map(m => ({ id: m.id, label: (m.display_name || m.id).replace(/^Claude\s+/, ''), family: ((m.id.match(/opus|sonnet|haiku|fable/) || [])[0]) || 'outros', at: Date.parse(m.created_at) || 0 }))
      .sort((a, b) => b.at - a.at);
    if (!list.length) return;
    const changed = JSON.stringify(list.map(x => x.id)) !== JSON.stringify(modelList.map(x => x.id));
    modelList = list; applyModelAliases();
    if (changed) { fs.writeFile(MODELS_FILE, JSON.stringify(list), () => { }); broadcast('models', { models: MODELS, modelList }); }
  } catch (e) { console.error('modelos:', e.message); }
}
setTimeout(refreshModels, 5000); setInterval(refreshModels, 6 * 3600 * 1000);
function cleanEnv() {
  const env = {};
  for (const [k, v] of Object.entries(process.env)) { if (k === 'CLAUDECODE' || k.startsWith('CLAUDE_CODE_') || k === 'CLAUDE_PID' || k === 'CLAUDE_EFFORT' || k.startsWith('BOARD_')) continue; env[k] = v; }
  if (WIN) { const k = Object.keys(env).find(x => x.toUpperCase() === 'PATH') || 'Path'; env[k] = path.join(HOME, '.local', 'bin') + ';' + (env[k] || ''); return env; }
  env.HOME = HOME; env.PATH = HOME + '/.local/bin:/opt/homebrew/bin:' + (env.PATH || '') + ':/usr/local/bin:/usr/bin:/bin:' + HOME + '/bin';
  return env;
}
const IMG_MIME = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp' };
function buildUserMessage(text, attachments) {
  // sem anexo: texto puro (input-format text)
  const content = [];
  const refs = [];
  for (const a of attachments) {
    const ext = (a.name.split('.').pop() || '').toLowerCase();
    if (IMG_MIME[ext]) {
      try { content.push({ type: 'image', source: { type: 'base64', media_type: IMG_MIME[ext], data: fs.readFileSync(a.path).toString('base64') } }); continue; } catch { }
    }
    refs.push(a.path);
  }
  let t = text || '';
  if (refs.length) t += (t ? '\n\n' : '') + 'Arquivos anexados (abra com a ferramenta Read):\n' + refs.map(r => '- ' + r).join('\n');
  content.unshift({ type: 'text', text: t || '(veja os anexos)' });
  return { type: 'user', message: { role: 'user', content } };
}
function startRun({ id, isNew, cwd, text, model, effort, permission, name, attachments }) {
  if (runs.has(id)) throw Object.assign(new Error('Essa conversa já está rodando'), { code: 409 });
  if (procAlive(id)) throw Object.assign(new Error('Essa conversa já está rodando no servidor (talvez em outra aba). Espere terminar.'), { code: 409 });
  if (!cwd || !fs.existsSync(cwd)) cwd = HOME;
  sessionCwd.set(id, cwd);
  attachments = (attachments || []).filter(a => a && a.path && fs.existsSync(a.path));
  const useJson = attachments.length > 0;
  const args = ['-p', '--output-format', 'stream-json', '--verbose', '--include-partial-messages'];
  if (useJson) args.push('--input-format', 'stream-json');
  args.push(isNew ? '--session-id' : '--resume', id);
  if (model && model !== 'default') args.push('--model', MODELS[model] || model);
  if (effort && effort !== 'default') args.push('--effort', effort);
  args.push('--permission-mode', ['default', 'acceptEdits', 'plan', 'bypassPermissions'].includes(permission) ? permission : 'bypassPermissions');
  if (attachments.length) args.push('--add-dir', UPLOADS);
  if (isNew && name) args.push('--name', name.slice(0, 80));
  // Cada conversa roda na SUA PRÓPRIA unidade systemd (cb-<id>.service), em cgroup separado.
  // Assim o trabalho sobrevive a fechar a aba, desligar o PC, e até reiniciar/cair este painel.
  // stdin = arquivo com a mensagem; stdout/err = arquivo de log que o painel tail-eia pro "ao vivo".
  const stamp = Date.now();
  const inFile = path.join(RUNS, id + '.in');
  const logFile = path.join(RUNS, id + '.log');
  fs.writeFileSync(inFile, useJson ? JSON.stringify(buildUserMessage(text, attachments)) + '\n' : (text || ''));
  fs.writeFileSync(logFile, '');
  const unit = 'cb-' + id;
  if (LOCAL) return startRunLocal({ id, args, cwd, inFile, logFile, stamp, model, unit });
  const envPairs = { HOME, PATH: [HOME + '/.local/bin', HOME + '/bin', HOME + '/.npm-global/bin', '/usr/local/bin', '/usr/bin', '/bin'].join(':'), TZ: process.env.TZ || 'America/Sao_Paulo', LANG: process.env.LANG || 'C.UTF-8' };
  const srArgs = ['systemd-run', '--quiet', '--collect', '--unit=' + unit, '-p', 'Type=exec', '-p', 'User=' + os.userInfo().username,
    '-p', 'StandardInput=file:' + inFile, '-p', 'StandardOutput=append:' + logFile, '-p', 'StandardError=append:' + logFile,
    '-p', 'WorkingDirectory=' + cwd];
  for (const [k, v] of Object.entries(envPairs)) srArgs.push('--setenv=' + k + '=' + v);
  srArgs.push(claudeBin() || CLAUDE_BIN, ...args);
  const child = spawn('sudo', srArgs, { stdio: ['ignore', 'ignore', 'pipe'] });
  let launchErr = '';
  child.stderr.on('data', d => { launchErr = (launchErr + d).slice(-500); });
  const run = { unit, pid: null, startedAt: stamp, tool: null, model: model || 'default', turns: 0, phase: 'iniciando', cwd, thought: '', steps: [], todos: null, lastBroadcast: 0, logFile, result: null, grace: Date.now() + 9000 };
  runs.set(id, run);
  fs.writeFile(path.join(RUNS, id + '.meta'), JSON.stringify({ logFile, startedAt: stamp, model: run.model, unit }), () => { });
  child.on('exit', c => { if (c !== 0) { run.launchFailed = launchErr.trim() || ('systemd-run saiu ' + c); } });
  tailRunLog(id, run);
  monitorRun(id, run);
  broadcast('status', { id, state: runState(id) });
  return run;
}
// Mac: processo destacado (sessão própria), stdin = arquivo da mensagem, saída = log. Sobrevive ao Board reiniciar.
function startRunLocal({ id, args, cwd, inFile, logFile, stamp, model, unit }) {
  const bin = claudeBin(); if (!bin) throw Object.assign(new Error('Claude Code não está instalado neste computador. Clique em "Instalar Claude Code" no topo.'), { code: 412 });
  const inp = fs.openSync(inFile, 'r'), out = fs.openSync(logFile, 'a');
  const child = spawn(bin, args, { cwd, env: cleanEnv(), stdio: [inp, out, out], detached: true, windowsHide: true, shell: WIN && /\.cmd$/i.test(bin) });
  fs.closeSync(inp); fs.closeSync(out); child.unref();
  const run = { unit, pid: child.pid, startedAt: stamp, tool: null, model: model || 'default', turns: 0, phase: 'iniciando', cwd, thought: '', steps: [], todos: null, lastBroadcast: 0, logFile, result: null, grace: Date.now() + 9000 };
  child.on('error', e => { run.launchFailed = e.message; });
  runs.set(id, run);
  fs.writeFile(path.join(RUNS, id + '.meta'), JSON.stringify({ logFile, startedAt: stamp, model: run.model, unit, pid: child.pid }), () => { });
  tailRunLog(id, run); monitorRun(id, run); broadcast('status', { id, state: runState(id) });
  return run;
}
function stopRun(id) {
  if (!LOCAL) { spawn('sudo', ['systemctl', 'stop', 'cb-' + id + '.service'], { stdio: 'ignore' }); return; }
  const r = runs.get(id); const pid = (r && r.pid) || (liveProcs.get(id) || {}).pid;
  if (pid) { try { process.kill(pid, 'SIGINT'); } catch { } setTimeout(() => { if (pidAlive(pid)) try { process.kill(pid, 'SIGTERM'); } catch { } }, 4000); }
}
function tailRunLog(id, run, startPos = 0) {
  let pos = startPos, rest = '', busy = false;
  run.tail = setInterval(async () => {
    if (busy) return; busy = true;
    try {
      const st = await fsp.stat(run.logFile).catch(() => null); if (!st) { busy = false; return; }
      if (st.size < pos) { pos = 0; rest = ''; }
      if (st.size <= pos) { busy = false; return; }
      const buf = await readRange(run.logFile, pos, st.size - pos); pos = st.size;
      const txt = rest + buf.toString('utf8'); const lines = txt.split('\n'); rest = lines.pop();
      for (const line of lines) { if (!line.trim()) continue; let ev; try { ev = JSON.parse(line); } catch { continue; } handleEvent(id, run, ev); }
    } catch { } finally { busy = false; }
  }, 500);
}
function monitorRun(id, run) {
  run.mon = setInterval(() => {
    if (run.finished) return clearInterval(run.mon);
    if (run.launchFailed) { run.result = run.result || { is_error: true, result: run.launchFailed }; return finishRun(id, run); }
    const alive = procAlive(id) || (LOCAL ? pidAlive(run.pid) : serviceActive(run.unit));
    if (alive) { run.sawAlive = true; return; }
    if (!run.sawAlive && Date.now() < run.grace) return; // ainda subindo
    // morreu: dá um tempinho pro tail drenar o fim do log, então finaliza
    if (!run.ending) { run.ending = Date.now(); return; }
    if (Date.now() - run.ending > 1500) finishRun(id, run);
  }, 1000);
}
function serviceActive(unit) { try { return require('child_process').execSync('systemctl is-active ' + unit + '.service 2>/dev/null').toString().trim() === 'active'; } catch { return false; } }
function finishRun(id, run) {
  if (run.finished) return; run.finished = true;
  clearInterval(run.tail); clearInterval(run.mon);
  runs.delete(id);
  const err = run.result && run.result.is_error;
  const u = (run.result && run.result.usage) || {};
  const tokens = { in: (u.input_tokens || 0) + (u.cache_creation_input_tokens || 0) + (u.cache_read_input_tokens || 0), out: u.output_tokens || 0, cacheRead: u.cache_read_input_tokens || 0 };
  const sum = { endedAt: Date.now(), startedAt: run.startedAt, ok: run.result ? !err : true, cost: run.result?.total_cost_usd, tokens, duration: run.result?.duration_ms, turns: run.result?.num_turns ?? run.turns, error: err ? (run.result.result || 'erro') : (run.launchFailed || null), model: run.model };
  if (run.result && !run.result.is_error && (run.result.num_turns === 0) && typeof run.result.result === 'string' && run.result.result.trim()) {
    sum.localOut = run.result.result.slice(0, 20000);
    sessionEmit(id, 'items', { items: [{ id: 'local-' + Date.now(), kind: 'local', ts: new Date().toISOString(), text: sum.localOut }] });
  }
  lastRuns.set(id, sum);
  if (tokens.in || tokens.out) logUsage(id, run.model, tokens, { cost: sum.cost, dur: sum.duration });
  fs.unlink(path.join(RUNS, id + '.meta'), () => { });
  sessionEmit(id, 'done', sum); broadcast('status', { id, state: runState(id) });
  setTimeout(() => refreshIndex().then(c => c && broadcast('index', {})), 600);
  setTimeout(() => { fs.unlink(run.logFile, () => { }); }, 60000);
  setTimeout(() => dispatchQueue(id), 1200); // dispara a próxima mensagem enfileirada
}
// ---------- otimização automática de token ----------
// Conversa longa = cada passo do Claude relê o histórico inteiro. Antes de mandar uma mensagem pra uma conversa
// acima do limite, o Board roda /compact com instrução de PRESERVAR o que importa; a mensagem vai logo depois.
const COMPACT_TEXT = '/compact Preserve integralmente: (1) decisões já tomadas e o porquê; (2) pedidos do usuário ainda pendentes ou em andamento, com o estado atual de cada um; (3) caminhos de arquivos, URLs, comandos, IDs e credenciais de referência (nomes, nunca valores secretos); (4) erros encontrados e como foram resolvidos; (5) preferências e regras que o usuário pediu. Resuma o resto de forma curta.';
const lastAutoCompact = new Map();
function optimCfg() { const o = board.optim || {}; return { auto: o.autoCompact !== false, threshold: +o.threshold || 250000 }; }
function needsCompact(id) {
  const o = optimCfg(); if (!o.auto) return false;
  const ctx = (index.get(id) || {}).ctx; if (!ctx || ctx < o.threshold) return false;
  if (Date.now() - (lastAutoCompact.get(id) || 0) < 15 * 60e3) return false; // não compacta 2x seguidas
  return true;
}
function startAutoCompact(id, cwd, msg) {
  const ctx = (index.get(id) || {}).ctx; lastAutoCompact.set(id, Date.now());
  startRun({ id, isNew: false, cwd, text: COMPACT_TEXT, model: msg.model, effort: msg.effort, permission: msg.permission });
  const notice = { text: `Contexto em ${Math.round(ctx / 1000)}k: compactando antes de enviar, pra gastar menos token. Sua mensagem vai logo em seguida.` };
  sessionEmit(id, 'notice', notice); broadcast('notice', { id, ...notice });
}
// Dispara a próxima mensagem da fila, se a conversa não estiver mais rodando.
function dispatchQueue(id) {
  const q = queues.get(id); if (!q || !q.length) return;
  if (runs.has(id) || procAlive(id)) return; // ainda rodando; espera terminar
  const cwd = sessionCwd.get(id) || (index.get(id) || {}).cwd; const msg = q.shift();
  if (needsCompact(id) && !String(msg.text || '').trim().startsWith('/compact')) { q.unshift(msg); queues.set(id, q); emitQueue(id); try { startAutoCompact(id, cwd, msg); } catch (e) { } return; }
  if (!q.length) queues.delete(id);
  emitQueue(id);
  try { startRun({ id, isNew: false, cwd, text: msg.text, model: msg.model, effort: msg.effort, permission: msg.permission, attachments: msg.attachments }); }
  catch (e) { /* ainda rodando por algum motivo: recoloca e tenta depois */ q.unshift(msg); queues.set(id, q); emitQueue(id); setTimeout(() => dispatchQueue(id), 2000); }
}
function emitQueue(id) {
  saveQueues();
  const q = queues.get(id) || [];
  const view = q.map(m => ({ text: (m.text || '').slice(0, 300), n: (m.attachments || []).length, at: m.at }));
  broadcast('queue', { id, queue: view }); sessionEmit(id, 'queue', { queue: view });
}
function queueView(id) { return (queues.get(id) || []).map(m => ({ text: (m.text || '').slice(0, 300), n: (m.attachments || []).length, at: m.at })); }
function handleEvent(id, run, ev) {
  if (ev.type === 'rate_limit_event' && ev.rate_limit_info) { updateRateLimit(ev.rate_limit_info); }
  if (ev.type === 'system' && ev.subtype === 'status' && ev.status === 'compacting') { run.phase = 'compactando'; run.tool = 'resumindo o histórico pra economizar token'; broadcast('status', { id, state: runState(id) }); }
  if (ev.type === 'system' && ev.subtype === 'init' && run.cwd) { run.initEv = ev; catalogCache.set(run.cwd, { at: Date.now(), data: catalogFrom(ev, null) }); }
  if (ev.type === 'system' && ev.subtype === 'commands_changed' && run.initEv && run.cwd) catalogCache.set(run.cwd, { at: Date.now(), data: catalogFrom(run.initEv, ev.commands) });
  if (ev.type === 'system' && ev.subtype === 'init') { run.phase = 'pensando'; if (ev.model) run.realModel = ev.model; broadcast('status', { id, state: runState(id) }); }
  else if (ev.type === 'stream_event') {
    const e = ev.event || {};
    if (e.type === 'content_block_delta' && e.delta && e.delta.type === 'text_delta' && !ev.parent_tool_use_id) sessionEmit(id, 'delta', { text: e.delta.text });
    else if (e.type === 'content_block_delta' && e.delta && e.delta.type === 'thinking_delta' && !ev.parent_tool_use_id) {
      run.thought = (run.thought + e.delta.thinking).slice(-2000); sessionEmit(id, 'think', { text: e.delta.thinking });
      if (run.phase !== 'pensando') run.phase = 'pensando';
      if (Date.now() - run.lastBroadcast > 1500) { run.lastBroadcast = Date.now(); broadcast('status', { id, state: runState(id) }); }
    }
    else if (e.type === 'content_block_start' && e.content_block && e.content_block.type === 'thinking' && !ev.parent_tool_use_id) { run.thought = ''; sessionEmit(id, 'think_reset', {}); }
    else if (e.type === 'message_start' && !ev.parent_tool_use_id) { sessionEmit(id, 'delta_reset', {}); if (run.phase !== 'escrevendo') { run.phase = 'pensando'; } }
    else if (e.type === 'content_block_start' && e.content_block && e.content_block.type === 'text' && !ev.parent_tool_use_id) { if (run.phase !== 'escrevendo') { run.phase = 'escrevendo'; run.tool = null; broadcast('status', { id, state: runState(id) }); } }
  } else if (ev.type === 'assistant' && ev.message && !ev.parent_tool_use_id) {
    run.turns++;
    const u = ev.message.usage; if (u) { run.tokIn = (u.input_tokens || 0) + (u.cache_creation_input_tokens || 0) + (u.cache_read_input_tokens || 0); run.tokOut = (run.tokOut || 0) + (u.output_tokens || 0); }
    const tu = (ev.message.content || []).filter(c => c.type === 'tool_use').pop();
    if (tu) {
      run.tool = tu.name + (toolSummary(tu.name, tu.input) ? ': ' + toolSummary(tu.name, tu.input) : ''); run.phase = 'ferramenta';
      run.steps.push({ t: Date.now(), name: tu.name, s: toolSummary(tu.name, tu.input) }); if (run.steps.length > 20) run.steps.shift();
      if (tu.name === 'TodoWrite' && tu.input && Array.isArray(tu.input.todos)) run.todos = tu.input.todos.map(t => ({ c: t.content, s: t.status, a: t.activeForm }));
    }
    broadcast('status', { id, state: runState(id) });
  } else if (ev.type === 'result') { run.result = ev; }
}

// ---------- leitura da conversa (paginada do fim pro começo) ----------
async function readConversation(meta, before, want = 160) {
  const st = await fsp.stat(meta.file);
  let end = before != null ? Math.min(+before, st.size) : st.size;
  let items = []; let start = end; let chunk = 1.5e6;
  while (start > 0 && items.length < want) {
    const s = Math.max(0, start - chunk);
    const buf = await readRange(meta.file, s, start - s);
    // corta no primeiro \n pra não pegar linha partida (exceto no início do arquivo)
    let off = 0; if (s > 0) { off = buf.indexOf(10) + 1; if (off <= 0) { chunk *= 2; if (chunk > 64e6) break; continue; } }
    const recs = parseLines(buf.subarray(off), false);
    const its = []; for (const r of recs) its.push(...toItems(r));
    items = its.concat(items); start = s + off; if (s === 0) start = 0;
    if (chunk < 8e6) chunk *= 2;
  }
  return { items, cursor: start > 0 ? start : null, size: st.size };
}

// tail ao vivo do arquivo pros inscritos na sessão
const tails = new Map(); // id -> {pos, rest, timer}
function ensureTail(id) {
  if (tails.has(id)) return;
  const meta = index.get(id); if (!meta) return;
  let st; try { st = fs.statSync(meta.file); } catch { return; }
  const t = { pos: st.size, rest: '', file: meta.file, busy: false };
  t.timer = setInterval(async () => {
    if (t.busy) return; t.busy = true;
    try {
      const st = await fsp.stat(t.file);
      if (st.size > t.pos) {
        const buf = await readRange(t.file, t.pos, Math.min(st.size - t.pos, 20e6)); t.pos += buf.length;
        const txt = t.rest + buf.toString('utf8'); const lines = txt.split('\n'); t.rest = lines.pop();
        const items = []; for (const l of lines) { if (!l) continue; try { items.push(...toItems(JSON.parse(l))); } catch { } }
        if (items.length) sessionEmit(id, 'items', { items });
      } else if (st.size < t.pos) { t.pos = st.size; t.rest = ''; }
    } catch { } finally { t.busy = false; }
  }, 900);
  tails.set(id, t);
}
function dropTail(id) { const subs = sessionSubs.get(id); if (subs && subs.size) return; const t = tails.get(id); if (t) { clearInterval(t.timer); tails.delete(id); } }

// ---------- rotas ----------
function listSessions() {
  const now = Date.now();
  return [...index.values()].map(m => ({
    id: m.id, project: m.project, cwd: m.cwd, title: board.names[m.id] || m.title || m.aiTitle || (m.firstPrompt || '').slice(0, 80) || m.id.slice(0, 8),
    aiTitle: m.aiTitle, firstPrompt: m.firstPrompt, lastText: m.lastText, lastRole: m.lastRole, lastTool: m.lastTool, model: m.model,
    mtime: m.mtime, created: m.created, size: m.size, entrypoint: m.entrypoint, lastThought: m.lastThought, todos: m.todos, question: m.question, lastKind: m.lastKind, ctx: m.ctx, compactedAt: m.compactedAt,
    liveElsewhere: !runs.has(m.id) && now - m.mtime < 45000 && !(lastRuns.get(m.id) && m.mtime <= lastRuns.get(m.id).endedAt + 8000),
  })).sort((a, b) => b.mtime - a.mtime);
}

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.json': 'application/json', '.webmanifest': 'application/manifest+json' };
async function serveStatic(req, res, p) {
  if (p === '/') p = '/index.html';
  const f = path.normalize(path.join(PUB, p)); if (!f.startsWith(PUB)) return send(res, 403, 'no');
  try { const b = await fsp.readFile(f); res.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream', 'Cache-Control': 'no-cache' }); res.end(b); }
  catch { send(res, 404, 'não achei'); }
}

const vpsLogin = require('./claude-login.js')({ bin: () => claudeBin() || 'claude', env: cleanEnv, send, readBody });
// Anti-CSRF e anti DNS rebinding: sem isso, qualquer site aberto no navegador conseguiria mandar comandos pro Board
// (no modo local não tem senha). Local: só aceita Host localhost/127.0.0.1. Todos os modos: /api só da mesma origem.
const LOCAL_HOSTS = new Set(['127.0.0.1', 'localhost', '[::1]'].map(h => h + ':' + PORT));
function blockedRequest(req, p) {
  const host = String(req.headers.host || '').toLowerCase();
  if (LOCAL && !LOCAL_HOSTS.has(host)) return 'host';
  if (!p.startsWith('/api/')) return '';
  if (req.headers['sec-fetch-site'] === 'cross-site') return 'cross-site';
  const origin = req.headers.origin;
  if (origin && origin !== 'null') { try { if (new URL(origin).host.toLowerCase() !== host) return 'origin'; } catch { return 'origin'; } }
  else if (origin === 'null' && req.method !== 'GET' && req.method !== 'HEAD') return 'origin';
  return '';
}
const handler = async (req, res) => {
  const u = new URL(req.url, 'http://x'); const p = u.pathname;
  const why = blockedRequest(req, p); if (why) return send(res, 403, { error: 'bloqueado (' + why + ')' });
  try {
    if (p.startsWith('/dist/') && !LOCAL) {   // pacotes do app Mac: públicos (só código, sem segredo)
      const f = path.normalize(path.join(ROOT, 'dist', decodeURIComponent(p.slice(6)))); if (!f.startsWith(path.join(ROOT, 'dist') + path.sep)) return send(res, 403, 'no');
      try { const b = await fsp.readFile(f); const ext = path.extname(f); res.writeHead(200, { 'Content-Type': ext === '.json' ? 'application/json' : ext === '.sh' ? 'text/plain; charset=utf-8' : 'application/octet-stream', 'Cache-Control': 'no-cache' }); return res.end(b); } catch { return send(res, 404, 'não achei'); }
    }
    if (p === '/login' && LOCAL) { res.writeHead(302, { Location: '/' }); return res.end(); }
    if (p === '/login' && req.method === 'GET') return serveStatic(req, res, '/login.html');
    if (p === '/api/login' && req.method === 'POST') {
      const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress; const f = loginFails.get(ip) || { n: 0, t: 0 };
      if (f.n >= 8 && Date.now() - f.t < 15 * 60e3) return send(res, 429, { error: 'Muitas tentativas, espere 15 min' });
      const b = await readBody(req);
      const ok = typeof b.password === 'string' && b.password.length === PASSWORD.length && crypto.timingSafeEqual(Buffer.from(b.password), Buffer.from(PASSWORD));
      if (!ok) { loginFails.set(ip, { n: f.n + 1, t: Date.now() }); return send(res, 401, { error: 'Senha errada' }); }
      loginFails.delete(ip);
      return send(res, 200, { ok: true }, { 'Set-Cookie': `cb=${makeToken()}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${30 * 86400}` });
    }
    if (p.startsWith('/assets/') || p === '/login.css' || p === '/favicon.svg' || p === '/manifest.webmanifest') return serveStatic(req, res, p);
    if (!authed(req)) { if (p.startsWith('/api/')) return send(res, 401, { error: 'login' }); res.writeHead(302, { Location: '/login' }); return res.end(); }

    if (!LOCAL && p === '/conectar' && req.method === 'GET') return serveStatic(req, res, '/conectar.html');
    if (!LOCAL && await vpsLogin(req, res, p)) return;
    if (p === '/api/logout') return send(res, 200, { ok: true }, { 'Set-Cookie': 'cb=; Path=/; Max-Age=0' });
    if (p === '/api/state' && req.method === 'GET') return send(res, 200, { sessions: listSessions(), board, status: statusAll(), models: MODELS, modelList, home: HOME, rateLimit, mode: LOCAL ? 'local' : 'vps', version: VERSION, account: LOCAL ? claudeAccount() : null });
    if (p === '/api/claude/account' && req.method === 'GET') return send(res, 200, { ...claudeAccount(), cliInstall: { state: cliInstall.state, log: cliInstall.log.slice(-600) } });
    if (p === '/api/claude/login' && req.method === 'POST') {
      // login OFICIAL: abre o Terminal com o Claude Code, que pede pra entrar na conta pelo navegador. O Board nunca vê a senha.
      const bin = claudeBin(); if (!bin) return send(res, 412, { error: 'instale o Claude Code primeiro' });
      if (WIN) { spawn('cmd.exe', ['/c', `start "Entrar no Claude" cmd /k ""${bin.replace(/"/g, '')}" /login"`], { windowsVerbatimArguments: true, detached: true, stdio: 'ignore' }).unref(); return send(res, 200, { ok: true }); }
      if (process.platform !== 'darwin') return send(res, 400, { error: 'login pelo painel só no Mac e no Windows' });
      spawn('osascript', ['-e', 'tell application "Terminal" to activate', '-e', `tell application "Terminal" to do script "clear; echo 'Entre na sua conta Claude (abre no navegador). Depois pode fechar esta janela.'; '${bin.replace(/'/g, '')}' /login"`], { stdio: 'ignore', detached: true }).unref();
      return send(res, 200, { ok: true });
    }
    if (p === '/api/claude/install' && req.method === 'POST') { if (!LOCAL) return send(res, 400, { error: 'só no modo local' }); installClaudeCli(); return send(res, 200, { ok: true }); }
    if (p === '/api/update' && req.method === 'GET') return send(res, 200, update);
    if (p === '/api/update' && req.method === 'POST') { const r = await checkUpdate(false); if (r.state === 'available') { if (runs.size) return send(res, 409, { error: 'espere as respostas em andamento terminarem' }); const info = await (await fetch(UPDATE_URL + '?t=' + Date.now())).json(); installUpdate(info); } return send(res, 200, update); }
    if (p === '/api/usage' && req.method === 'GET') { if (u.searchParams.get('refresh')) await pollOfficialUsage(); return send(res, 200, usageSummary()); }
    if (p === '/api/commands' && req.method === 'GET') return send(res, 200, { commands: listCommands() });
    if (p === '/api/claude/skills' && req.method === 'GET') return send(res, 200, { skills: listSkillDirs() });
    if (p === '/api/claude/skills' && req.method === 'POST') { const b = await readBody(req); try { toggleSkill(String(b.name || ''), !!b.active); return send(res, 200, { ok: true }); } catch (e) { return send(res, 400, { error: e.message }); } }
    if (p === '/api/transcribe' && req.method === 'POST') {
      const chunks = []; let n = 0, over = false;
      await new Promise(done => { req.on('data', c => { n += c.length; if (n > 40e6) over = true; else chunks.push(c); }); req.on('end', done); req.on('error', done); });
      if (over) return send(res, 413, { error: 'áudio longo demais (máx. ~20 min)' });
      try { const text = await transcribePcm(Buffer.concat(chunks), u.searchParams.get('lang') || 'pt'); return send(res, 200, { text }); } catch (e) { return send(res, 502, { error: e.message }); }
    }
    if (p === '/api/claude/catalog' && req.method === 'GET') { const c = await getCatalog(u.searchParams.get('cwd'), !!u.searchParams.get('force')); return c ? send(res, 200, c) : send(res, 503, { error: 'não consegui ler o catálogo do Claude Code' }); }
    if (p === '/api/claude/settings' && req.method === 'GET') return send(res, 200, { path: SETTINGS_FILE, text: readSettings() });
    if (p === '/api/claude/settings' && req.method === 'PUT') { const b = await readBody(req); try { const obj = writeSettings(b.text); return send(res, 200, { ok: true, settings: obj }); } catch (e) { return send(res, 400, { error: 'JSON inválido: ' + e.message }); } }
    if (p === '/api/vps' && req.method === 'GET') return send(res, 200, await vpsHealth());
    if (p === '/api/files' && req.method === 'GET') { try { return send(res, 200, await listDir(u.searchParams.get('path'))); } catch (e) { return send(res, e.code || 500, { error: e.message }); } }
    if (p === '/api/file' && req.method === 'GET') { try { return send(res, 200, await readFileSafe(u.searchParams.get('path'))); } catch (e) { return send(res, e.code || 500, { error: e.message }); } }
    if (p === '/api/fileraw' && req.method === 'GET') {
      const f = path.resolve(u.searchParams.get('path') || ''); const ext = (f.split('.').pop() || '').toLowerCase();
      try { const b = await fsp.readFile(f); res.writeHead(200, { 'Content-Type': IMG_MIME[ext] || 'application/octet-stream' }); return res.end(b); } catch { return send(res, 404, 'não achei'); }
    }
    if (p === '/api/board' && req.method === 'PUT') {
      const b = await readBody(req);
      for (const k of ['cards', 'frames', 'links', 'names', 'prefs', 'notes', 'init', 'columns', 'kanban', 'view', 'boards', 'folders', 'folderOf', 'currentBoardId', 'optim']) if (b[k] !== undefined) board[k] = b[k];
      saveBoard(); return send(res, 200, { ok: true });
    }
    if (p === '/api/events') {
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
      res.write(`event: hello\ndata: {}\n\n`); clients.add(res);
      const ka = setInterval(() => res.write(': ka\n\n'), 20000);
      req.on('close', () => { clients.delete(res); clearInterval(ka); });
      return;
    }
    if (p === '/api/dirs' && req.method === 'GET') {
      const q = u.searchParams.get('q') || HOME; let dir = q; try { if (!(await fsp.stat(dir)).isDirectory()) dir = path.dirname(dir); } catch { dir = path.dirname(dir); }
      let list = []; try { list = (await fsp.readdir(dir, { withFileTypes: true })).filter(d => d.isDirectory() && !d.name.startsWith('.')).map(d => path.join(dir, d.name)).slice(0, 200); } catch { }
      return send(res, 200, { dir, list });
    }
    if (p === '/api/upload' && req.method === 'POST') {
      const b = await readBody(req, 80e6);
      const raw = String(b.data || '').replace(/^data:[^;]+;base64,/, '');
      if (!raw || !b.name) return send(res, 400, { error: 'arquivo vazio' });
      let buf; try { buf = Buffer.from(raw, 'base64'); } catch { return send(res, 400, { error: 'base64 inválido' }); }
      if (buf.length > 60e6) return send(res, 413, { error: 'arquivo maior que 60 MB' });
      const safe = String(b.name).replace(/[^\w.\- ]+/g, '_').slice(-80) || 'arquivo';
      const fn = crypto.randomBytes(4).toString('hex') + '-' + safe;
      const dest = path.join(UPLOADS, fn);
      await fsp.writeFile(dest, buf);
      const ext = (safe.split('.').pop() || '').toLowerCase();
      return send(res, 200, { path: dest, name: safe, kind: IMG_MIME[ext] ? 'image' : 'file', url: '/uploads/' + encodeURIComponent(fn), size: buf.length });
    }
    if (p.startsWith('/uploads/')) {
      const f = path.join(UPLOADS, path.basename(decodeURIComponent(p.slice(9))));
      if (!f.startsWith(UPLOADS)) return send(res, 403, 'no');
      try { const b = await fsp.readFile(f); const ext = (f.split('.').pop() || '').toLowerCase(); res.writeHead(200, { 'Content-Type': IMG_MIME[ext] || MIME['.' + ext] || 'application/octet-stream' }); return res.end(b); }
      catch { return send(res, 404, 'não achei'); }
    }
    if (p === '/api/new' && req.method === 'POST') {
      const b = await readBody(req); if ((!b.text || !b.text.trim()) && !(b.attachments || []).length) return send(res, 400, { error: 'Escreva a primeira mensagem' });
      const id = crypto.randomUUID();
      try { startRun({ id, isNew: true, cwd: b.cwd, text: b.text, model: b.model, effort: b.effort, permission: b.permission, name: b.name, attachments: b.attachments }); }
      catch (e) { return send(res, e.code || 500, { error: e.message }); }
      if (b.name) { board.names[id] = b.name; saveBoard(); }
      // responde na hora; o índice aparece sozinho pelos eventos (nada de segurar a conexão)
      (async () => { for (let i = 0; i < 40; i++) { await new Promise(r => setTimeout(r, 250)); if (index.has(id) || (await refreshIndex() && index.has(id))) { broadcast('index', {}); break; } } })();
      return send(res, 200, { id });
    }
    let m;
    if ((m = p.match(/^\/api\/session\/([0-9a-f-]{36})(\/[a-z]+)?$/))) {
      const id = m[1]; const action = m[2] || ''; const meta = index.get(id);
      if (action === '/send' && req.method === 'POST') {
        const busy = runs.has(id) || procAlive(id);
        if (!meta && !busy && !sessionCwd.has(id)) return send(res, 404, { error: 'sessão não encontrada' });
        const b = await readBody(req); if ((!b.text || !b.text.trim()) && !(b.attachments || []).length) return send(res, 400, { error: 'mensagem vazia' });
        const msg = { text: b.text, attachments: b.attachments, model: b.model, effort: b.effort, permission: b.permission, at: Date.now() };
        if (b.now) {
          // Enviar agora: interrompe o que está rodando e manda esta na frente
          const q = queues.get(id) || []; q.unshift(msg); queues.set(id, q); emitQueue(id);
          stopRun(id);
          const pid = (liveProcs.get(id) || {}).pid; if (pid) { try { process.kill(pid, 'SIGINT'); } catch { } }
          const r = runs.get(id); if (r) setTimeout(() => finishRun(id, r), 1200);
          setTimeout(() => dispatchQueue(id), 2000);
          return send(res, 200, { ok: true, now: true });
        }
        if (busy) { const q = queues.get(id) || []; q.push(msg); queues.set(id, q); emitQueue(id); return send(res, 200, { ok: true, queued: true, position: q.length }); }
        if (needsCompact(id) && !String(b.text || '').trim().startsWith('/compact')) {
          const q = queues.get(id) || []; q.unshift(msg); queues.set(id, q); emitQueue(id);
          try { startAutoCompact(id, (meta && meta.cwd) || sessionCwd.get(id), msg); } catch (e) { return send(res, e.code || 500, { error: e.message }); }
          return send(res, 200, { ok: true, compacting: true, ctx: (index.get(id) || {}).ctx });
        }
        try { startRun({ id, isNew: false, cwd: (meta && meta.cwd) || sessionCwd.get(id), text: b.text, model: b.model, effort: b.effort, permission: b.permission, attachments: b.attachments }); }
        catch (e) { const q = queues.get(id) || []; q.push(msg); queues.set(id, q); emitQueue(id); return send(res, 200, { ok: true, queued: true, position: q.length }); }
        return send(res, 200, { ok: true });
      }
      if (action === '/promote' && req.method === 'POST') {
        // "Enviar agora" de UM item da fila: tira ele da posição, põe na frente, interrompe o run atual e dispara
        const b = await readBody(req); const q = queues.get(id) || [];
        if (b.index == null || !q[b.index]) return send(res, 404, { error: 'item não está mais na fila' });
        const [msg] = q.splice(b.index, 1); q.unshift(msg); queues.set(id, q); emitQueue(id);
        if (runs.has(id) || procAlive(id)) {
          stopRun(id);
          const pid = (liveProcs.get(id) || {}).pid; if (pid) { try { process.kill(pid, 'SIGINT'); } catch { } }
          const r = runs.get(id); if (r) setTimeout(() => finishRun(id, r), 1200);
          setTimeout(() => dispatchQueue(id), 2000);
        } else dispatchQueue(id);
        return send(res, 200, { ok: true });
      }
      if (action === '/unqueue' && req.method === 'POST') {
        const b = await readBody(req); const q = queues.get(id) || [];
        if (b.index != null && q[b.index]) q.splice(b.index, 1); else if (b.all) q.length = 0;
        if (!q.length) queues.delete(id); else queues.set(id, q);
        emitQueue(id); return send(res, 200, { ok: true });
      }
      if (action === '/stop' && req.method === 'POST') {
        queues.delete(id); emitQueue(id); // parar = limpa a fila também
        stopRun(id);
        const pid = (liveProcs.get(id) || {}).pid; if (pid) { try { process.kill(pid, 'SIGINT'); } catch { } }
        const r = runs.get(id); if (r) setTimeout(() => finishRun(id, r), 1500);
        return send(res, 200, { ok: true });
      }
      if (action === '/export' && req.method === 'GET') {
        if (!meta) return send(res, 404, { error: 'sessão não encontrada' });
        const rl = require('readline').createInterface({ input: fs.createReadStream(meta.file), crlfDelay: Infinity });
        const title = board.names[id] || meta.title || meta.aiTitle || id;
        const out = [`# ${title}`, '', `Pasta: ${meta.cwd || '~'} · ID: ${id}`, ''];
        for await (const line of rl) {
          let r; try { r = JSON.parse(line); } catch { continue; }
          for (const it of toItems(r)) {
            const when = it.ts ? ' · ' + new Date(it.ts).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' }) : '';
            if (it.kind === 'user') out.push(`## Você${when}`, '', it.text || '[imagem]', '');
            else if (it.kind === 'assistant') out.push(`## Claude${when}`, '', it.text, '');
            else if (it.kind === 'tool') out.push(`> 🔧 **${it.name}** ${it.summary || ''}`, '');
          }
        }
        const fn = (title.replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '-').slice(0, 60) || 'conversa') + '.md';
        res.writeHead(200, { 'Content-Type': 'text/markdown; charset=utf-8', 'Content-Disposition': `attachment; filename="${fn}"` });
        return res.end(out.join('\n'));
      }
      if (action === '/usage' && req.method === 'GET') {
        const recs = readUsage().filter(r => r.id === id);
        const t = recs.reduce((a, r) => { a.in += r.in; a.out += r.out; a.cost += r.cost; return a; }, { in: 0, out: 0, cost: 0, runs: recs.length });
        const last = recs[recs.length - 1];
        return send(res, 200, { total: t, contextTokens: (index.get(id) || {}).ctx ?? (last ? last.in : 0) });
      }
      if (action === '/messages' && req.method === 'GET') {
        if (!meta) return send(res, 404, { error: 'sessão não encontrada' });
        const before = u.searchParams.get('before');
        return send(res, 200, await readConversation(meta, before));
      }
      if (action === '/stream' && req.method === 'GET') {
        res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
        if (!sessionSubs.has(id)) sessionSubs.set(id, new Set()); sessionSubs.get(id).add(res);
        ensureTail(id);
        if (!tails.has(id)) { let n = 0; const t = setInterval(async () => { n++; if (!index.has(id)) await refreshIndex(); if (index.has(id)) ensureTail(id); if (tails.has(id) || n > 15 || res.writableEnded) clearInterval(t); }, 1000); }
        res.write(`event: state\ndata: ${JSON.stringify(runState(id))}\n\n`);
        res.write(`event: queue\ndata: ${JSON.stringify({ queue: queueView(id) })}\n\n`);
        const ka = setInterval(() => res.write(': ka\n\n'), 20000);
        req.on('close', () => { clearInterval(ka); sessionSubs.get(id)?.delete(res); dropTail(id); });
        return;
      }
    }
    if (p.startsWith('/api/')) return send(res, 404, { error: 'rota desconhecida' });
    return serveStatic(req, res, p);
  } catch (e) { console.error(e); if (!res.headersSent) send(res, 500, { error: e.message }); }
};

refreshIndex().then(() => {
  for (const h of HOSTS) http.createServer(handler).listen(PORT, h, () => console.log('Claude Board em', h + ':' + PORT, 'sessões:', index.size));
});
// novos arquivos/sessões rodando na extensão
setInterval(async () => { if (await refreshIndex()) broadcast('index', {}); }, 4000);
// reatacha a processos vivos no servidor (sobrevivem a fechar aba / desligar PC / restart do serviço)
let prevProcs = new Set();
setInterval(() => {
  scanLiveProcs();
  const now = new Set(liveProcs.keys());
  const union = new Set([...now, ...prevProcs]);
  let changed = now.size !== prevProcs.size; for (const id of union) if (now.has(id) !== prevProcs.has(id)) changed = true;
  if (changed) {
    for (const id of union) {
      if (runs.has(id)) continue;
      // processo externo (não iniciado por este node) que acabou de TERMINAR → avisa "sua vez"
      if (prevProcs.has(id) && !now.has(id)) {
        const started = (lastRuns.get(id) || {}).startedAt;
        const sum = { endedAt: Date.now(), startedAt: started, ok: true, external: true, error: null };
        lastRuns.set(id, sum);
        refreshIndex().then(() => { sessionEmit(id, 'done', sum); broadcast('status', { id, state: runState(id) }); broadcast('index', {}); });
        setTimeout(() => dispatchQueue(id), 1200); // se havia fila, dispara a próxima
        continue;
      }
      broadcast('status', { id, state: runState(id) });
      if (!index.has(id)) refreshIndex().then(c => c && broadcast('index', {}));
    }
    prevProcs = now;
  }
}, 3000);
scanLiveProcs(); prevProcs = new Set(liveProcs.keys());
// Reatacha às conversas que estavam rodando quando o painel caiu/reiniciou (unidades cb-*.service vivas).
function reattachRuns() {
  let metas; try { metas = fs.readdirSync(RUNS).filter(f => f.endsWith('.meta')); } catch { return; }
  for (const f of metas) {
    const id = f.slice(0, -5); if (runs.has(id)) continue;
    let meta; try { meta = JSON.parse(fs.readFileSync(path.join(RUNS, f), 'utf8')); } catch { continue; }
    const unit = meta.unit || ('cb-' + id);
    if ((LOCAL ? pidAlive(meta.pid) : serviceActive(unit)) || procAlive(id)) {
      const run = { unit, pid: meta.pid || null, startedAt: meta.startedAt || Date.now(), tool: null, model: meta.model || 'default', turns: 0, phase: LOCAL ? 'rodando' : 'rodando no servidor', cwd: null, thought: '', steps: [], todos: null, lastBroadcast: 0, logFile: meta.logFile, result: null, grace: Date.now() + 9000, sawAlive: true, reattached: true };
      runs.set(id, run); tailRunLog(id, run, 0); monitorRun(id, run);
      console.log('reatachado', id);
    } else {
      fs.unlink(path.join(RUNS, f), () => { });
    }
  }
}
reattachRuns();
setTimeout(() => { for (const id of queues.keys()) if (!runs.has(id) && !procAlive(id)) dispatchQueue(id); }, 5000);
