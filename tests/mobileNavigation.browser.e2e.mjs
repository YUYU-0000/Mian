import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import path from 'node:path';
import WebSocket from 'ws';
import { fileTicketServer } from './fileTickets.server.mjs';

const backend = await fileTicketServer({ voice: true });
const browser = spawn(process.env.MIAN_BROWSER_BIN || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe', [
  '--headless=new', '--remote-debugging-port=9384', `--user-data-dir=${path.join(backend.directory, 'mobile-browser')}`,
  '--no-first-run', '--disable-background-networking', '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows', 'about:blank',
], { windowsHide: true, stdio: 'ignore' });
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
// A lossily encoded WebP contains a VP8 keyframe. Repeat it in a tiny, silent WebM
// so this test does not depend on headless canvas capture producing video frames.
function videoFixture(webp) {
  const element = (id, data) => {
    const payload = Buffer.isBuffer(data) ? data : Buffer.concat(data);
    let size = 1;
    while (payload.length >= 2 ** (7 * size) - 1) size++;
    const length = Buffer.alloc(size);
    length.writeUIntBE(payload.length, 0, size); length[0] |= 1 << (8 - size);
    return Buffer.concat([Buffer.from(id, 'hex'), length, payload]);
  };
  const number = (id, value) => { const data = Buffer.alloc(4); data.writeUInt32BE(value); return element(id, data); };
  const text = (id, value) => element(id, Buffer.from(value));
  const offset = webp.indexOf(Buffer.from('VP8 '));
  assert.ok(offset >= 0, 'fixture canvas encoded a VP8 frame');
  const frame = webp.subarray(offset + 8, offset + 8 + webp.readUInt32LE(offset + 4));
  const duration = Buffer.alloc(8); duration.writeDoubleBE(2000);
  return Buffer.concat([
    element('1a45dfa3', [number('4286', 1), number('42f7', 1), number('42f2', 4), number('42f3', 8), text('4282', 'webm'), number('4287', 2), number('4285', 2)]),
    element('18538067', [
      element('1549a966', [number('2ad7b1', 1000000), element('4489', duration), text('4d80', 'Mian test'), text('5741', 'Mian test')]),
      element('1654ae6b', [element('ae', [number('d7', 1), number('73c5', 1), number('83', 1), text('86', 'V_VP8'), element('e0', [number('b0', 160), number('ba', 120)])])]),
      element('1f43b675', [number('e7', 0), ...Array.from({ length: 21 }, (_, i) => {
        const header = Buffer.from([0x81, 0, 0, 0x80]); header.writeInt16BE(i * 100, 1);
        return element('a3', Buffer.concat([header, frame]));
      })]),
    ]),
  ]);
}
async function waitFor(read, name) {
  const end = Date.now() + 20_000;
  while (Date.now() < end) { if (await read()) return; await sleep(50); }
  throw new Error(name);
}
let cdp;
try {
  let targets;
  await waitFor(async () => { try { targets = await (await fetch('http://127.0.0.1:9384/json')).json(); return true; } catch { return false; } }, 'browser startup');
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
  const click = selector => evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`);
  const tap = async selector => {
    const point = await evaluate(`(()=>{const r=document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()`);
    await call('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [point] });
    await call('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  };
  const route = pathname => waitFor(() => evaluate(`location.pathname===${JSON.stringify(pathname)} && !document.querySelector('.auth-page') && document.querySelector('.route-transition-frame')?.dataset.transitionActive==='false'`), pathname);
  const metrics = height => call('Emulation.setDeviceMetricsOverride', { width: 390, height, deviceScaleFactor: 1, mobile: true });
  const setInput = (selector, value) => evaluate(`{const input=document.querySelector(${JSON.stringify(selector)}); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,${JSON.stringify(value)}); input.dispatchEvent(new Event('input',{bubbles:true}));}`);
  await call('Page.enable');
  await call('Page.bringToFront');
  await call('Page.addScriptToEvaluateOnNewDocument', { source: `
    window.testVK=sessionStorage.getItem('testVirtualKeyboard')==='1'?Object.assign(new EventTarget(),{overlaysContent:false,boundingRect:new DOMRect()}):undefined;
    Object.defineProperty(navigator,'virtualKeyboard',{configurable:true,value:window.testVK});
    window.focusCalls=[];
    const focus=HTMLElement.prototype.focus;
    HTMLElement.prototype.focus=function(options){if(this.matches('input,textarea,[contenteditable="true"]'))focusCalls.push({preventScroll:options?.preventScroll,className:this.className});return focus.call(this,options)};
    window.mediaReads=0;window.revoked=[];
    const get=IDBObjectStore.prototype.get;
    IDBObjectStore.prototype.get=function(key){if(String(key).includes('savedMediaFile_home_photo'))mediaReads++;return get.call(this,key)};
    const revoke=URL.revokeObjectURL;
    URL.revokeObjectURL=function(url){revoked.push(url);revoke.call(URL,url)};
  ` });
  await metrics(844);
  await call('Page.navigate', { url: backend.base });
  await route('/');
  await evaluate(`window.uploadMedia=async(selector,blob)=>{
    const transfer=new DataTransfer();transfer.items.add(new File([blob],blob.type.startsWith('video/')?'fixture.webm':'fixture.png',{type:blob.type}));
    const input=document.querySelector(selector);input.files=transfer.files;input.dispatchEvent(new Event('change',{bubbles:true}));
  };window.testCanvas=document.createElement('canvas');testCanvas.width=160;testCanvas.height=120;
  testCanvas.getContext('2d').fillStyle='#7f9bb8';testCanvas.getContext('2d').fillRect(0,0,160,120);
  new Promise(resolve=>testCanvas.toBlob(resolve)).then(blob=>uploadMedia('.home-photo.widget .file-input',blob));`);
  await waitFor(() => evaluate(`!!document.querySelector('.home-photo.widget img:not(.developing)')?.complete`), 'home photo');
  const video = videoFixture(Buffer.from(await evaluate(`testCanvas.toDataURL('image/webp',0.8).split(',')[1]`), 'base64'));
  await evaluate(`(async()=>{
    await uploadMedia('.home-photo.wide .file-input',await (await fetch('data:video/webm;base64,${video.toString('base64')}')).blob());
    document.querySelector('.home-pages').scrollLeft=390;
  })()`);
  await waitFor(() => evaluate(`document.querySelector('.home-photo.wide video')?.currentTime>0.1`), 'home video').catch(async error => {
    throw new Error(error.message + ' ' + JSON.stringify(await evaluate(`(()=>{const v=document.querySelector('.home-photo.wide video');return {exists:!!v,time:v?.currentTime,duration:v?.duration,paused:v?.paused,error:v?.error?.message,ready:v?.readyState,left:document.querySelector('.home-pages').scrollLeft}})()`)));
  });
  await sleep(950);
  await evaluate(`window.savedHome=document.querySelector('.home-screen');window.savedPhoto=document.querySelector('.home-photo.widget img');
    window.savedVideo=document.querySelector('.home-photo.wide video');window.savedDock=document.querySelector('.dock-1');window.savedReads=mediaReads;`);

  // Simulate both keyboard geometry sources. Screen coordinates include viewport panning.
  const geometryHelpers=`window.keyboardHeight=844;window.keyboardOffset=0;
    Object.defineProperty(visualViewport,'height',{configurable:true,get:()=>testVK?844:keyboardHeight});
    Object.defineProperty(visualViewport,'offsetTop',{configurable:true,get:()=>keyboardOffset});
    window.setKeyboard=(height,offset=0)=>{keyboardHeight=height;keyboardOffset=offset;if(testVK){testVK.boundingRect=height<844?new DOMRect(0,height,390,844-height):new DOMRect();testVK.dispatchEvent(new Event('geometrychange'))}else visualViewport.dispatchEvent(new Event('resize'))};
    window.screenRect=element=>{const r=element.getBoundingClientRect();return {x:r.x,y:r.y-visualViewport.offsetTop,width:r.width,height:r.height}};
    window.rect=selector=>screenRect(document.querySelector(selector));
    window.paperEdge=selector=>{const paper=document.querySelector(selector);return Math.max(...[paper,...paper.querySelectorAll(':scope > .stack-bot,:scope > .stack-mid,:scope > .paper-layer-bot,:scope > .paper-layer-mid')].map(element=>{const r=screenRect(element);return r.y+r.height}))};
    window.keyboardBackground=()=>Array.from(document.querySelectorAll('.connections-page,.settings-page,.clues-page,.settings-header,.connections-page .envelope,.settings-page .folders-container,.clues-page .head,.clues-page .wall,.ticket-drawer .strip-col'),screenRect);
    window.paperFrames=selector=>new Promise(resolve=>{const frames=[],start=performance.now();const sample=()=>{frames.push(rect(selector).y);if(performance.now()-start<260)requestAnimationFrame(sample);else resolve(frames)};requestAnimationFrame(sample)});`;
  await evaluate(geometryHelpers);
  const keyboard = async (paper, input, mode = 'visual') => {
    const before = await evaluate(`(()=>{
      window.keyboardAncestors=[];
      for(let parent=document.querySelector(${JSON.stringify(input)}).parentElement;parent;parent=parent.parentElement) keyboardAncestors.push([parent,parent.scrollTop]);
      return {paper:rect(${JSON.stringify(paper)}),edge:paperEdge(${JSON.stringify(paper)}),input:rect(${JSON.stringify(input)}),background:keyboardBackground()};
    })()`);
    await evaluate(`document.querySelector(${JSON.stringify(input)}).focus({preventScroll:true});setKeyboard(480);`);
    assert.equal(await evaluate(`document.activeElement===document.querySelector(${JSON.stringify(input)})`), true, `${input} accepts focus`);
    if (mode === 'layout') await metrics(480);
    const moving = await evaluate(`paperFrames(${JSON.stringify(paper)})`);
    await evaluate('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
    const after = await evaluate(`({paper:rect(${JSON.stringify(paper)}),edge:paperEdge(${JSON.stringify(paper)}),input:rect(${JSON.stringify(input)}),height:document.documentElement.style.getPropertyValue('--app-h'),scrollFixed:keyboardAncestors.every(([element,top])=>element.scrollTop===top),background:keyboardBackground()})`);
    const bottom = before.edge;
    const lift = bottom > 480 ? bottom - 474 : 0;
    for (const key of ['x', 'width', 'height']) assert.ok(Math.abs(before.paper[key] - after.paper[key]) < 0.1, `${input} preserves paper ${key} in ${mode}`);
    assert.equal(after.height, '844px');
    assert.ok(Math.abs(before.paper.y - after.paper.y - lift) < 0.1, `${input} lifts the complete stack only when covered`);
    if (bottom>480) assert.ok(Math.abs(after.edge-474)<0.1,`${input} keeps the lowest paper layer exactly 6px above the keyboard`);
    assert.ok(Math.abs(before.input.y - after.input.y - lift) < 0.1, `${input} moves with its paper`);
    assert.equal(after.scrollFixed, true, `${input} never scrolls the paper contents`);
    assert.deepEqual(after.background,before.background,`${input} keeps page backgrounds, decorations and headers fixed`);
    for (let i=0;i<moving.length;i++) {
      assert.ok(moving[i]>=after.paper.y-0.1 && moving[i]<=before.paper.y+0.1,`${input} never overshoots while lifting`);
      if(i) assert.ok(moving[i]<=moving[i-1]+0.1,`${input} lifts without bouncing`);
    }
    await evaluate(`setKeyboard(844);document.activeElement.blur();`);
    if (mode === 'layout') await metrics(844);
    const returning = await evaluate(`paperFrames(${JSON.stringify(paper)})`);
    const restored = await evaluate(`({paper:rect(${JSON.stringify(paper)}),input:rect(${JSON.stringify(input)})})`);
    assert.ok(Math.abs(before.paper.y - restored.paper.y) < 0.1, `${input} restores the paper position`);
    assert.ok(Math.abs(before.input.y - restored.input.y) < 0.1, `${input} restores its original position`);
    for (let i=0;i<returning.length;i++) {
      assert.ok(returning[i]>=after.paper.y-0.1 && returning[i]<=before.paper.y+0.1,`${input} never overshoots while returning`);
      if(i) assert.ok(returning[i]>=returning[i-1]-0.1,`${input} returns without bouncing`);
    }
  };
  const checkHome = async () => {
    assert.equal(await evaluate(`savedHome===document.querySelector('.home-screen') && savedPhoto===document.querySelector('.home-photo.widget img') && savedVideo===document.querySelector('.home-photo.wide video') && savedDock===document.querySelector('.dock-1')`), true);
    assert.equal(await evaluate(`mediaReads===savedReads && !savedPhoto.classList.contains('developing') && savedPhoto.complete && !revoked.includes(savedPhoto.src) && !revoked.includes(savedVideo.src)`), true);
  };
  await click('.dock-1'); await route('/connections');
  assert.equal(await evaluate('savedVideo.paused && savedVideo.readyState>=2'), true, 'hidden home keeps the decoded video frame');
  const videoTime = await evaluate('savedVideo.currentTime');
  await click('#apiTie'); await sleep(500);
  await tap('#apiStack .js-note');
  assert.equal(await evaluate(`focusCalls.at(-1).preventScroll`),true,'tapping an input uses preventScroll');
  await keyboard('#apiStack', '#apiStack .api-sheet .js-note', 'layout');
  await keyboard('#apiStack', '#apiStack .api-sheet .js-key');
  const extraLayer = await evaluate(`(async()=>{
    const style=document.createElement('style');style.textContent='.keyboard-extra-fixture::after{content:"";position:absolute;top:calc(100% + 10px);left:0;width:100%;height:18px;background:#e1ddd2}';document.head.append(style);
    const paper=document.createElement('div');paper.className='keyboard-extra-fixture';paper.dataset.keyboardSurface='';
    paper.style.cssText='position:fixed;top:350px;left:20px;width:200px;height:120px;background:#f5f2ec;z-index:200;--keyboard-extra:18px';
    paper.innerHTML='<input style="position:absolute;top:10px;left:10px;width:100px;height:30px"><div style="position:absolute;top:100%;height:10px;width:100%;background:#ebe7de"></div><div style="opacity:0;position:absolute;top:100%;height:250px"><div style="height:300px"></div></div><div style="display:none;height:700px"></div><div style="position:absolute;top:50px;height:30px;width:20px;overflow:hidden"><div style="height:500px"></div></div>';
    document.querySelector('#root').append(paper);paper.querySelector('input').focus({preventScroll:true});setKeyboard(480);
    await new Promise(resolve=>requestAnimationFrame(resolve));await Promise.all(paper.getAnimations().map(animation=>animation.finished));
    const shifted=paper.getBoundingClientRect().top;
    setKeyboard(844);document.activeElement.blur();await new Promise(resolve=>requestAnimationFrame(resolve));await Promise.all(paper.getAnimations().map(animation=>animation.finished));
    const restored=paper.getBoundingClientRect().top;paper.remove();style.remove();return {shifted,restored};
  })()`);
  assert.ok(Math.abs(extraLayer.shifted-326)<0.1,'visible child layer and 18px pseudo layer are counted; hidden and clipped content is excluded');
  assert.equal(extraLayer.restored,350,'the complete stack returns to its original position');
  const panning = await evaluate(`(async()=>{
    const background=keyboardBackground();
    document.querySelector('#apiStack .js-key').focus({preventScroll:true});setKeyboard(480);
    await new Promise(resolve=>setTimeout(resolve,260));
    const paper=rect('#apiStack');
    const frames=[32,96,64,0].map(offset=>{keyboardOffset=offset;visualViewport.dispatchEvent(new Event('scroll'));return {background:keyboardBackground(),paper:rect('#apiStack'),offset:document.querySelector('#root').style.getPropertyValue('--keyboard-viewport-y')}});
    setKeyboard(800,24);const closingBackground=keyboardBackground();
    setKeyboard(844);document.activeElement.blur();await new Promise(resolve=>setTimeout(resolve,260));
    return {background,paper,frames,closingBackground};
  })()`);
  for (const [index,frame] of panning.frames.entries()) {
    assert.deepEqual(frame.background,panning.background,'viewport panning cannot move the page background');
    for (const key of ['x','y','width','height']) assert.ok(Math.abs(frame.paper[key]-panning.paper[key])<0.1,'viewport compensation does not lift the paper twice');
    assert.equal(frame.offset,`${[32,96,64,0][index]}px`,'root compensation is synchronous');
  }
  assert.deepEqual(panning.closingBackground,panning.background,'background remains fixed through the last viewport-pan frame when closing');
  const apiSwitch = await evaluate(`(async()=>{
    const before={paper:rect('#apiStack'),note:rect('#apiStack .js-note'),key:rect('#apiStack .js-key')};
    document.querySelector('#apiStack .js-key').focus({preventScroll:true});setKeyboard(260);
    await new Promise(resolve=>setTimeout(resolve,300));
    document.querySelector('#apiStack .js-note').focus({preventScroll:true});
    await new Promise(resolve=>setTimeout(resolve,300));
    const note={paper:rect('#apiStack'),field:rect('#apiStack .js-note')};
    document.querySelector('#apiStack .js-key').focus({preventScroll:true});
    await new Promise(resolve=>setTimeout(resolve,300));
    const key={paper:rect('#apiStack'),field:rect('#apiStack .js-key'),edge:paperEdge('#apiStack')};
    setKeyboard(844);document.activeElement.blur();
    await new Promise(resolve=>setTimeout(resolve,300));
    return {before,note,key};
  })()`);
  assert.ok(Math.abs(apiSwitch.note.field.y+apiSwitch.note.field.height-254)<0.1,'tall paper keeps the upper field visible with 6px clearance');
  assert.ok(Math.abs(apiSwitch.key.edge-254)<0.1,'switching to the lower field restores alignment to the lowest layer');
  await evaluate(`document.querySelector('#apiStack .js-key').focus({preventScroll:true})`);
  await setInput('#apiStack .api-sheet .js-key', 'fixture-key');
  await tap('#apiStack .password-toggle');
  await waitFor(() => evaluate(`document.querySelector('#apiStack .js-key').type==='text' && document.querySelector('#apiStack .password-toggle').textContent==='HIDE'`), 'API show toggle');
  await click('#paperOverlay'); await sleep(400);
  await click('#codexTie'); await sleep(500); await click('.cover-workspace'); await sleep(500);
  await keyboard('.tag-card', '.workspace-editor textarea');
  await click('.tag-overlay'); await click('#paperOverlay'); await click('.connections-page .back-btn'); await route('/');
  await checkHome();
  assert.equal(await evaluate(`savedVideo.currentTime>=${videoTime} || savedVideo.currentTime<0.2`), true, 'video resumes from its retained position or loops');

  await click('.dock-2'); await route('/settings');
  await click('#folderVoiceSettings'); await sleep(650);
  await keyboard('.paper-stack-container', '.vc-page.current .vc-key', 'layout');
  await keyboard('.paper-stack-container', '.vc-page.current .vc-line');
  await evaluate(`document.querySelector('.vc-page.current .vc-key').focus({preventScroll:true})`);
  await setInput('.vc-page.current .vc-key', 'fixture-token');
  await tap('.vc-page.current .password-toggle');
  await waitFor(() => evaluate(`document.querySelector('.vc-page.current .vc-key').type==='text' && document.querySelector('.vc-page.current .password-toggle').textContent==='HIDE'`), 'voice show toggle');
  assert.equal(await evaluate(`document.activeElement===document.querySelector('.vc-page.current .vc-key')`), true, 'show toggle does not blur and save away the token');
  await click('#paperOverlay'); await sleep(600); await click('#folderApiSettings'); await sleep(650);
  await keyboard('.paper-stack-container', '.api-page .api-postcard-form .api-field-row:nth-child(2) input');
  await click('#paperOverlay'); await click('#headerBackBtn'); await route('/'); await checkHome();

  await evaluate(`(async()=>{const wall=await (await fetch('/api/clues')).json();wall.cards=[{
    id:'keyboard-clue',title:'測試',content:'測試正文',mode:'pinned',when:'',scenes:[],layout:0,order:0,x:24,y:140,w:84,h:88,r:0,createdAt:'2026-11-16',updatedAt:'2026-11-16'
  }];await fetch('/api/clues',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify(wall)})})()`);
  await click('.dock-3'); await route('/clues');
  await waitFor(() => evaluate(`!!document.querySelector('.clues-page .item.card')`), 'saved clue');
  await evaluate(`document.querySelector('.clues-page .item.card').dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}))`); await sleep(350);
  await keyboard('.clues-page .sheet', '.clues-page .content', 'layout');
  await click('.clues-page .done'); await sleep(300); await click('.clues-back'); await route('/'); await checkHome();

  await click('.icon-1'); await route('/chat');
  await evaluate(`document.querySelector('.archive-input textarea').focus({preventScroll:true});setKeyboard(480);`);
  await sleep(200);
  assert.ok(await evaluate(`document.querySelector('.archive-input').getBoundingClientRect().bottom<=480`), 'only the chat composer follows the keyboard');
  await evaluate(`setKeyboard(844);document.activeElement.blur()`);
  await click('.ribbon-back-hit'); await route('/'); await checkHome();
  // Switch to an overlay keyboard: visualViewport never shrinks, only geometrychange fires.
  await evaluate(`sessionStorage.setItem('testVirtualKeyboard','1')`);
  await call('Page.reload');
  await waitFor(()=>evaluate(`!!window.testVK?.overlaysContent`),'overlay keyboard enabled');
  await route('/');
  await evaluate(geometryHelpers);
  assert.match(await evaluate(`document.querySelector('meta[name="viewport"]').content`),/interactive-widget=overlays-content/);
  await click('.dock-1'); await route('/connections'); await click('#apiTie'); await sleep(500);
  await keyboard('#apiStack','#apiStack .js-key');
  assert.equal(await evaluate('visualViewport.height'),844,'overlay keyboard leaves the viewport full size');
  await click('#paperOverlay'); await click('.connections-page .back-btn'); await route('/');
  await click('.dock-2'); await route('/settings'); await click('#folderVoiceSettings'); await sleep(650);
  await keyboard('.paper-stack-container','.vc-page.current .vc-key');
  await click('#paperOverlay'); await click('#headerBackBtn'); await route('/');
  await click('.icon-1'); await route('/chat');
  await evaluate(`document.querySelector('.archive-input textarea').focus({preventScroll:true});setKeyboard(480);`);
  await sleep(260);
  assert.ok(await evaluate(`document.querySelector('.archive-input').getBoundingClientRect().bottom<=480`),'chat composer follows overlay keyboard geometry');
  await evaluate(`setKeyboard(844);document.activeElement.blur()`);
  console.log('PASS 6px clearance below the lowest visible paper layer, pseudo-element extension, hidden/clipped content exclusion, tall-paper fallback, stable backgrounds and chat composer with both keyboard geometry sources.');
} finally {
  cdp?.close();
  const exited = once(browser, 'exit');
  spawnSync('taskkill.exe', ['/PID', String(browser.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
  await exited;
  await backend.close();
}
