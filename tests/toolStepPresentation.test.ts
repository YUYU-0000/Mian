import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { readableToolResult } from "../client/src/chatModel.ts";
import { ToolRow } from "../client/src/pages/Chat.tsx";
import type { ToolEvent } from "../client/src/types.ts";

(globalThis as typeof globalThis & { React: typeof React }).React = React;

function renderTool(tool: ToolEvent, open = false, onToggle = () => {}) {
  const displayedResult = readableToolResult(tool);
  const root = ToolRow({
    tool,
    open,
    animate: false,
    displayedResult,
    streamingResult: false,
    onToggle,
  }) as any;
  const [head, bodyWrap] = root.props.children;
  return { root, head, bodyWrap, displayedResult };
}

const timeTool: ToolEvent = {
  id: "time",
  name: "webSearch",
  detail: "",
  result: "",
  state: "success",
  kind: "webSearch",
  summary: "查询当前时间",
};

const locationTool: ToolEvent = {
  id: "location",
  name: "Get-Location",
  detail: "Path\n----\nC:\\Users\\Example\\Desktop\\Mian",
  result: "Path\n----\nC:\\Users\\Example\\Desktop\\Mian",
  state: "success",
  kind: "commandExecution",
  command: "Get-Location",
  summary: "确认当前目录",
};

test("a completed time-style tool always renders an expandable truthful body", () => {
  const closed = renderTool(timeTool, false);
  assert.match(closed.root.props.className, /tool-step/);
  assert.equal(closed.head.props.role, "button");
  assert.equal(closed.head.props["aria-expanded"], false);
  assert.ok(closed.bodyWrap);
  assert.equal(closed.displayedResult, "工具已完成，无额外输出");

  const opened = renderTool(timeTool, true);
  assert.match(opened.root.props.className, /\bopen\b/);
  assert.equal(opened.head.props["aria-expanded"], true);
  assert.ok(opened.bodyWrap);
});

test("short, long, and working-directory real results all keep a body", () => {
  const short = renderTool({ ...timeTool, result: "09:37" });
  assert.equal(short.displayedResult, "09:37");
  assert.ok(short.bodyWrap);

  const location = renderTool(locationTool);
  assert.match(location.displayedResult, /C:\\Users\\Example\\Desktop\\Mian/);
  assert.ok(location.bodyWrap);

  const longResult = "真实长结果\n" + "不会被截断的内容".repeat(80);
  const long = renderTool({ ...timeTool, result: longResult });
  assert.equal(long.displayedResult, longResult);
  assert.ok(long.bodyWrap);
});

test("the whole step head toggles by click, Enter, and Space without bubbling", () => {
  let toggles = 0;
  let stopped = 0;
  let prevented = 0;
  const { head } = renderTool(timeTool, false, () => {
    toggles += 1;
  });
  head.props.onClick({ stopPropagation: () => { stopped += 1; } });
  assert.equal(toggles, 1);
  assert.equal(stopped, 1);

  for (const key of ["Enter", " "]) {
    head.props.onKeyDown({
      key,
      preventDefault: () => { prevented += 1; },
      stopPropagation: () => { stopped += 1; },
    });
  }
  assert.equal(toggles, 3);
  assert.equal(prevented, 2);
  assert.equal(stopped, 3);

  head.props.onKeyDown({
    key: "ArrowDown",
    preventDefault: () => { prevented += 1; },
    stopPropagation: () => { stopped += 1; },
  });
  assert.equal(toggles, 3);
  assert.equal(prevented, 2);
  assert.equal(stopped, 3);
});

test("two tool rows keep independent stable ids and open state", () => {
  const first = renderTool(timeTool, true);
  const second = renderTool(locationTool, false);
  assert.equal(first.root.props["data-tool-id"], "time");
  assert.equal(second.root.props["data-tool-id"], "location");
  assert.equal(first.head.props["aria-expanded"], true);
  assert.equal(second.head.props["aria-expanded"], false);
});
