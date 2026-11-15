import { useState } from "react";
import { createRoot } from "react-dom/client";
import Connections from "../client/src/pages/Connections";
import AnimatedText from "../client/src/components/AnimatedText";
import ChoiceTag from "../client/src/components/ChoiceTag";
import Notify from "../client/src/components/Notify";
import { api } from "../client/src/api";

const state = { model: "sub-a", failModels: false, failSave: false, failTest: false, back: 0, saving: 0, maxSaving: 0 };
const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
const fixture = window as any;
fixture.state = state;
api.subStatus = async () => ({ loggedIn: true, account: "fixture", plan: "plus", model: state.model });
api.subQuota = async () => ({ left: 65, resetAt: "tomorrow" });
api.subModels = async () => { await wait(100); return ["sub-a", "sub-b"]; };
api.saveSubConfig = async (_provider, { model }) => {
  state.maxSaving = Math.max(state.maxSaving, ++state.saving);
  try {
    await wait(140);
    if (state.failSave) throw new Error("Reconnect timed out");
    state.model = model;
  } finally { state.saving--; }
};
const presets = ["first", "second"].map(id => ({ id, note: id, endpoint: "https://fixture.test", model: "api-a", hasKey: true, keyHint: "sk-...", format: "openai" as const }));
api.apiPresets = async () => ({ presets, activeId: "second" });
api.apiModels = async () => {
  await wait(100);
  if (state.failModels) throw new Error("Model request timed out");
  return ["api-a", "api-b"];
};
api.apiTest = async () => { await wait(80); if (state.failTest) throw new Error("Test timed out"); };

function Fixture() {
  const [key, reset] = useState(0);
  const [text, setText] = useState("initial");
  const [probe, showProbe] = useState(true);
  fixture.reset = () => reset(value => value + 1);
  fixture.text = setText;
  fixture.probe = showProbe;
  return <>
    <Connections key={key} channel={{ kind: "api", presetId: "second" }} onBack={() => { state.back++; }} />
    <div id="text-probe">{probe && <AnimatedText text={text} />}</div>
    <ChoiceTag tag={null} tagVisible={false} onTagClose={() => {}} anchor={() => document.body} />
    <Notify page="/connections" />
  </>;
}
createRoot(document.getElementById("root")!).render(<Fixture />);
