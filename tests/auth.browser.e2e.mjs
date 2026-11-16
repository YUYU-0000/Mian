import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import path from 'node:path';
import WebSocket from 'ws';
import { fileTicketServer } from './fileTickets.server.mjs';

const backend = await fileTicketServer({ setup: false });
const browser = spawn(process.env.MIAN_BROWSER_BIN || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe', [
  '--headless=new', '--remote-debugging-port=9381', `--user-data-dir=${path.join(backend.directory, 'auth-browser')}`,
  '--no-first-run', '--disable-background-networking', 'about:blank',
], { windowsHide: true, stdio: 'ignore' });
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
async function waitFor(read, name) {
  const end = Date.now() + 20_000;
  while (Date.now() < end) { if (await read()) return; await sleep(80); }
  throw new Error(name);
}
let cdp;
try {
  let targets;
  await waitFor(async () => { try { targets = await (await fetch('http://127.0.0.1:9381/json')).json(); return true; } catch { return false; } }, 'browser startup');
  cdp = new WebSocket(targets.find(target => target.type === 'page').webSocketDebuggerUrl);
  await once(cdp, 'open');
  let sequence = 0;
  const pending = new Map();
  cdp.on('message', raw => {
    const message = JSON.parse(String(raw)), waiter = pending.get(message.id);
    if (!waiter) return;
    pending.delete(message.id);
    message.error ? waiter.reject(new Error(message.error.message)) : waiter.resolve(message.result);
  });
  const call = (method, params = {}) => new Promise((resolve, reject) => { const id = ++sequence; pending.set(id, { resolve, reject }); cdp.send(JSON.stringify({ id, method, params })); });
  const evaluate = async expression => {
    const result = await call('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
    return result.result.value;
  };
  await call('Page.enable'); await call('Runtime.enable'); await call('Network.enable');
  await call('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
  await call('Page.navigate', { url: backend.base });
  await waitFor(() => evaluate('document.querySelectorAll(".auth-paper input").length === 2'), 'first password form');
  assert.equal(await evaluate('!!document.querySelector(".home-screen")'), false);
  const fillPassword = async () => {
    await evaluate(`for (const input of document.querySelectorAll('.auth-paper input')) { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,'browser-test-password'); input.dispatchEvent(new Event('input',{bubbles:true})); }`);
    await evaluate(`document.querySelector('.auth-paper').requestSubmit()`);
  };
  await fillPassword();
  await waitFor(() => evaluate('!!document.querySelector(".home-screen")'), 'home after setup');
  const { cookies } = await call('Network.getCookies', { urls: [backend.base] });
  const cookie = cookies.find(item => item.name === '__Host-mian');
  assert.ok(cookie?.secure && cookie.httpOnly && cookie.sameSite === 'Strict');
  assert.equal(await evaluate(`document.cookie.includes('__Host-mian')`), false);
  assert.equal(await evaluate(`fetch('/api/auth/settings',{method:'PUT',headers:{'content-type':'application/json'},body:JSON.stringify({localBypass:false})}).then(r=>r.status)`), 200);
  await call('Page.reload');
  await waitFor(() => evaluate('!!document.querySelector(".home-screen")'), 'cookie restores login without LAN bypass');
  assert.equal(await evaluate(`fetch('/api/config').then(r=>r.status)`), 200);
  await evaluate(`fetch('/api/auth/logout-all',{method:'POST',headers:{'content-type':'application/json'},body:'{}'})`);
  await waitFor(() => evaluate('document.querySelectorAll(".auth-paper input").length === 1'), 'logout closes app and socket');
  assert.equal(await evaluate('!!document.querySelector(".home-screen")'), false);
  await call('Page.reload');
  await waitFor(() => evaluate('document.querySelectorAll(".auth-paper input").length === 1'), 'cached content remains behind login');
  assert.equal(await evaluate(`fetch('/api/config').then(r=>r.status)`), 401);
  await fillPassword();
  await waitFor(() => evaluate('!!document.querySelector(".home-screen")'), 'login again');
  console.log('auth browser: setup, secure HttpOnly cookie, disabled LAN bypass, logout, cache gate and login passed');
} finally {
  cdp?.close(); browser.kill();
  await sleep(500);
  await backend.close();
}
