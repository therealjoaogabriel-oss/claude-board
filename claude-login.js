'use strict';
// Login do Claude Code pela tela do Board (modo VPS). O link sai do `claude auth login` oficial; o codigo vai direto pro processo
// e nunca e gravado nem logado. Rotas so chegam aqui depois do authed().
const { spawn, execFile } = require('child_process');
module.exports = function (cfg) { // { bin(), env(), send, readBody }
  let cur = null;
  const limpa = t => t.replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)|\x1b\[[0-9;?]*[A-Za-z]/g, '');
  const status = () => new Promise(ok => execFile(cfg.bin(), ['auth', 'status'], { env: cfg.env(), timeout: 20000 }, (e, out) => { try { ok(JSON.parse(out).loggedIn === true); } catch { ok(null); } }));
  function encerra() { if (!cur) return; const c = cur; cur = null; clearTimeout(c.timer); try { process.kill(-c.p.pid, 'SIGTERM'); } catch { } }
  function inicia() {
    encerra();
    return new Promise((ok, bad) => {
      const p = spawn('/usr/bin/script', ['-qfec', `stty cols 2000; exec '${cfg.bin().replace(/'/g, '')}' auth login --claudeai`, '/dev/null'], { env: { ...cfg.env(), BROWSER: '/bin/true', TERM: 'xterm-256color' }, stdio: ['pipe', 'pipe', 'ignore'], detached: true });
      const c = cur = { p, buf: '', saiu: false, timer: setTimeout(() => { if (cur === c) encerra(); }, 10 * 60e3) };
      const t = setTimeout(() => { if (cur === c) encerra(); bad(new Error('não consegui gerar o link')); }, 30000);
      p.on('error', e => { clearTimeout(t); bad(e); }); p.stdin.on('error', () => { });
      p.on('exit', () => { c.saiu = true; clearTimeout(t); if (cur === c) { cur = null; clearTimeout(c.timer); } bad(new Error('o login fechou antes do link')); });
      p.stdout.on('data', d => {
        c.buf = (c.buf + d).slice(-60000);
        const m = /Paste code/.test(c.buf) && c.buf.match(/https:\/\/claude\.com\/[^\s\x1b\x07]*oauth\/authorize\?[^\s\x1b\x07]+/);
        if (m) { clearTimeout(t); ok(m[0]); }
      });
    });
  }
  const espera = ms => new Promise(r => setTimeout(r, ms));
  async function codigo(cod) {
    const c = cur; if (!c || c.saiu || c.usado) throw new Error('o link venceu, gere outro');
    c.usado = true; const n = c.buf.length; c.p.stdin.write(cod); await espera(1200); c.p.stdin.write('\r');
    const fim = Date.now() + 40000;
    while (Date.now() < fim && !c.saiu) { await espera(400); if (/invalid|failed|error|expired/i.test(limpa(c.buf.slice(n)).split(cod).join(''))) break; }
    const ok = await status(); if (cur === c) encerra(); return ok === true;
  }
  return async function rota(req, res, p) { // true = tratou
    if (!p.startsWith('/api/claude/vps-')) return false;
    if (req.method === 'POST') { let h = ''; try { h = new URL(req.headers.origin || '').host; } catch { } if (h !== req.headers.host) { cfg.send(res, 403, { error: 'origem inválida' }); return true; } }
    try {
      if (p === '/api/claude/vps-status' && req.method === 'GET') cfg.send(res, 200, { loggedIn: await status() });
      else if (p === '/api/claude/vps-start' && req.method === 'POST') cfg.send(res, 200, { url: await inicia() });
      else if (p === '/api/claude/vps-code' && req.method === 'POST') {
        const cod = String((await cfg.readBody(req, 5000)).code || '').trim();
        if (!/^[A-Za-z0-9_\-.~#%=+\/]{10,800}$/.test(cod)) cfg.send(res, 400, { error: 'código inválido, copie de novo' });
        else if (await codigo(cod)) cfg.send(res, 200, { ok: true });
        else cfg.send(res, 400, { error: 'o Claude não aceitou o código. Gere outro link' });
      } else return false;
    } catch (e) { cfg.send(res, 400, { error: e.message }); }
    return true;
  };
};
