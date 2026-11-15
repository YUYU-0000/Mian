import { useState, useSyncExternalStore } from "react";
import { createRoot } from "react-dom/client";
import { ChatSessionStore } from "../client/src/chatSession";
import ChatMessage from "../client/src/pages/ChatMessage";
import { handleCodexNotification } from "../server/src/codexEvents";
import { ConversationRuntimeRegistry } from "../server/src/conversationRuntime";

const session = new ChatSessionStore({ conversationId: "tool-browser" });
const conversations = new ConversationRuntimeRegistry();
conversations.register("tool-browser", "tool-thread");
const calls = new Map<string, string>();
const historicalAnimationIds = new Set<string>();
function Conversation() {
  const snapshot = useSyncExternalStore(session.subscribe, session.getSnapshot);
  const [expanded, setExpanded] = useState(new Set<string>());
  return <main className="archive-chat">
    {snapshot.messages.map((message) => message.role === "assistant" && (
      <ChatMessage key={message.replyGroupId} message={message}
        visual={snapshot.visualReplies[message.replyGroupId] ?? null}
        activeTurnId={snapshot.activeTurnId} historicalAnimationIds={historicalAnimationIds}
        expandedTools={expanded} onToggleTool={(id) => setExpanded((current) => {
          const next = new Set(current);
          if (next.has(id)) next.delete(id); else next.add(id);
          return next;
        })} session={session} />
    ))}
  </main>;
}
(window as any).codexNotification = (method: string, params: object) =>
  handleCodexNotification(conversations, (_name, event) => {
    session.enqueueEvent(event);
    return true;
  }, method, { threadId: "tool-thread", turnId: "tool-turn", ...params }, calls);
createRoot(document.getElementById("root")!).render(<Conversation />);
