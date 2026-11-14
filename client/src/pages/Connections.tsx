import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { api } from "../api";
import type { Provider, Quota, Subscription } from "../connectionTypes";
import AnimatedText from "../components/AnimatedText";
import Media from "../components/Media";
import { notify } from "../components/Notify";
import { makeStack, type PaperStack } from "../components/paperStack";
import ConnectionLayout, { type TagConfig } from "./ConnectionLayout";
import ApiSheet, { blankDraft, type Draft } from "./ConnectionSheet";

const providers: { id: Provider; name: string; giant: string; art: string; size: number }[] = [
  { id: "codex", name: "Codex", giant: "CODEX", art: "#a4b8c6", size: 96 },
  { id: "gemini", name: "Gemini", giant: "GEMINI", art: "#9cadba", size: 96 },
  { id: "kimi", name: "Kimi", giant: "KIMI", art: "#adbac2", size: 96 },
];
const pad2 = (n: number) => String(n).padStart(2, "0");
type SubState = Subscription & { quota: Quota | null; loaded: boolean; quotaLoading?: boolean };

export default function Connections({ onBack }: { onBack: () => void }) {
  const root = useRef<HTMLElement>(null);
  const subTrack = useRef<HTMLDivElement>(null);
  const apiTrack = useRef<HTMLDivElement>(null);
  const subStack = useRef<PaperStack>(null);
  const apiStack = useRef<PaperStack>(null);
  const [selected, setSelected] = useState("sub");
  const [open, setOpen] = useState<"sub" | "api" | null>(null);
  const [subIndex, setSubIndex] = useState(0);
  const [subscriptions, setSubscriptions] = useState<Record<Provider, SubState>>(() => Object.fromEntries(providers.map(p => [p.id, { loggedIn: false, account: "", plan: "", model: "", quota: null, loaded: false }])) as Record<Provider, SubState>);
  const [presets, setPresets] = useState<Draft[]>([]);
  const [plus, setPlus] = useState<Draft>(blankDraft);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [focus, setFocus] = useState(0);
  const [revision, setRevision] = useState(0);
  const [tag, setTag] = useState<TagConfig | null>(null);
  const [tagVisible, setTagVisible] = useState(false);
  const currentOpen = useRef(open);
  currentOpen.current = open;
  const patchSub = (id: Provider, patch: Partial<SubState>) => setSubscriptions(current => ({ ...current, [id]: { ...current[id], ...patch } }));
  const loadQuota = async (id: Provider) => {
    patchSub(id, { quotaLoading: true });
    try { patchSub(id, { quota: await api.subQuota(id) }); }
    catch (error) { notify.fail("額度讀取失敗", error); }
    finally { patchSub(id, { quotaLoading: false }); }
  };
  useEffect(() => {
    if (open !== "sub") return;
    const id = providers[subIndex].id;
    if (id !== "codex" && subscriptions[id].loaded) return;
    patchSub(id, { loaded: true });
    void api.subStatus(id).then(status => {
      patchSub(id, status);
      if (status.loggedIn) void loadQuota(id);
    }).catch(error => { patchSub(id, { loaded: false }); notify.fail("狀態讀取失敗", error); });
  }, [open, subIndex]);
  useLayoutEffect(() => {
    subStack.current = makeStack(subTrack.current!, setSubIndex);
    apiStack.current = makeStack(apiTrack.current!, () => {});
    subStack.current.update(); apiStack.current.update();
    return () => { subStack.current!.destroy(); apiStack.current!.destroy(); };
  }, []);
  useLayoutEffect(() => {
    apiStack.current!.index = Math.max(0, Math.min(focus, presets.length));
    apiStack.current!.update();
  }, [revision]);
  useEffect(() => {
    const keydown = (event: KeyboardEvent) => {
      if (!currentOpen.current || (event.target as HTMLElement).tagName === "INPUT") return;
      const stack = currentOpen.current === "sub" ? subStack.current! : apiStack.current!;
      if (event.key === "ArrowRight") stack.goTo(stack.index + 1);
      if (event.key === "ArrowLeft") stack.goTo(stack.index - 1);
      if (event.key === "Escape") closeAll();
    };
    document.addEventListener("keydown", keydown);
    return () => { document.removeEventListener("keydown", keydown); document.body.style.overflow = ""; };
  }, []);
  const openStack = (which: "sub" | "api") => {
    root.current!.style.setProperty("--scale", getComputedStyle(root.current!).getPropertyValue("--scale").trim());
    document.body.style.overflow = "hidden";
    setOpen(which);
    if (which === "api") void api.apiPresets().then(data => {
      setPresets(data.presets.map(p => ({ ...p, paperKey: p.id })));
      setPlus(blankDraft()); setActiveId(data.activeId);
      setFocus(Math.max(0, data.presets.findIndex(p => p.id === data.activeId)));
      setRevision(value => value + 1);
    }).catch(error => notify.fail("預設讀取失敗", error));
  };
  function closeAll() {
    setTagVisible(false); (document.activeElement as HTMLElement)?.blur();
    document.body.style.overflow = ""; setOpen(null);
    root.current!.style.removeProperty("--scale");
  }
  const updateFade = () => {
    const list = root.current!.querySelector<HTMLElement>("#tagList")!;
    list.classList.toggle("is-overflow", list.scrollTop + list.clientHeight < list.scrollHeight - 1);
  };
  const fitRoof = () => {
    const line = root.current!.querySelector<SVGTextElement>("#tagRoofLine")!;
    const room = root.current!.querySelector<SVGPathElement>("#roofLine")!.getTotalLength() - 14;
    let size = 6.2; line.setAttribute("font-size", String(size));
    while (line.getComputedTextLength() > room && size > 4) { size -= 0.2; line.setAttribute("font-size", size.toFixed(1)); }
  };
  useEffect(() => {
    let mounted = true;
    void document.fonts.ready.then(() => { if (mounted) fitRoof(); });
    document.fonts.addEventListener("loadingdone", fitRoof);
    return () => { mounted = false; document.fonts.removeEventListener("loadingdone", fitRoof); };
  }, []);
  useLayoutEffect(() => {
    if (!tag) return;
    fitRoof(); root.current!.querySelector("#tagList")!.scrollTop = 0; updateFade();
    const rect = (open === "sub" ? subStack.current! : apiStack.current!).current().getBoundingClientRect();
    const cardH = root.current!.querySelector<HTMLElement>(".tag-card")!.offsetHeight;
    root.current!.querySelector<HTMLElement>("#hangTag")!.style.setProperty("--tag-string", Math.max(20, rect.top + rect.height / 2 - cardH / 2 + 16) + "px");
    setTagVisible(true);
  }, [tag]);
  const account = async (id: Provider) => {
    const state = subscriptions[id];
    if (!state.loggedIn) {
      try { patchSub(id, { ...await api.subLogin(id), loggedIn: true }); notify.ok("已登入"); void loadQuota(id); }
      catch (error) { notify.fail("登入失敗", error); }
      return;
    }
    setTag({ giant: "ACCOUNT", giantY: 121, titleY: 135, kicker: "SIGNED IN", title: "LOGOUT", items: [{ label: state.account, static: true, selected: true }],
      titleAction: () => { void api.subLogout(id).then(() => { patchSub(id, { loggedIn: false, account: "", plan: "", quota: null }); notify.ok("已登出"); }).catch(error => notify.fail("登出失敗", error)); },
    });
  };
  const subModels = async (id: Provider) => {
    try {
      const list = await api.subModels(id);
      setTag({ giant: "MODEL", kicker: "SELECT", title: "模型", items: list.map(m => ({ label: m, value: m, selected: m === subscriptions[id].model })),
        onPick: model => { void api.saveSubConfig(id, { model }).then(() => { patchSub(id, { model }); notify.ok("已保存"); }).catch(error => notify.fail("保存失敗", error)); },
      });
    } catch (error) { notify.fail("模型讀取失敗", error); }
  };
  const rearrange = (index: number) => { setFocus(index); setRevision(value => value + 1); };
  return <ConnectionLayout rootRef={root} subTrackRef={subTrack} apiTrackRef={apiTrack} selected={selected} open={open} onSelect={setSelected} onOpen={openStack} onBack={onBack} onClose={closeAll} tag={tag} tagVisible={tagVisible} onTagClose={() => setTagVisible(false)} onTagScroll={updateFade}
    subPages={providers.map((provider, index) => { const s = subscriptions[provider.id]; return <div className="cover" data-p={provider.id} key={provider.id}>
      <div className="cover-art js-art" style={{ backgroundColor: provider.art }} onClick={e => { if (!(e.target as Element).closest("input")) e.currentTarget.querySelector("input")!.click(); }}><Media storageKey={provider.id} cover /><span className="cover-count">{`${pad2(index + 1)} / ${pad2(providers.length)}`}</span></div>
      <div className="cover-band"><div className="cover-giant" style={{ fontSize: provider.size }}>{provider.giant}</div><div className="cover-band-inner"><div className="cover-title">{provider.name}</div><div className="cover-sub">訂閱連接</div><div className="cover-links">
        <button className="cover-link js-account" type="button" onClick={() => void account(provider.id)}><span className="cover-link-label">ACCOUNT</span><AnimatedText className="cover-link-value js-account-v" text={s.loggedIn ? (s.plan || "SIGNED IN").toUpperCase() : "未登入"} /></button>
        <button className="cover-link js-model" type="button" onClick={() => void subModels(provider.id)}><span className="cover-link-label">MODEL</span><AnimatedText className="cover-link-value js-model-v" text={s.model || "未設定"} /></button>
        <button className="cover-link js-quota" type="button" onClick={() => s.loggedIn ? void loadQuota(provider.id) : notify.note("請先登入")}><span className="cover-link-label">QUOTA</span><AnimatedText className="cover-link-value js-quota-v" text={s.quotaLoading ? "讀取中…" : s.quota ? `剩餘 ${s.quota.left}%` : "—"} /></button>
      </div></div><div className="cover-foot"><AnimatedText className={`cover-status js-status${s.loggedIn ? " is-connected" : ""}`} text={s.loggedIn ? "CONNECTED" : "NOT CONNECTED"} /></div></div>
    </div>; })}
    apiPages={[...presets, plus].map((draft, index) => <ApiSheet key={draft.paperKey} draft={draft} index={index} total={presets.length + 1} activeId={activeId} onTag={setTag}
      onChange={patch => { if (draft.plus) setPlus(current => ({ ...current, ...patch })); else setPresets(current => current.map(p => p.paperKey === draft.paperKey ? { ...p, ...patch } : p)); }}
      onAdd={() => { setPresets(current => [...current, { ...plus, plus: false }]); setPlus(blankDraft()); rearrange(index); }}
      onSave={saved => { if (draft.plus) { setPresets(current => [...current, { ...saved, paperKey: draft.paperKey }]); setPlus(blankDraft()); } else setPresets(current => current.map(p => p.paperKey === draft.paperKey ? { ...saved, paperKey: p.paperKey } : p)); rearrange(index); }}
      onUse={() => setActiveId(draft.id)} onDelete={() => { setPresets(current => current.filter(p => p.paperKey !== draft.paperKey)); if (activeId === draft.id) setActiveId(null); rearrange(index); }} />)}
  />;
}
