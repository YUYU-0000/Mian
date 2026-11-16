import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { once } from 'node:events';
import { mkdtemp, mkdir, writeFile, symlink, rm } from 'node:fs/promises';
import path from 'node:path';
import readline from 'node:readline';
import assert from 'node:assert/strict';
import { readConfig, dataDirectory } from '../server/dist/config.js';
import { codexArguments, CODEX_PERMISSIONS } from '../server/dist/codexSecurity.js';

// 只读写本脚本创建的标记文件，不读取私人文件，也不发起模型请求。
const config = await readConfig();
await mkdir(dataDirectory, { recursive: true });
const inside = await mkdtemp(path.join(config.workingDirectory, '.sandbox-check-'));
const outside = await mkdtemp(path.join(dataDirectory, '.sandbox-check-'));
await writeFile(path.join(outside, 'marker.txt'), 'sandbox-boundary');
await symlink(outside, path.join(inside, 'escape'), process.platform === 'win32' ? 'junction' : 'dir');
const listener = createServer(socket => socket.end());
listener.listen(0, '127.0.0.1');
await once(listener, 'listening');
const child = spawn(process.env.MIAN_CODEX_BIN || 'codex', codexArguments(config), {
  cwd: config.workingDirectory, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'],
  env: { ...process.env, ...(process.env.MIAN_CODEX_HOME ? { CODEX_HOME: process.env.MIAN_CODEX_HOME } : {}) },
});
const pending = new Map();
let sequence = 0;
child.stderr.on('data', () => {});
child.on('error', error => { for (const item of pending.values()) item.reject(error); });
readline.createInterface({ input: child.stdout }).on('line', line => {
  const value = JSON.parse(line), item = pending.get(value.id);
  if (!item) return;
  pending.delete(value.id); clearTimeout(item.timer);
  value.error ? item.reject(new Error(value.error.message)) : item.resolve(value.result);
});
const request = (method, params) => new Promise((resolve, reject) => {
  const id = ++sequence;
  const timer = setTimeout(() => reject(new Error(`${method} timed out`)), 60_000);
  pending.set(id, { resolve, reject, timer });
  child.stdin.write(JSON.stringify({ id, method, params }) + '\n');
});
try {
  await request('initialize', { clientInfo: { name: 'mian_sandbox_check', version: '1.0.0' }, capabilities: { experimentalApi: true } });
  child.stdin.write(JSON.stringify({ method: 'initialized' }) + '\n');
  const probe = `
    const fs = require('node:fs'); const net = require('node:net');
    const inside = ${JSON.stringify(inside)}, outside = ${JSON.stringify(outside)};
    const path = require('node:path'); const results = {};
    const attempt = (name, action) => { try { action(); results[name] = true; } catch { results[name] = false; } };
    attempt('workspaceWrite', () => fs.writeFileSync(path.join(inside, 'ok.txt'), 'ok'));
    attempt('workspaceRead', () => { if (fs.readFileSync(path.join(inside, 'ok.txt'), 'utf8') !== 'ok') throw Error(); });
    attempt('outsideRead', () => fs.readFileSync(path.join(outside, 'marker.txt')));
    attempt('outsideWrite', () => fs.writeFileSync(path.join(outside, 'escape.txt'), 'blocked'));
    attempt('junctionRead', () => fs.readFileSync(path.join(inside, 'escape', 'marker.txt')));
    const connect = (host, port) => new Promise(resolve => {
      const socket = net.createConnection({ host, port });
      const finish = value => { socket.destroy(); resolve(value); };
      socket.on('connect', () => finish(true)); socket.on('error', () => finish(false)); socket.setTimeout(3000, () => finish(false));
    });
    Promise.all([connect('127.0.0.1', ${listener.address().port}), connect('1.1.1.1', 443)]).then(([localNetwork, internet]) => console.log(JSON.stringify({ ...results, localNetwork, internet })));
  `;
  const result = await request('command/exec', {
    command: [process.execPath, '-e', probe], cwd: inside, permissionProfile: CODEX_PERMISSIONS, timeoutMs: 20_000,
  });
  assert.equal(result.exitCode, 0, result.stderr);
  const summary = JSON.parse(result.stdout.trim());
  assert.deepEqual(summary, { workspaceWrite: true, workspaceRead: true, outsideRead: false, outsideWrite: false, junctionRead: false, localNetwork: false, internet: false });
  console.log(JSON.stringify(summary));
} finally {
  child.kill(); listener.close();
  for (const item of pending.values()) clearTimeout(item.timer);
  for (const [directory, parent] of [[inside, config.workingDirectory], [outside, dataDirectory]]) {
    assert.equal(path.dirname(path.resolve(directory)), path.resolve(parent));
    await rm(directory, { recursive: true, force: true });
  }
}
