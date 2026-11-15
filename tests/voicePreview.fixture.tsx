import { createRoot } from "react-dom/client";
import VoiceTicket from "../client/src/components/VoiceTicket";
import Notify from "../client/src/components/Notify";
import { voicePlayer } from "../client/src/voicePlayer";
import type { VoiceClip } from "../shared/voice.mjs";

const root = createRoot(document.getElementById("root")!);
const fixture = window as any;
fixture.voicePlayer = voicePlayer;
fixture.showVoice = (clip: VoiceClip, fallback?: "failed" | "stopped", id = "voice") => root.render(<>
  <div className="archive-msg-content" style={{ padding: 24 }}>
    <VoiceTicket key={id} clip={clip} fallback={fallback} />
  </div>
  <Notify page="/chat" />
</>);
fixture.showVoice({ url: "", text: "[calm, close] 陪你等天亮。" });
