import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { readFile, writeFile } from 'node:fs/promises';
import express from 'express';
import path from 'node:path';
import WebSocket from 'ws';
import { fileTicketServer } from './fileTickets.server.mjs';

const backend = await fileTicketServer({ setup: false });
const referenceApp = express();
referenceApp.get('/reference', async (_request, response) => response.type('html').send(await readFile('design-reference/開門/index.html', 'utf8')));
referenceApp.use(express.static('client/public'));
const reference = referenceApp.listen(0, '127.0.0.1');
await once(reference, 'listening');
const browser = spawn(process.env.MIAN_BROWSER_BIN || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe', [
  '--headless=new', '--remote-debugging-port=9381', `--user-data-dir=${path.join(backend.directory, 'auth-browser')}`,
  '--no-first-run', '--disable-background-networking', '--disable-background-timer-throttling', 'about:blank',
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
  await waitFor(() => evaluate('document.querySelector(".auth-hint")?.textContent === "先把門鎖好。至少十個字。"'), 'first password form');
  assert.equal(await evaluate('!!document.querySelector(".home-screen")'), false);
  const fillPassword = async (password = 'browser-test-password') => {
    await evaluate(`{const input=document.querySelector('.auth-password'); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,${JSON.stringify(password)}); input.dispatchEvent(new Event('input',{bubbles:true}));}`);
    await evaluate(`document.querySelector('.auth-keyrow').requestSubmit()`);
  };
  await fillPassword();
  await waitFor(() => evaluate('document.querySelector(".auth-hint").textContent === "再寫一次。"'), 'same line confirms the new password');
  await fillPassword('different-test-password');
  await waitFor(() => evaluate('document.querySelector(".auth-hint").textContent === "不對。"'), 'password confirmation mismatch');
  assert.equal(await evaluate('!!document.querySelector(".auth-page.is-drawing")'), false);
  await evaluate(`
    window.gateRequests=[];
    window.gateHoldData=true;
    const fetchOriginal=window.fetch;
    window.fetch=async (...args)=>{
      const url=String(args[0]);
      const record={url,start:performance.now()};
      gateRequests.push(record);
      const response=await fetchOriginal(...args);
      if(url==='/api/font-presets' && gateHoldData) await new Promise(resolve=>window.releaseGateData=resolve);
      record.end=performance.now();
      return response;
    };
    window.gateStarted=performance.now();
  `);
  await fillPassword();
  await waitFor(() => evaluate('!!window.releaseGateData'), 'home data requested during drawing');
  const order = await evaluate(`({login:gateRequests.find(item=>item.url==='/api/auth/setup').end, data:gateRequests.filter(item=>['/api/config','/api/api-presets','/api/conversations','/api/font-presets'].includes(item.url)).map(item=>item.start)})`);
  assert.ok(order.data.length >= 4 && order.data.every(start => start >= order.login));
  assert.ok(await evaluate(`performance.getEntriesByType('resource').some(entry=>entry.name.includes('/assets/Chat-'))`));
  await waitFor(() => evaluate('performance.now()-gateStarted > 3400'), 'slow preload wait');
  assert.equal(await evaluate('!!document.querySelector(".home-screen")'), false);
  assert.equal(await evaluate('!!document.querySelector(".auth-page.is-drawing")'), true);
  const slowOffsets = await evaluate(`Array.from(document.querySelectorAll('[data-stroke]'),path=>Number(path.style.strokeDashoffset))`);
  assert.ok(slowOffsets.some(value => value === 0));
  assert.ok(await evaluate(`Number(document.querySelector('[data-ring]').style.strokeDashoffset)>0`));
  await evaluate('gateHoldData=false; releaseGateData()');
  await waitFor(() => evaluate('!!document.querySelector(".auth-page.is-opening") && !!document.querySelector(".auth-content.is-entering")'), 'gate and home crossfade');
  await waitFor(() => evaluate('!!document.querySelector(".home-screen") && !document.querySelector(".auth-page")'), 'home after setup');
  const { cookies } = await call('Network.getCookies', { urls: [backend.base] });
  const cookie = cookies.find(item => item.name === '__Host-mian');
  assert.ok(cookie?.secure && cookie.httpOnly && cookie.sameSite === 'Strict');
  assert.equal(await evaluate(`document.cookie.includes('__Host-mian')`), false);
  assert.equal(await evaluate(`fetch('/api/auth/settings',{method:'PUT',headers:{'content-type':'application/json'},body:JSON.stringify({localBypass:false})}).then(r=>r.status)`), 200);
  await call('Page.reload');
  await waitFor(() => evaluate('!!document.querySelector(".home-screen")'), 'cookie restores login without LAN bypass');
  assert.equal(await evaluate(`fetch('/api/config').then(r=>r.status)`), 200);
  await evaluate(`fetch('/api/auth/logout-all',{method:'POST',headers:{'content-type':'application/json'},body:'{}'})`);
  await waitFor(() => evaluate('!!document.querySelector(".auth-password:not(:disabled)")'), 'logout closes app and socket');
  assert.equal(await evaluate('!!document.querySelector(".home-screen")'), false);
  await call('Page.reload');
  await waitFor(() => evaluate('!!document.querySelector(".auth-password:not(:disabled)")'), 'cached content remains behind login');
  assert.equal(await evaluate(`fetch('/api/config').then(r=>r.status)`), 401);
  await fillPassword('wrong-test-password');
  await waitFor(() => evaluate('document.querySelector(".auth-hint").textContent === "不對。" && getComputedStyle(document.querySelector(".auth-fish-ink")).opacity === "0"'), 'wrong password returns to the draft');
  const stopped = await evaluate(`Array.from(document.querySelectorAll('[data-stroke]'),path=>path.style.strokeDashoffset)`);
  await sleep(250);
  assert.deepEqual(await evaluate(`Array.from(document.querySelectorAll('[data-stroke]'),path=>path.style.strokeDashoffset)`), stopped);
  await waitFor(() => evaluate('document.querySelector(".auth-hint").textContent === "密碼給門，不用給我"'), 'hint restores');
  await evaluate('document.fonts.ready');
  await writeFile('.tmp-auth-gate-preview.png', Buffer.from((await call('Page.captureScreenshot', { format: 'png' })).data, 'base64'));
  await evaluate('window.gateStarted=performance.now()');
  await fillPassword();
  await waitFor(() => evaluate('!!document.querySelector(".auth-content")'), 'login again');
  assert.ok(await evaluate('performance.now()-gateStarted >= 3000'));
  await waitFor(() => evaluate('!document.querySelector(".auth-page")'), 'fast login finishes its fade');
  await call('Page.navigate', { url: `http://127.0.0.1:${reference.address().port}/reference` });
  await waitFor(() => evaluate('!!document.querySelector("#art3 image")'), 'design reference');
  await evaluate('Promise.all([document.fonts.ready,new Promise(resolve=>{const image=new Image();image.onload=resolve;image.src="/fish_hi.png";})])');
  await writeFile('.tmp-auth-reference.png', Buffer.from((await call('Page.captureScreenshot', { format: 'png' })).data, 'base64'));
  console.log('auth browser: two-step setup, mismatch, minimum drawing time, slow data wait, wrong-password fade, crossfade, secure cookie, logout and cache gate passed');
} catch (error) {
  console.error(error);
  throw error;
} finally {
  cdp?.close();
  const exited = once(browser, 'exit');
  spawnSync('taskkill.exe', ['/PID', String(browser.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
  await exited;
  await backend.close();
  reference.close();
}
