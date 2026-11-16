import { createRoot } from "react-dom/client";
import Chat from "../client/src/pages/Chat";
import { ChatSessionStore } from "../client/src/chatSession";
import { api } from "../client/src/api";
import { INITIAL_AVATAR_CROP, saveAvatar } from "../client/src/avatars";
import type { ChatFile, ConversationRecord } from "../client/src/types";

const canvas = document.createElement("canvas");
canvas.width = canvas.height = 48;
const context = canvas.getContext("2d")!;
context.fillStyle = "#6b8396";
context.fillRect(0, 0, 48, 48);
const png = await new Promise<Blob>(resolve => canvas.toBlob(blob => resolve(blob!), "image/png"));
let decodedAvatars = 0;
const decode = HTMLImageElement.prototype.decode;
HTMLImageElement.prototype.decode = async function () { await decode.call(this); decodedAvatars++; };
let resolveSend: (value: { turnId: string }) => void;
let rejectSend: (error: Error) => void;
const session = new ChatSessionStore({
  conversationId: "feedback", nowLabel: () => "10:20",
  apiClient: { send: () => new Promise((resolve, reject) => { resolveSend = resolve; rejectSend = reject; }), stop: async () => {} },
});
const uploads: { file: File; progress: (value: number) => void; finish: (file: ChatFile) => void }[] = [];
api.uploadFile = (_id, file, progress) => new Promise(finish => { uploads.push({ file, progress, finish }); });
const conversation: ConversationRecord = {
  conversationId: "feedback", threadId: null, parentConversationId: null,
  rootNumber: 1, branchPath: [], branchCounter: 0, abbr: "C-01", title: "ARCHIVE CHAT", frontName: "Mian", image: "", pinned: true,
  model: null, reasoningEffort: null, totalTokens: null, uncachedTotalTokens: null, lastActivityAt: null, lastMessage: null, collaborationMode: null,
  createdAt: new Date(0).toISOString(), updatedAt: new Date(0).toISOString(),
};
const noop = () => {};
await saveAvatar("assistant", { file: png, crop: INITIAL_AVATAR_CROP });
createRoot(document.getElementById("root")!).render(<Chat
  session={session} conversations={[conversation]} activeConversationId="feedback" displayedConversation={conversation}
  onBack={noop} onSelectConversation={noop} onCreateConversation={async () => conversation}
  onForkConversation={async () => null} onUpdateConversation={async () => conversation}
  canArchiveConversation={() => false} onArchiveConversation={async () => {}} onArchivedConversation={noop}
  conversationTransition={null} onConversationSwitchEnd={noop} onRegisterFrameCapture={noop}
  initialDraft="" initialScrollTop={null} onViewStateChange={noop}
/>);
(window as any).feedback = {
  decodedAvatars: () => decodedAvatars,
  idle: () => session.getSnapshot().turnPhase === "idle",
  begin: () => { session.saveUserRecord("等你回来"); void session.startPendingTurn(); },
  resolve: () => resolveSend({ turnId: "reply" }),
  reject: () => rejectSend(new Error("fixture request failed")),
  event: (event: any) => session.enqueueEvent(event),
  addFiles: () => session.attachments.add([new File(["attachment"], "notes.txt", { type: "text/plain" }), new File([png], "photo.png", { type: "image/png" })], () => {}),
  progress: (value: number) => uploads.forEach(upload => upload.progress(value)),
  uploaded: () => uploads.forEach((upload, index) => upload.finish({ id: `file-${index}`, name: upload.file.name, mimeType: upload.file.type, size: upload.file.size, createdAt: new Date().toISOString() })),
};
