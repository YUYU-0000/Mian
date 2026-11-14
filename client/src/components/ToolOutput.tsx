import { useState } from "react";

export default function ToolOutput({
  command,
  result,
  streaming,
}: {
  command?: string;
  result: string;
  streaming: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const text = [command, result].filter(Boolean).join("\n\n");
  const lines = text.split(/\r?\n/);
  const long = lines.length > 6;
  return (
    <>
      <pre className="archive-tool-output">
        {expanded ? text : lines.slice(0, 6).join("\n")}
        {streaming && (!long || expanded) && <span className="cursor-blink" />}
      </pre>
      {long && (
        <button
          type="button"
          className="archive-tool-more"
          aria-expanded={expanded}
          onClick={() => setExpanded((value) => !value)}
        >
          {expanded ? "收起" : "展開全部"}
        </button>
      )}
    </>
  );
}
