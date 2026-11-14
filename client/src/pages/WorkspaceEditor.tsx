import { useState } from "react";

export default function WorkspaceEditor({
  value,
  onSave,
}: {
  value: string;
  onSave: (directory: string) => Promise<void>;
}) {
  const [directory, setDirectory] = useState(value);
  return (
    <form
      className="workspace-editor"
      onSubmit={(event) => {
        event.preventDefault();
        void onSave(directory.trim());
      }}
    >
      <textarea
        aria-label="工作目錄"
        spellCheck={false}
        value={directory}
        onChange={(event) => setDirectory(event.target.value)}
      />
      <button className="tag-option" type="submit">
        保存
      </button>
    </form>
  );
}
