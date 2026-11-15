import assert from "node:assert/strict";
import { once } from "node:events";
import test from "node:test";
import { WebSocket } from "ws";
import { parseReply } from "../shared/replyProtocol.mjs";
import { applyReplyEvent, chatHistory, type ReplyGroup } from "../shared/chatModel.mjs";
import { visualTarget } from "../client/src/replyTimeline.ts";
import { previewKind } from "../client/src/filePreview.ts";
import { fileTicketServer } from "./fileTickets.server.mjs";
import { VisibleContent } from "../server/src/providers/visibleContent.ts";

const text = "  完整內容\r\n\r\n\r\n\t<voice>文件中的例子</voice>\r\n<mian-bubble>不是氣泡</mian-bubble>\r\n<mian-thinking>不是心裡話</mian-thinking>\r\n<think>保留源碼</think>\r\n";
const outputs = [
  { name: "說明.txt", content: text, kind: "text" },
  { name: "readme.md", content: "# 文件\n\n正文\n", kind: "markdown" },
  { name: "data.json", content: '{"名字":"魚魚","值":1}\n', kind: "text" },
  { name: "table.csv", content: "名字,數量\r\n魚魚,1\r\n", kind: "text" },
  { name: "page.html", content: '<!doctype html><h1 title="a > b">中文</h1>', kind: "html" },
  { name: "main.ts", content: "export const value = 1;\n", kind: "text" },
];
const reply = '<mian-thinking>寫好了。</mian-thinking><mian-bubble>給你。</mian-bubble>' +
  outputs.map(({ name, content }, index) => `<mian-file name="${name}">${content}</mian-file>${index === 0 ? '<voice>收好。</voice>' : ''}`).join("") +
  '<mian-bubble>都在這。</mian-bubble>';

test("file markers keep exact bytes, nested protocol examples and mixed reply positions", () => {
  const parsed = parseReply(reply, "api", true);
  assert.equal(parsed.thinking, "寫好了。");
  assert.deepEqual(parsed.bubbles, ["給你。", "說明.txt", "收好。", ...outputs.slice(1).map(file => file.name), "都在這。"]);
  assert.deepEqual(parsed.files!.map(({ name, content }) => ({ name, content })), outputs.map(({ name, content }) => ({ name, content })));
  assert.deepEqual(parsed.files!.map(file => file.index), [1, 3, 4, 5, 6, 7]);
  assert.deepEqual(parsed.voices!.map(voice => voice.text), ["收好。"]);
  for (let length = 1; length <= reply.length; length++) {
    const visible = new VisibleContent();
    assert.equal(visible.push('<think>private</think>' + reply.slice(0, length)) + visible.push(reply.slice(length) + '<think>private</think>') + visible.finish(), reply);
    const partial = parseReply(reply.slice(0, length), "api");
    assert.doesNotMatch(partial.bubbles.join("\n"), /完整內容|不是氣泡|<mian-file/);
  }
  const nested = parseReply('<mian-pre-tool><mian-file name="pre.txt">a</mian-file></mian-pre-tool><mian-bubble>前<mian-file name="empty.txt"></mian-file>後</mian-bubble>', "api", true);
  assert.deepEqual(nested.files!.map(({ section, index, content }) => [section, index, content]), [["pre-tool", 0, "a"], ["bubble", 1, ""]]);
  assert.deepEqual(nested.bubbles, ["前", "empty.txt", "後"]);
  const unfinished = parseReply('<mian-file name="partial.txt">未完成', "api", true);
  assert.equal(unfinished.files![0].complete, false);

  const groups = applyReplyEvent([], { type: "assistant-delta", turnId: "reply", format: "api", delta: reply }, "12:00");
  const group = groups[0] as ReplyGroup;
  assert.deepEqual(visualTarget(group).bubbles, ["給你。"]);
  assert.ok(chatHistory(groups)[0].content.includes(text));
});

for (const channel of ["api", "codex"] as const) {
  test(`${channel} delivers real conversation files before completion, with preview and download`, async () => {
    const server = await fileTicketServer({ reply: channel === "api" ? reply : undefined, voice: true });
    const request = async (url: string, method = "GET", body?: unknown) => {
      const response = await fetch(server.base + url, { method, headers: { "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
      assert.ok(response.ok, await response.clone().text());
      return response.json();
    };
    const socket = new WebSocket(server.base.replace("http", "ws") + "/ws");
    await once(socket, "open");
    const events: any[] = [];
    const done = new Promise<void>(resolve => socket.on("message", raw => {
      const event = JSON.parse(String(raw)).event;
      events.push(event);
      if (event?.type === "turn-completed") resolve();
    }));
    try {
      if (channel === "codex") await request("/api/subscriptions/codex/use", "POST", {});
      else {
        await request("/api/voice-presets", "POST", { id: "speech", note: "", key: "fake-key", voice_id: "speaker", model: "eleven_v4", words: "" });
        await request("/api/voice-presets/speech/use", "POST");
      }
      await request("/api/turn", "POST", { conversationId: "c1", text: "發文件給我。" });
      await done;
      const snapshot = await request("/api/conversations/c1/messages");
      const group = snapshot.groups.at(-1) as ReplyGroup;
      assert.equal(group.status, "completed");
      assert.ok(events.findIndex(event => event?.type === "files") < events.findIndex(event => event?.type === "turn-completed"));
      if (channel === "api") {
        assert.equal(group.files!.length, outputs.length);
        for (const [index, file] of group.files!.entries()) {
          const response = await fetch(`${server.base}/api/conversations/c1/files/${file.id}`);
          assert.equal(response.status, 200);
          assert.equal(await response.text(), outputs[index].content);
          assert.match(response.headers.get("content-disposition")!, /^attachment;/);
          assert.equal(previewKind(file, false), outputs[index].kind);
          assert.equal(group.bubbles[group.bubbleIds.indexOf(file.replyBubbleId!)], outputs[index].name);
        }
        assert.ok(group.voices![group.bubbleIds[2]].url);
        assert.match(server.received[0].messages[0].content, /<mian-file name="filename.txt">/);
        assert.equal(JSON.stringify(chatHistory(snapshot.groups)), JSON.stringify(chatHistory((await request("/api/conversations/c1/messages")).groups)));
      } else {
        assert.deepEqual(group.files!.map(file => file.name).sort(), ["generated.html", "generated.png"]);
        const html = group.files!.find(file => file.name === "generated.html")!;
        assert.equal(await (await fetch(`${server.base}/api/conversations/c1/files/${html.id}`)).text(), "<h1>local file</h1>");
        assert.equal(previewKind(html, false), "html");
        assert.match(server.replyProtocols[0], /current conversation's working directory/);
        assert.match(server.replyProtocols[0], /Do not write a Markdown link or paste a file path/);
      }
    } finally {
      socket.close();
      await server.close();
    }
  });
}
