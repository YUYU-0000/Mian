import { spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import { createServer } from "node:http";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import assert from "node:assert/strict";
import { mp3 } from "./voiceFixtures.mjs";

export const imageBytes = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jP1EAAAAASUVORK5CYII=",
  "base64",
);

// 真实本地后端配合假的服务商和 Codex，不发付费请求。
export async function fileTicketServer({ selection = "", selectionFails = false, rejectTools = false, reply, voice = false, setup = true } = {}) {
  const repository = process.cwd();
  const directory = await mkdtemp(path.join(tmpdir(), "mian-file-tickets-"));
  const workspace = path.join(directory, "workspace");
  const received = [];
  const prompts = [];
  const systemPrompts = [];
  const selections = [];
  const speechRequests = [];
  const provider = createServer(async (request, response) => {
    let body = "";
    for await (const chunk of request) body += chunk;
    const input = JSON.parse(body);
    received.push(input);
    if (rejectTools && input.tools) {
      response.writeHead(400, { "Content-Type": "application/json" });
      response.end(JSON.stringify({ error: { message: "Tools are not supported" } }));
      return;
    }
    if (input.max_tokens === 256) {
      response.writeHead(selectionFails ? 500 : 200, { "Content-Type": "application/json" });
      response.end(JSON.stringify(selectionFails ? { error: { message: "selection failed" } } : { choices: [{ message: { content: selection } }] }));
      return;
    }
    if (input.model === "no-image") {
      response.writeHead(400, { "Content-Type": "application/json" });
      response.end(
        JSON.stringify({
          error: { message: "This model does not support image input" },
        }),
      );
      return;
    }
    response.writeHead(200, { "Content-Type": "text/event-stream" });
    response.end(
      `data: ${JSON.stringify({ choices: [{ delta: { content: reply ?? "<mian-bubble>已收到文件。</mian-bubble>" } }] })}\n\ndata: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: "stop" }] })}\n\ndata: [DONE]\n\n`,
    );
  });
  provider.listen(0, "127.0.0.1");
  await once(provider, "listening");
  await mkdir(path.join(directory, "server/data"), { recursive: true });
  await mkdir(workspace);
  await mkdir(path.join(directory, "downloads"));
  await writeFile(
    path.join(directory, "server/data/config.json"),
    JSON.stringify({
      workingDirectory: workspace,
      sandbox: "workspace-write",
      model: "",
      channel: { kind: "api", presetId: "paper" },
    }),
  );
  await writeFile(
    path.join(directory, "server/data/api-presets.json"),
    JSON.stringify({
      presets: [
        {
          id: "paper",
          note: "附件测试",
          endpoint: `http://127.0.0.1:${provider.address().port}`,
          key: "fake-key",
          model: "file-model",
          format: "openai",
        },
      ],
    }),
  );
  const source = (name) =>
    pathToFileURL(path.join(repository, `server/src/${name}.ts`)).href;
  const bootstrap = `
    import { Server } from 'node:http';
    import { writeFile } from 'node:fs/promises';
    import path from 'node:path';
    import { CodexBridge } from ${JSON.stringify(source("codex"))};
    if (${JSON.stringify(voice)}) {
      const fetchOriginal = globalThis.fetch;
      globalThis.fetch = async (url, init) => {
        if (!String(url).startsWith('https://api.elevenlabs.io/')) return fetchOriginal(url, init);
        if (init.headers['xi-api-key'] === 'reject-key')
          return Response.json({ detail: { status: 'invalid_api_key', message: 'ElevenLabs: invalid API key' } }, { status: 401 });
        if (String(url).includes('/v1/models')) return Response.json([
          {model_id:'eleven_v4',name:'Eleven v4',can_do_text_to_speech:true},
          {model_id:'conversion',name:'Voice conversion',can_do_text_to_speech:false},
        ]);
        if (String(url).includes('/v2/voices')) return Response.json(String(url).includes('next_page_token')
          ? { voices:[{voice_id:'speaker-two',name:'另一個聲音'}],has_more:false }
          : { voices:[{voice_id:'speaker-one',name:'夜晚'}],has_more:true,next_page_token:'next' });
        process.send({ speech: { url, headers: init.headers, body: JSON.parse(init.body) } });
        return new Response(Buffer.from(${JSON.stringify(mp3().toString("base64"))}, 'base64'), { headers: { 'content-type': 'audio/mpeg' } });
      };
    }
    let turn = 0;
    CodexBridge.prototype.connect = async function(config) { this.config = config; return { state:'ready', message:'fake Codex' }; };
    CodexBridge.prototype.forkConversationThread = async function(id) { return { threadId:'fork-'+id+'-'+turn, metadata:{} }; };
    CodexBridge.prototype.selectClues = async function(system, messages) {
      process.send({ selection: { system, messages } });
      if (${JSON.stringify(selectionFails)}) throw new Error('selection failed');
      return ${JSON.stringify(selection)};
    };
    CodexBridge.prototype.startTurn = async function(text, conversationId, clues, protocol) {
      if (typeof clues === 'function') clues = await clues();
      const turnId = 'files-'+(++turn), threadId = 'thread-'+conversationId;
      this.registerConversationThread(conversationId, threadId, true);
      process.send({ prompt:text, clues, protocol });
      this.emit('event', {type:'turn-started',conversationId,turnId});
      setTimeout(async () => {
        await writeFile(path.join(this.config.workingDirectory, conversationId, 'generated.html'), '<h1>local file</h1>');
        await writeFile(path.join(this.config.workingDirectory, conversationId, 'generated.png'), Buffer.from(${JSON.stringify(imageBytes.toString("base64"))}, 'base64'));
        this.emit('event', {type:'assistant-delta',conversationId,turnId,delta:${JSON.stringify(reply ?? "<mian-bubble>文件做好了。</mian-bubble>")}});
        this.emit('event', {type:'turn-completed',conversationId,turnId,status:'completed'});
      }, 80);
      return {conversationId,threadId,turnId};
    };
    const listen = Server.prototype.listen;
    Server.prototype.listen = function(port,...args) {
      if(port===8787) { port=0; this.once('listening',()=>process.send({port:this.address().port})); }
      return listen.call(this,port,...args);
    };
    await import(${JSON.stringify(source("index"))});
  `;
  const backend = spawn(
    process.execPath,
    [
      "--import",
      pathToFileURL(path.join(repository, "node_modules/tsx/dist/loader.mjs"))
        .href,
      "--input-type=module",
      "--eval",
      bootstrap,
    ],
    {
      cwd: directory,
      env: { ...process.env, MIAN_DATA_DIR: path.join(directory, "server/data"), MIAN_WORKSPACE_DIR: workspace },
      windowsHide: true,
      stdio: ["ignore", "ignore", "pipe", "ipc"],
    },
  );
  let logs = "";
  backend.stderr.on("data", (chunk) => {
    logs += chunk;
  });
  const replyProtocols = [];
  backend.on("message", (message) => {
    if (message.prompt) prompts.push(message.prompt);
    if (message.clues !== undefined) systemPrompts.push(message.clues);
    if (message.selection) selections.push(message.selection);
    if (message.speech) speechRequests.push(message.speech);
    if (message.protocol !== undefined) replyProtocols.push(message.protocol);
  });
  const [{ port }] = await Promise.race([
    once(backend, "message"),
    once(backend, "exit").then(() => {
      throw new Error(logs);
    }),
  ]);
  if (setup) {
    const result = await fetch(`http://127.0.0.1:${port}/api/auth/setup`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ password: "fixture-password-only" }) });
    assert.equal(result.status, 200);
  }
  return {
    directory,
    workspace,
    received,
    prompts,
    systemPrompts,
    selections,
    speechRequests,
    replyProtocols,
    base: `http://127.0.0.1:${port}`,
    async close() {
      const exited = once(backend, "exit");
      spawnSync("taskkill.exe", ["/PID", String(backend.pid), "/T", "/F"], {
        windowsHide: true,
        stdio: "ignore",
      });
      await exited;
      provider.closeAllConnections();
      await new Promise((resolve) => provider.close(resolve));
      assert.equal(path.dirname(directory), tmpdir());
      await rm(directory, { recursive: true, force: true });
    },
  };
}
