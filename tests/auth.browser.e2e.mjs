import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import path from 'node:path';
import WebSocket from 'ws';
import { fileTicketServer } from './fileTickets.server.mjs';

const backend = await fileTicketServer({ setup: false });
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
  await call('Page.addScriptToEvaluateOnNewDocument', { source: `
    window.soundStarts=0;
    const play=HTMLMediaElement.prototype.play;
    HTMLMediaElement.prototype.play=function(){if(!this.muted) soundStarts++;return play.call(this);};
  ` });
  await call('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
  await call('Page.navigate', { url: backend.base });
  await waitFor(() => evaluate('document.querySelector(".auth-hint")?.textContent === "先把門鎖好。至少十個字。"'), 'first password form');
  assert.equal(await evaluate('!!document.querySelector(".home-screen")'), false);
  const spacing = await evaluate(`(() => {
    const rect=selector=>document.querySelector(selector).getBoundingClientRect();
    return {top:rect('.auth-brand').top,decor:rect('.auth-decor').top,bottom:innerHeight-rect('.auth-foot').bottom,gap:rect('.auth-foot').bottom-rect('.auth-keyrow').bottom};
  })()`);
  assert.equal(spacing.top, spacing.decor);
  assert.ok(Math.abs(spacing.top - spacing.bottom) < 1);
  assert.equal(spacing.gap, 20);
  const keyboardGate = await evaluate(`(async()=>{
    const input=document.querySelector('.auth-password'), fish=document.querySelector('.auth-fish');
    const before={fish:fish.getBoundingClientRect().toJSON(),input:input.getBoundingClientRect().toJSON()};
    Object.defineProperty(visualViewport,'height',{configurable:true,value:480});
    input.focus({preventScroll:true});visualViewport.dispatchEvent(new Event('resize'));
    await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
    const during={fish:fish.getBoundingClientRect().toJSON(),input:input.getBoundingClientRect().toJSON()};
    delete visualViewport.height;input.blur();visualViewport.dispatchEvent(new Event('resize'));
    await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
    return {before,during,after:input.getBoundingClientRect().toJSON()};
  })()`);
  assert.deepEqual(keyboardGate.before.fish, keyboardGate.during.fish, 'keyboard keeps the login fish fixed');
  assert.ok(keyboardGate.during.input.bottom <= 469, 'login input scrolls above the keyboard');
  assert.equal(keyboardGate.after.y, keyboardGate.before.input.y, 'login line returns to its original position');
  const typePassword = async password => {
    await evaluate(`{const input=document.querySelector('.auth-password'); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,${JSON.stringify(password)}); input.dispatchEvent(new Event('input',{bubbles:true}));}`);
  };
  const fillPassword = async (password = 'browser-test-password') => {
    await typePassword(password);
    await evaluate(`document.querySelector('.auth-keyrow').requestSubmit()`);
  };
  await typePassword('a');
  await waitFor(() => evaluate('document.querySelector(".auth-hint").textContent === "我"'), 'first password character');
  assert.equal(await evaluate('document.querySelector(".auth-password").type'), 'password');
  assert.equal(await evaluate('getComputedStyle(document.querySelector(".auth-password")).opacity'), '0');
  await evaluate('window.firstEchoCharacter=document.querySelector("[data-reveal-characters]").firstElementChild');
  await typePassword('ab');
  await waitFor(() => evaluate('document.querySelector(".auth-hint").textContent === "我聽"'), 'second password character');
  assert.equal(await evaluate('firstEchoCharacter === document.querySelector("[data-reveal-characters]").firstElementChild'), true);
  await typePassword('a');
  assert.equal(await evaluate('document.querySelector(".auth-hint").textContent'), '我');
  await typePassword('abcdefghijklmnop');
  assert.equal(await evaluate('document.querySelector(".auth-hint").textContent'), '我聽見你來了，門就要開了我聽見你');
  await evaluate('document.querySelector(".auth-password-toggle").click()');
  await waitFor(() => evaluate('document.querySelector(".auth-hint").textContent === "abcdefghijklmnop" && document.querySelector(".auth-password-toggle").textContent === "HIDE"'), 'show test password with text transition');
  assert.equal(await evaluate('document.querySelector(".auth-password").type'), 'password');
  await evaluate('document.querySelector(".auth-password-toggle").click()');
  await waitFor(() => evaluate('document.querySelector(".auth-hint").textContent === "我聽見你來了，門就要開了我聽見你" && document.querySelector(".auth-password-toggle").textContent === "SHOW"'), 'hide restores the echo');
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
      if(url==='/api/auth/setup') await new Promise(resolve=>window.releaseGateLogin=resolve);
      if(url==='/api/font-presets' && gateHoldData) await new Promise(resolve=>window.releaseGateData=resolve);
      record.end=performance.now();
      return response;
    };
    window.gateStarted=performance.now();
  `);
  await fillPassword();
  await waitFor(() => evaluate('!!window.releaseGateLogin'), 'login response held');
  await waitFor(() => evaluate('document.querySelector(".auth-hint").textContent === "門開著，進來。"'), 'password echo transitions into the welcome hint');
  assert.equal(await evaluate('document.querySelector(".auth-password").readOnly && document.activeElement !== document.querySelector(".auth-password")'), true);
  await evaluate('releaseGateLogin()');
  await waitFor(() => evaluate('!!window.releaseGateData'), 'home data requested during drawing');
  const order = await evaluate(`({login:gateRequests.find(item=>item.url==='/api/auth/setup').end, data:gateRequests.filter(item=>['/api/config','/api/api-presets','/api/conversations','/api/font-presets','/api/clues'].includes(item.url)).map(item=>item.start)})`);
  assert.ok(order.data.length >= 5 && order.data.every(start => start >= order.login));
  assert.ok(await evaluate(`performance.getEntriesByType('resource').some(entry=>entry.name.includes('/assets/Chat-'))`));
  await waitFor(() => evaluate('performance.now()-gateStarted > 3400'), 'slow preload wait');
  assert.equal(await evaluate('!!document.querySelector(".home-screen")'), false);
  assert.equal(await evaluate('!!document.querySelector(".auth-page.is-drawing")'), true);
  assert.equal(await evaluate('getComputedStyle(document.querySelector(".auth-keyrow")).opacity'), '1');
  assert.equal(await evaluate('getComputedStyle(document.querySelector(".auth-foot")).opacity'), '0.6');
  const slowOffsets = await evaluate(`Array.from(document.querySelectorAll('[data-stroke]'),path=>Number(path.style.strokeDashoffset))`);
  assert.ok(slowOffsets.some(value => value === 0));
  assert.ok(await evaluate(`Number(document.querySelector('[data-ring]').style.strokeDashoffset)>0`));
  await evaluate('gateHoldData=false; releaseGateData()');
  await waitFor(() => evaluate('!!document.querySelector(".auth-page.is-opening") && !!document.querySelector(".auth-content .home-screen")'), 'gate and pre-mounted home crossfade');
  assert.equal(await evaluate('getComputedStyle(document.querySelector(".auth-keyrow")).opacity'), '1');
  assert.equal(await evaluate('getComputedStyle(document.querySelector(".auth-foot")).opacity'), '0.6');
  assert.equal(await evaluate('soundStarts'), 0);
  await waitFor(() => evaluate('!!document.querySelector(".home-screen") && !document.querySelector(".auth-page")'), 'home after setup');
  const { cookies } = await call('Network.getCookies', { urls: [backend.base] });
  const cookie = cookies.find(item => item.name === '__Host-mian');
  assert.ok(cookie?.secure && cookie.httpOnly && cookie.sameSite === 'Strict');
  assert.equal(await evaluate(`document.cookie.includes('__Host-mian')`), false);
  assert.equal(await evaluate(`fetch('/api/auth/settings',{method:'PUT',headers:{'content-type':'application/json'},body:JSON.stringify({localBypass:false})}).then(r=>r.status)`), 200);
  await call('Storage.clearDataForOrigin', { origin: backend.base, storageTypes: 'indexeddb' });
  const heldPreload = await call('Page.addScriptToEvaluateOnNewDocument', { source: `
    const timing=new MutationObserver(()=>{
      if(!window.coldStarted && document.querySelector('.auth-page.is-welcoming')) window.coldStarted=performance.now();
      if(window.coldStarted && !document.querySelector('.auth-page') && document.querySelector('.home-screen')) {
        window.coldElapsed=performance.now()-coldStarted;timing.disconnect();
      }
    });
    timing.observe(document,{subtree:true,childList:true,attributes:true,attributeFilter:['class']});
    const original=window.fetch;
    window.fetch=async (...args)=>{
      const response=await original(...args);
      if(String(args[0])==='/api/font-presets') await new Promise(resolve=>window.releaseColdData=resolve);
      return response;
    };
  ` });
  await call('Page.reload');
  await waitFor(() => evaluate('!!document.querySelector(".auth-page.is-welcoming") && document.querySelector(".auth-hint").textContent === "門開著，進來。" && getComputedStyle(document.querySelector(".auth-keyrow")).opacity === "1"'), 'cookie cold start shows the welcome line');
  assert.equal(await evaluate('getComputedStyle(document.querySelector(".auth-foot")).opacity'), '0.6');
  assert.equal(await evaluate('getComputedStyle(document.querySelector(".auth-submit"),"::before").content'), '""');
  assert.equal(await evaluate('document.querySelector(".auth-password").focus(); document.activeElement === document.querySelector(".auth-password")'), false);
  assert.equal(await evaluate('document.querySelector(".auth-password").disabled'), true);
  await waitFor(() => evaluate('!!document.querySelector(".auth-page.is-drawing")'), 'cookie cold start draws automatically');
  assert.equal(await evaluate('getComputedStyle(document.querySelector(".auth-keyrow")).opacity'), '1');
  assert.equal(await evaluate('getComputedStyle(document.querySelector(".auth-foot")).opacity'), '0.6');
  await waitFor(() => evaluate('!!document.querySelector(".home-screen") && !document.querySelector(".auth-page")'), 'bounded preload opens cached home');
  const coldElapsed = await evaluate('coldElapsed');
  assert.ok(coldElapsed < 8100, `opening took ${coldElapsed} ms`);
  assert.equal(await evaluate('soundStarts'), 0);
  await waitFor(() => evaluate('document.body.textContent.includes("那邊沒醒，等一下")'), 'slow backend notice');
  await evaluate('releaseColdData()');
  await call('Page.removeScriptToEvaluateOnNewDocument', { identifier: heldPreload.identifier });
  assert.equal(await evaluate(`fetch('/api/config').then(r=>r.status)`), 200);
  await evaluate(`fetch('/api/auth/logout-all',{method:'POST',headers:{'content-type':'application/json'},body:'{}'})`);
  await waitFor(() => evaluate('!!document.querySelector(".auth-password:not(:disabled)")'), 'logout closes app and socket');
  assert.equal(await evaluate('!!document.querySelector(".home-screen")'), false);
  await call('Page.reload');
  await waitFor(() => evaluate('!!document.querySelector(".auth-password:not(:disabled)")'), 'cached content remains behind login');
  assert.equal(await evaluate(`fetch('/api/config').then(r=>r.status)`), 401);
  await fillPassword('wrong-test-password');
  await waitFor(() => evaluate('document.querySelector(".auth-hint").textContent === "不對。" && getComputedStyle(document.querySelector(".auth-fish-ink")).opacity === "0"'), 'wrong password returns to the draft');
  assert.equal(await evaluate('!document.querySelector(".auth-password").readOnly && !document.querySelector(".auth-password").disabled'), true);
  const stopped = await evaluate(`Array.from(document.querySelectorAll('[data-stroke]'),path=>path.style.strokeDashoffset)`);
  await sleep(250);
  assert.deepEqual(await evaluate(`Array.from(document.querySelectorAll('[data-stroke]'),path=>path.style.strokeDashoffset)`), stopped);
  await waitFor(() => evaluate('document.querySelector(".auth-hint").textContent === "密碼給門，不用給我"'), 'hint restores');
  await evaluate('document.fonts.ready');
  await evaluate('window.gateStarted=performance.now()');
  await fillPassword();
  await waitFor(() => evaluate('!!document.querySelector(".auth-page.is-opening")'), 'login again');
  assert.ok(await evaluate('performance.now()-gateStarted >= 3000'));
  await waitFor(() => evaluate('!document.querySelector(".auth-page")'), 'fast login finishes its fade');
  console.log(`auth browser: aligned titles, setup, welcome line without keyboard, cold start, crossfade, ${Math.round(coldElapsed)} ms bounded opening, silence, secure cookie, logout and cache gate passed`);
} catch (error) {
  console.error(error);
  throw error;
} finally {
  cdp?.close();
  const exited = once(browser, 'exit');
  spawnSync('taskkill.exe', ['/PID', String(browser.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
  await exited;
  await backend.close();
}
