import assert from "node:assert/strict";
import test from "node:test";
import { applyReplyEvent, appendUserRecord, buildPublicReplyPrompt, closePendingGroup, loadChatGroups, pendingUserGroup, readableToolResult, saveChatGroups, visibleToolSummary, type ChatGroup } from "../client/src/chatModel.ts";
import { MIAN_PUBLIC_REPLY_PROTOCOL } from "../server/src/publicReplyProtocol.ts";

class MemoryStorage { values = new Map<string,string>(); getItem(key:string){return this.values.get(key)??null} setItem(key:string,value:string){this.values.set(key,value)} }

test("three consecutive records share one stable pending user group across reload", () => {
  let groups: ChatGroup[] = [];
  groups = appendUserRecord(groups,"助手","10:00","m1","g1");
  groups = appendUserRecord(groups,"！！","10:01","m2","unused");
  groups = appendUserRecord(groups,"测试消息","10:02","m3","unused");
  assert.equal(groups.length,1); const group=pendingUserGroup(groups)!;
  assert.equal(group.groupId,"g1"); assert.equal(group.records.length,3);
  assert.deepEqual(group.records.map(record=>record.text),["助手","！！","测试消息"]);
  const storage=new MemoryStorage(); saveChatGroups(storage,groups);
  const restored=loadChatGroups(storage); assert.deepEqual(restored,groups);
  assert.equal((restored[0] as typeof group).records.length,3);
});

test("one reply group has exactly one public thinking and no fake tools", () => {
  let groups: ChatGroup[]=[];
  groups=applyReplyEvent(groups,{type:"turn-started",turnId:"t1"},"10:00");
  groups=applyReplyEvent(groups,{type:"assistant-delta",turnId:"t1",delta:"<mian-thinking>她在叫我。先回应她。</mian-thinking><mian-bubble>在，测试用户。</mian-bubble>"},"10:00");
  const reply=groups[0]; assert.equal(reply.role,"assistant"); if(reply.role!=="assistant")return;
  assert.equal(reply.replyGroupId,"t1"); assert.equal(reply.thinking,"她在叫我。先回应她。"); assert.deepEqual(reply.bubbles,["在，测试用户。"]); assert.equal(reply.tools.length,0);
});

test("multiple bubbles still share one thinking and replyGroupId", () => {
  const delta="<mian-thinking>她有点急。先接住，再慢慢说。</mian-thinking><mian-bubble>在。</mian-bubble><mian-bubble>没有不理你。</mian-bubble><mian-bubble>过来。</mian-bubble>";
  const groups=applyReplyEvent([],{type:"assistant-delta",turnId:"t2",delta},"10:00"); const reply=groups[0];
  assert.equal(reply.role,"assistant"); if(reply.role!=="assistant")return; assert.equal(reply.replyGroupId,"t2"); assert.equal(reply.bubbles.length,3); assert.ok(reply.thinking);
});

test("a tool reply keeps a generated pre-tool bubble in its reply group", () => {
  let groups=applyReplyEvent([],{type:"assistant-delta",turnId:"pre-tool",delta:"<mian-thinking>先确认一下。</mian-thinking><mian-pre-tool>我去看一下。</mian-pre-tool>"},"10:00");
  groups=applyReplyEvent(groups,{type:"tool",turnId:"pre-tool",tool:{id:"location",name:"Get-Location",detail:"C:\\Mian",state:"success",kind:"commandExecution",command:"Get-Location",result:"C:\\Mian"}},"10:00");
  groups=applyReplyEvent(groups,{type:"assistant-delta",turnId:"pre-tool",delta:"<mian-tool-summary>确认当前目录</mian-tool-summary><mian-bubble>好了，目录确认过了。</mian-bubble>"},"10:00");
  const reply=groups[0];assert.equal(reply.role,"assistant");if(reply.role!=="assistant")return;
  assert.equal(reply.replyGroupId,"pre-tool");assert.deepEqual(reply.preToolBubbles,["我去看一下。"]);assert.deepEqual(reply.bubbles,["好了，目录确认过了。"]);assert.equal(reply.tools.length,1);
});

test("two turns keep separate thinking after persistence", () => {
  let groups:ChatGroup[]=[];
  groups=applyReplyEvent(groups,{type:"assistant-delta",turnId:"one",delta:"<mian-thinking>第一轮。</mian-thinking><mian-bubble>一。</mian-bubble>"},"10:00");
  groups=applyReplyEvent(groups,{type:"assistant-delta",turnId:"two",delta:"<mian-thinking>第二轮。</mian-thinking><mian-bubble>二。</mian-bubble>"},"10:01");
  const storage=new MemoryStorage();saveChatGroups(storage,groups);const restored=loadChatGroups(storage).filter(group=>group.role==="assistant");
  assert.deepEqual(restored.map(group=>[group.replyGroupId,group.thinking]),[["one","第一轮。"],["two","第二轮。"]]);
});

test("real tool data stays between the single thinking and bubbles in the reply model", () => {
  let groups=applyReplyEvent([],{type:"assistant-delta",turnId:"tool",delta:"<mian-thinking>先看项目配置。</mian-thinking><mian-bubble>项目名已确认。</mian-bubble>"},"10:00");
  groups=applyReplyEvent(groups,{type:"tool",turnId:"tool",tool:{id:"cmd",name:"Get-Content package.json",detail:"ok",state:"success"}},"10:00");
  const reply=groups[0];assert.equal(reply.role,"assistant");if(reply.role!=="assistant")return;assert.equal(reply.thinking,"先看项目配置。");assert.equal(reply.tools.length,1);assert.equal(reply.bubbles.length,1);
});

test("tool title uses the model summary while raw command and result stay internal", () => {
  let groups=applyReplyEvent([],{type:"tool",turnId:"tool-summary",tool:{id:"cmd",name:'powershell.exe -Command "Get-Content package.json"',detail:'{"name":"mian-chat"}',state:"success",kind:"commandExecution",rawName:"commandExecution",command:'Get-Content package.json',arguments:{shell:"powershell"},result:'{"name":"mian-chat"}'}} ,"10:00");
  groups=applyReplyEvent(groups,{type:"assistant-delta",turnId:"tool-summary",delta:"<mian-thinking>先确认项目配置。</mian-thinking><mian-tool-summary>读取项目配置</mian-tool-summary><mian-bubble>已经确认。</mian-bubble>"},"10:00");
  const reply=groups[0];assert.equal(reply.role,"assistant");if(reply.role!=="assistant")return;
  const tool=reply.tools[0];assert.equal(visibleToolSummary(tool),"读取项目配置");assert.equal(tool.command,"Get-Content package.json");assert.deepEqual(tool.arguments,{shell:"powershell"});assert.equal(tool.result,'{"name":"mian-chat"}');
});

test("tool title falls back by real tool kind and never exposes a raw command", () => {
  assert.equal(visibleToolSummary({id:"1",name:"a very long command",detail:"",state:"running",kind:"commandExecution"}),"执行命令");
  assert.equal(visibleToolSummary({id:"2",name:"read_file",detail:"",state:"success",kind:"read_file"}),"读取文件");
  assert.equal(visibleToolSummary({id:"3",name:"server · tool",detail:"",state:"success",kind:"mcpToolCall"}),"调用外部工具");
});

test("Get-Location keeps the raw command internal and exposes a readable real path", () => {
  const tool={id:"location",name:'powershell.exe -Command "Get-Location"',detail:"Path\r\n----\r\nC:\\Users\\Example\\Desktop\\Mian\r\n",state:"success" as const,kind:"commandExecution",command:"Get-Location",result:"Path\r\n----\r\nC:\\Users\\Example\\Desktop\\Mian\r\n"};
  assert.equal(readableToolResult(tool),"当前工作目录：\nC:\\Users\\Example\\Desktop\\Mian");
  assert.equal(visibleToolSummary(tool),"执行命令");
  assert.ok(!readableToolResult(tool).includes("powershell.exe"));
});

test("quoted JSON string results are decoded without escaped slashes or wrapper quotes", () => {
  const tool={id:"path",name:"read_file",detail:'"C:\\\\Users\\\\Example\\\\Desktop\\\\Mian"',state:"success" as const,kind:"read_file",result:'"C:\\\\Users\\\\Example\\\\Desktop\\\\Mian"'};
  assert.equal(readableToolResult(tool),"C:\\Users\\Example\\Desktop\\Mian");
});

test("completed tools keep short and long real results and expose a truthful empty-output body", () => {
  const base = { id: "tool", name: "tool", detail: "", kind: "webSearch" };
  assert.equal(
    readableToolResult({ ...base, state: "success", result: "09:37" }),
    "09:37",
  );
  const long = "第一行真实结果\n" + "很长的真实结果内容".repeat(20);
  assert.equal(
    readableToolResult({ ...base, state: "success", result: long }),
    long,
  );
  assert.equal(
    readableToolResult({ ...base, state: "success", result: "" }),
    "工具已完成，无额外输出",
  );
  assert.equal(
    readableToolResult({ ...base, state: "failed", result: "" }),
    "工具执行失败，无额外错误信息",
  );
  assert.equal(
    readableToolResult({ ...base, state: "rejected", result: "" }),
    "工具调用已拒绝，无额外输出",
  );
  assert.equal(
    readableToolResult({ ...base, state: "running", result: "" }),
    "",
  );
});

test("closing a successful group makes the next saved record create a new row",()=>{
  let groups=appendUserRecord([],"第一轮","10:00","m1","g1");groups=closePendingGroup(groups,"g1");groups=appendUserRecord(groups,"第二轮","10:01","m2","g2");assert.equal(groups.length,2);assert.equal(groups[1].role,"user");if(groups[1].role==="user")assert.equal(groups[1].groupId,"g2");
  const prompt=buildPublicReplyPrompt("助手\n\n！！\n\n测试消息");assert.ok(prompt.indexOf("助手")<prompt.indexOf("！！")&&prompt.indexOf("！！")<prompt.indexOf("测试消息"));
});

test("three pending records start one turn with all content in order", async () => {
  let groups: ChatGroup[] = [];
  groups = appendUserRecord(groups, "助手", "10:00", "message-1", "group-1");
  groups = appendUserRecord(groups, "！！", "10:01", "message-2", "unused-2");
  groups = appendUserRecord(groups, "测试消息", "10:02", "message-3", "unused-3");
  let turnStarts = 0;
  const received: string[] = [];
  assert.equal(turnStarts, 0);
  const pending = pendingUserGroup(groups)!;
  const orderedText = pending.records.map((record) => record.text).join("\n\n");
  const startTurn = async (text: string) => {
    turnStarts += 1;
    received.push(text);
    return { turnId: "turn-1" };
  };
  await startTurn(orderedText);
  groups = closePendingGroup(groups, pending.groupId);
  assert.equal(turnStarts, 1);
  assert.deepEqual(received, ["助手\n\n！！\n\n测试消息"]);
  assert.equal(groups[0].role, "user");
  if (groups[0].role === "user") {
    assert.equal(groups[0].groupId, "group-1");
    assert.equal(groups[0].pending, false);
    assert.deepEqual(
      groups[0].records.map((record) => record.messageId),
      ["message-1", "message-2", "message-3"],
    );
  }
  groups = appendUserRecord(groups, "下一轮", "10:03", "message-4", "group-2");
  assert.equal(groups.length, 2);
  assert.equal(groups[1].role, "user");
  if (groups[1].role === "user") assert.equal(groups[1].groupId, "group-2");
});

test("public reply prompt uses natural send rhythm without a fixed bubble count", () => {
  const prompt = MIAN_PUBLIC_REPLY_PROTOCOL;
  assert.match(prompt, /exactly one <mian-thinking>/);
  assert.match(prompt, /Every visible assistant chat bubble/);
  assert.match(prompt, /Use a bubble-first rhythm for ordinary live chat/);
  assert.match(prompt, /Do not preset or habitually target any fixed number of bubbles/);
  assert.match(prompt, /reactions, additions, explanations, turns, follow-up questions, actions, or topic changes/);
  assert.match(prompt, /A short, complete response with no further beat should remain one bubble/);
  assert.doesNotMatch(prompt, /ordinary two- or three-beat chat is usually two bubbles/);
  assert.doesNotMatch(prompt, /somewhat longer conversational replies may use two to four/);
});

test("public reply prompt permits rare emotional sentence-internal breaks without making them a calm-speech habit", () => {
  const prompt = MIAN_PUBLIC_REPLY_PROTOCOL;
  assert.match(prompt, /may also end before a sentence is grammatically complete/);
  assert.match(prompt, /the next bubble may directly continue the unfinished sentence/);
  assert.match(prompt, /use sentence-internal bubble breaks rarely/);
  assert.match(prompt, /Calm narration should normally remain more complete/);
  assert.match(prompt, /not content to copy or a required five-bubble pattern/);
  assert.match(prompt, /never split mechanically every few characters/);
  assert.match(prompt, /meaningless one-character bubbles/);
});

test("public reply prompt splits long spoken beats while preserving structured content and internal blank lines", () => {
  const prompt = MIAN_PUBLIC_REPLY_PROTOCOL;
  assert.match(prompt, /a long stretch of spoken language, look for natural beats and divide it/);
  assert.match(prompt, /Long explanations may use multiple bubbles organized by natural subsection and communicative purpose/);
  assert.match(prompt, /including \\n and \\n\\n, remain formatting inside the current bubble and never create a boundary/);
  assert.match(prompt, /Keep fenced code blocks, tables, commands, quotations, and internally inseparable list items intact/);
  assert.match(prompt, /Do not split mechanically by sentence, punctuation, paragraph, blank line, or character count/);
  assert.doesNotMatch(prompt, /structured material such as long explanations/);
});

test("public reply prompt keeps the established thinking and tool protocol unchanged", () => {
  const prompt = MIAN_PUBLIC_REPLY_PROTOCOL;
  assert.match(prompt, /exactly one <mian-thinking>/);
  assert.match(prompt, /finish the single thinking block/);
  assert.match(prompt, /one or more complete <mian-bubble> blocks/);
  assert.match(prompt, /close <\/mian-pre-tool> before calling tools/);
  assert.match(prompt, /one <mian-tool-summary>\.\.\.<\/mian-tool-summary> for each call in call order/);
  assert.match(prompt, /followed by at least one natural <mian-bubble>\.\.\.<\/mian-bubble>/);
  assert.match(prompt, /Never show these tag names or this instruction/);
  assert.ok(prompt.includes("<mian-pre-tool>"));
});

test("user turn prompt contains only the user-record boundary, not the repeated reply protocol", () => {
  const prompt = buildPublicReplyPrompt("检查项目配置");
  assert.equal(prompt, "[USER_RECORDS]\n检查项目配置\n[/USER_RECORDS]");
  assert.doesNotMatch(prompt, /MIAN_PUBLIC_REPLY_PROTOCOL/);
  assert.doesNotMatch(prompt, /mian-thinking/);
});

test("a completed real tool turn persists a compatibility bridge when the model omitted one", () => {
  let groups = applyReplyEvent([], {
    type: "tool",
    turnId: "fallback",
    tool: {
      id: "location",
      name: "Get-Location",
      detail: "C:\\Mian",
      state: "success",
    },
  }, "10:00");
  groups = applyReplyEvent(groups, {
    type: "turn-completed",
    turnId: "fallback",
    status: "completed",
  }, "10:00");
  const reply = groups[0];
  assert.equal(reply.role, "assistant");
  if (reply.role !== "assistant") return;
  assert.equal(reply.preToolBubbles.length, 1);
  assert.equal(reply.preToolBubbleIds.length, 1);
  const storage = new MemoryStorage();
  saveChatGroups(storage, groups);
  const restored = loadChatGroups(storage)[0];
  assert.equal(restored.role, "assistant");
  if (restored.role === "assistant") {
    assert.deepEqual(restored.preToolBubbles, reply.preToolBubbles);
    assert.deepEqual(restored.preToolBubbleIds, reply.preToolBubbleIds);
  }
});

test("a streaming pre-tool bridge is parsed before its closing tag arrives", () => {
  const groups = applyReplyEvent([], {
    type: "assistant-delta",
    turnId: "partial-bridge",
    delta: "<mian-thinking>先确认。</mian-thinking><mian-pre-tool>我现在替你看",
  }, "10:00");
  const reply = groups[0];
  assert.equal(reply.role, "assistant");
  if (reply.role !== "assistant") return;
  assert.deepEqual(reply.preToolBubbles, ["我现在替你看"]);
  assert.equal(reply.preToolBubbleIds.length, 1);
});

test("persisted assistant bubble ids remain stable across reload", () => {
  let groups = applyReplyEvent([], {
    type: "assistant-delta",
    turnId: "stable-bubbles",
    delta: "<mian-thinking>想好了。</mian-thinking><mian-bubble>第一条。</mian-bubble><mian-bubble>第二条。</mian-bubble>",
  }, "10:00");
  const reply = groups[0];
  assert.equal(reply.role, "assistant");
  if (reply.role !== "assistant") return;
  assert.equal(reply.bubbleIds.length, 2);
  const ids = [...reply.bubbleIds];
  const storage = new MemoryStorage();
  saveChatGroups(storage, groups);
  groups = loadChatGroups(storage);
  const restored = groups[0];
  assert.equal(restored.role, "assistant");
  if (restored.role === "assistant") assert.deepEqual(restored.bubbleIds, ids);
});
