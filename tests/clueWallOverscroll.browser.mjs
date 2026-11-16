// 验证自定义边界回弹的幅度、归零和键盘、操作、导航中断。
import assert from "node:assert/strict";

export async function testWallOverscroll({ call, evaluate, waitFor, click, point, mouse }) {
  const touch = (type, y) => call("Input.dispatchTouchEvent", {
    type, touchPoints: type === "touchEnd" || type === "touchCancel" ? [] : [{ id: 1, x: 8, y }],
  });
  await evaluate(`window.wallProbe={
    wall:document.querySelector('.clues-page .wall'), board:document.querySelector('.clues-page .board'),
    space:document.querySelector('.clues-page .wall-space'),
    rects:()=>Array.from(document.querySelectorAll('.clues-page,.clues-page .head,.clues-page .halo'),e=>e.getBoundingClientRect().toJSON()),
    y:()=>new DOMMatrixReadOnly(getComputedStyle(wallProbe.board).transform).m42
  };wallProbe.space.style.height='1800px';
  wallProbe.wall.scrollTop=0;wallProbe.background=wallProbe.rects();
  wallProbe.height=wallProbe.wall.scrollHeight;
  wallProbe.content=Array.from(wallProbe.board.querySelectorAll('.item,.pins,.threads'),e=>e.getBoundingClientRect().top);`);
  assert.equal(await evaluate("getComputedStyle(wallProbe.wall).overscrollBehavior"), "none");
  const pull = async (distance = 180) => {
    await touch("touchStart", 380);
    await touch("touchMove", 380 + distance);
  };
  const settle = async () => {
    const result = await evaluate(`(async()=>{
      const animation=wallProbe.board.getAnimations()[0], finished=animation.finished;
      const timing=animation.effect.getTiming(), frames=[];
      const sample=()=>{frames.push(wallProbe.y());if(animation.playState==='running')requestAnimationFrame(sample)};
      sample();await finished;await new Promise(requestAnimationFrame);
      return {duration:timing.duration,easing:timing.easing,frames,y:wallProbe.y(),
        style:wallProbe.board.style.transform,top:wallProbe.wall.scrollTop,max:wallProbe.wall.scrollHeight-wallProbe.wall.clientHeight};
    })()`);
    assert.equal(result.duration, 220);
    assert.equal(result.easing, "ease-out");
    assert.equal(result.style, "", "the content transform is removed after returning");
    assert.equal(result.y, 0);
    for (let i = 1; i < result.frames.length; i++) {
      assert.ok(Math.abs(result.frames[i]) <= Math.abs(result.frames[i - 1]) + .01, "return never overshoots or bounces");
      assert.ok(result.frames[i] * result.frames[0] >= 0, "return stays on the pulled side");
    }
    return result;
  };
  await touch("touchStart", 380);
  const offsets = [];
  for (const distance of [60, 120, 180]) {
    await touch("touchMove", 380 + distance);
    offsets.push(await evaluate("wallProbe.y()"));
  }
  assert.ok(offsets[0] > 0 && offsets[2] < 36, `top pull stays between 0 and 36px: ${offsets}`);
  assert.ok(offsets[2] - offsets[1] < offsets[1] - offsets[0], "resistance increases with pull distance");
  const pulled = await evaluate(`({background:wallProbe.rects(),original:wallProbe.background,
    height:wallProbe.wall.scrollHeight,originalHeight:wallProbe.height,x:new DOMMatrixReadOnly(getComputedStyle(wallProbe.board).transform).m41,
    moved:Array.from(wallProbe.board.querySelectorAll('.item,.pins,.threads'),(e,i)=>e.getBoundingClientRect().top-wallProbe.content[i])})`);
  assert.deepEqual(pulled.background, pulled.original, "wallpaper, light, grain and headers stay fixed");
  assert.equal(pulled.height, pulled.originalHeight, "pulling cannot extend the real scroll range");
  assert.equal(pulled.x, 0);
  assert.ok(pulled.moved.every(y => Math.abs(y - offsets[2]) < .01), "cards, portrait, pins and threads move together");
  await touch("touchEnd");
  assert.equal((await settle()).top, 0);

  await evaluate("wallProbe.wall.scrollTop=wallProbe.wall.scrollHeight-wallProbe.wall.clientHeight");
  await pull(-180);
  assert.ok(await evaluate("wallProbe.y()<0 && wallProbe.y()>-36"));
  await touch("touchEnd");
  const bottom = await settle();
  assert.equal(bottom.top, bottom.max);

  await evaluate("wallProbe.wall.scrollTop=300");
  await pull(-60);
  assert.equal(await evaluate("wallProbe.y()"), 0, "ordinary scrolling has no custom displacement");
  await touch("touchEnd");
  assert.equal(await evaluate("wallProbe.board.getAnimations().length"), 0, "releasing inside the wall adds no inertia animation");
  await evaluate(`wallProbe.wall.scrollTop=wallProbe.wall.scrollHeight-wallProbe.wall.clientHeight;
    wallProbe.wall.dispatchEvent(new Event('scroll'));`);
  assert.equal(await evaluate("wallProbe.y()"), 0, "scroll-only arrival at an edge never launches rebound");

  await evaluate("wallProbe.wall.scrollTop=0");
  await pull();
  await evaluate(`{
    const keyboard=navigator.virtualKeyboard;
    if(keyboard){Object.defineProperty(keyboard,'boundingRect',{configurable:true,value:new DOMRect(0,480,390,364)});keyboard.dispatchEvent(new Event('geometrychange'))}
    else{Object.defineProperty(visualViewport,'height',{configurable:true,value:480});visualViewport.dispatchEvent(new Event('resize'))}
  }`);
  assert.equal(await evaluate("wallProbe.y()"), 0, "keyboard opening immediately cancels the pull");
  await touch("touchEnd");
  await evaluate(`{
    const keyboard=navigator.virtualKeyboard;
    if(keyboard){delete keyboard.boundingRect;keyboard.dispatchEvent(new Event('geometrychange'))}
    else{delete visualViewport.height;visualViewport.dispatchEvent(new Event('resize'))}
  }`);

  await pull();
  await touch("touchEnd");
  await evaluate("wallProbe.board.getAnimations()[0].pause()");
  const card = await point('.item.card[data-id="card-3"]');
  await mouse("mousePressed", card);
  assert.equal(await evaluate("wallProbe.y()"), 0, "starting a card gesture cancels the return before measuring the card");
  assert.equal(await evaluate("wallProbe.board.getAnimations().length"), 0);
  await mouse("mouseReleased", card);
  await waitFor(() => evaluate("!!document.querySelector('.sw.show')"), "card editor still opens");
  await click(".done");
  await waitFor(() => evaluate("!document.querySelector('.sw')"), "card editor closes");
  await evaluate("document.querySelector('.mail.is-in')?.click()");

  await pull();
  await click(".clues-back");
  assert.equal(await evaluate("wallProbe.y()"), 0, "leaving the wall immediately resets the content");
  await touch("touchCancel");
  await waitFor(() => evaluate("location.pathname==='/' && !document.querySelector('[data-transition-active=true]')"), "return home");
  assert.equal(await evaluate("wallProbe.board.style.transform"), "", "unmounted content retains no transform");
  await click('.home-app-icon[aria-label="線索"]');
  await waitFor(() => evaluate("location.pathname==='/clues' && !document.querySelector('[data-transition-active=true]') && document.querySelectorAll('.item.card').length===8"), "reopen wall");
  assert.equal(await evaluate("getComputedStyle(document.querySelector('.clues-page .board')).transform"), "none");
  await evaluate("delete window.wallProbe");
  console.log("PASS custom wall edge pull: fixed background, 36px cap, 220ms return, real boundaries and gesture/keyboard/navigation cancellation.");
}
