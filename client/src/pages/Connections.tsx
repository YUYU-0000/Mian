import SubscriptionSheet, {
  type SubscriptionProvider,
  type SubscriptionState,
} from "./SubscriptionSheet";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { api } from "../api";
import type { Provider } from "../connectionTypes";
import type { Channel } from "../types";
import { notify } from "../components/Notify";
import { makeStack, type PaperStack } from "../components/paperStack";
import ConnectionLayout from "./ConnectionLayout";
import type { TagConfig } from "../components/ChoiceTag";
import ConnectionSheet from "./ConnectionSheet";
import {
  blankDraft,
  rememberApiPaper,
  removeApiDraft,
  restoreApiDrafts,
  saveApiDraft,
  type Draft,
} from "../apiDrafts";

const providers: SubscriptionProvider[] = [
  { id: "codex", name: "Codex", giant: "CODEX", art: "#a4b8c6", size: 96 },
  { id: "gemini", name: "Gemini", giant: "GEMINI", art: "#9cadba", size: 96 },
  { id: "kimi", name: "Kimi", giant: "KIMI", art: "#adbac2", size: 96 },
];
export default function Connections({
  onBack,
  channel,
}: {
  onBack: () => void;
  channel: Channel;
}) {
  const root = useRef<HTMLElement>(null);
  const subTrack = useRef<HTMLDivElement>(null);
  const apiTrack = useRef<HTMLDivElement>(null);
  const subStack = useRef<PaperStack>(null);
  const apiStack = useRef<PaperStack>(null);
  const [selected, setSelected] = useState("sub");
  const [open, setOpen] = useState<"sub" | "api" | null>(null);
  const [subIndex, setSubIndex] = useState(0);
  const [subscriptions, setSubscriptions] = useState<
    Record<Provider, SubscriptionState>
  >(
    () =>
      Object.fromEntries(
        providers.map((p) => [
          p.id,
          {
            loggedIn: false,
            account: "",
            plan: "",
            model: "",
            quota: null,
            loaded: false,
          },
        ]),
      ) as Record<Provider, SubscriptionState>,
  );
  const [presets, setPresets] = useState<Draft[]>([]);
  const [plus, setPlus] = useState<Draft>(blankDraft);
  const papers = useRef<Draft[]>([]);
  papers.current = [...presets, plus];
  const [activeId, setActiveId] = useState<string | null>(null);
  useEffect(() => {
    setActiveId(channel.kind === "api" ? channel.presetId : null);
  }, [channel]);
  const [focus, setFocus] = useState(0);
  const [revision, setRevision] = useState(0);
  const [tag, updateTag] = useState<TagConfig | null>(null);
  const [tagVisible, setTagVisible] = useState(false);
  const tagSession = useRef(0);
  const modelRequest = useRef(0);
  const modelSave = useRef(Promise.resolve());
  const modelSelection = useRef(0);
  const setTag = (value: TagConfig, session = tagSession.current) => {
    if (session !== tagSession.current || !currentOpen.current) return;
    updateTag(value);
    setTagVisible(true);
  };
  const currentOpen = useRef(open);
  currentOpen.current = open;
  const patchSub = (id: Provider, patch: Partial<SubscriptionState>) =>
    setSubscriptions((current) => ({
      ...current,
      [id]: { ...current[id], ...patch },
    }));
  const loadQuota = async (id: Provider) => {
    patchSub(id, { quotaLoading: true });
    try {
      patchSub(id, { quota: await api.subQuota(id) });
    } catch (error) {
      notify.fail("額度讀取失敗", error);
    } finally {
      patchSub(id, { quotaLoading: false });
    }
  };
  useEffect(() => {
    if (open !== "sub") return;
    const id = providers[subIndex].id;
    if (id !== "codex" && subscriptions[id].loaded) return;
    let active = true;
    const selection = modelSelection.current;
    void modelSave.current
      .then(() => api.subStatus(id))
      .then((status) => {
        if (!active) return;
        const { model, ...account } = status;
        patchSub(id, { ...account, loaded: true, ...(selection === modelSelection.current ? { model } : {}) });
        if (status.loggedIn) void loadQuota(id);
      })
      .catch((error) => {
        if (!active) return;
        patchSub(id, { loaded: false });
        notify.fail("狀態讀取失敗", error);
      });
    return () => { active = false; };
  }, [open, subIndex]);
  useLayoutEffect(() => {
    subStack.current = makeStack(subTrack.current!, setSubIndex);
    apiStack.current = makeStack(apiTrack.current!, (index) => {
      if (currentOpen.current === "api")
        rememberApiPaper(sessionStorage, papers.current[index]);
    });
    return () => {
      subStack.current!.destroy();
      apiStack.current!.destroy();
    };
  }, []);
  useLayoutEffect(() => {
    apiStack.current!.index = Math.max(0, Math.min(focus, presets.length));
    if (currentOpen.current === "api") apiStack.current!.update();
  }, [revision]);
  useLayoutEffect(() => {
    // API 纸片在预设恢复后测量，避免提前把「+」纸记成当前页。
    if (open === "sub") subStack.current!.update();
  }, [open]);
  useEffect(() => {
    const keydown = (event: KeyboardEvent) => {
      if (
        !currentOpen.current ||
        (event.target as HTMLElement).tagName === "INPUT"
      )
        return;
      const stack =
        currentOpen.current === "sub" ? subStack.current! : apiStack.current!;
      if (event.key === "ArrowRight") stack.goTo(stack.index + 1);
      if (event.key === "ArrowLeft") stack.goTo(stack.index - 1);
      if (event.key === "Escape") closeAll();
    };
    document.addEventListener("keydown", keydown);
    return () => {
      document.removeEventListener("keydown", keydown);
      document.body.style.overflow = "";
    };
  }, []);
  const openStack = (which: "sub" | "api") => {
    tagSession.current++;
    root.current!.style.setProperty(
      "--scale",
      getComputedStyle(root.current!).getPropertyValue("--scale").trim(),
    );
    document.body.style.overflow = "hidden";
    setOpen(which);
    if (which === "api")
      void api
        .apiPresets()
        .then((data) => {
          const restored = restoreApiDrafts(
            sessionStorage,
            data.presets,
            data.activeId,
          );
          setPresets(restored.presets);
          setPlus(restored.plus);
          setActiveId(data.activeId);
          setFocus(restored.focus);
          setRevision((value) => value + 1);
        })
        .catch((error) => notify.fail("預設讀取失敗", error));
  };
  function closeAll() {
    tagSession.current++;
    setTagVisible(false);
    (document.activeElement as HTMLElement)?.blur();
    document.body.style.overflow = "";
    setOpen(null);
    root.current!.style.removeProperty("--scale");
  }
  const account = async (id: Provider) => {
    const state = subscriptions[id];
    if (!state.loggedIn) {
      try {
        patchSub(id, { ...(await api.subLogin(id)), loggedIn: true });
        notify.ok("已登入");
        void loadQuota(id);
      } catch (error) {
        notify.fail("登入失敗", error);
      }
      return;
    }
    setTag({
      giant: "ACCOUNT",
      giantY: 121,
      titleY: 135,
      kicker: "SIGNED IN",
      title: "LOGOUT",
      items: [{ label: state.account, static: true, selected: true }],
      titleAction: () => {
        void api
          .subLogout(id)
          .then(() => {
            patchSub(id, {
              loggedIn: false,
              account: "",
              plan: "",
              quota: null,
            });
            notify.ok("已登出");
          })
          .catch((error) => notify.fail("登出失敗", error));
      },
    });
  };
  const subModels = async (id: Provider) => {
    const session = tagSession.current;
    const request = ++modelRequest.current;
    try {
      const list = await api.subModels(id);
      if (request !== modelRequest.current || providers[subStack.current!.index].id !== id) return;
      setTag({
        giant: "MODEL",
        kicker: "SELECT",
        title: "模型",
        items: list.map((m) => ({
          label: m,
          value: m,
          selected: m === subscriptions[id].model,
        })),
        onPick: (model) => {
          modelSelection.current++;
          modelSave.current = modelSave.current
            .then(() => api.saveSubConfig(id, { model }))
            .then(() => {
              patchSub(id, { model });
              notify.ok("已保存");
            })
            .catch((error) => { notify.fail("保存失敗", error); });
        },
      }, session);
    } catch (error) {
      notify.fail("模型讀取失敗", error);
    }
  };
  const useCodex = () => {
    void api
      .useCodex()
      .then(() => {
        setActiveId(null);
        notify.ok("已切換");
      })
      .catch((error) => notify.fail("切換失敗", error));
  };
  const editWorkspace = async () => {
    const session = tagSession.current;
    try {
      const config = await api.getConfig();
      setTag({
        giant: "WORKSPACE",
        kicker: "CODEX",
        title: "工作目錄",
        items: [],
        workspace: {
          value: config.workingDirectory,
          onSave: async (workingDirectory) => {
            try {
              await api.saveConfig({ ...config, workingDirectory });
              setTagVisible(false);
              notify.ok("已保存");
            } catch (error) {
              notify.fail("目錄不能用", error);
            }
          },
        },
      }, session);
    } catch (error) {
      notify.fail("目錄讀取失敗", error);
    }
  };
  const rearrange = (index: number) => {
    setFocus(index);
    setRevision((value) => value + 1);
  };
  return (
    <ConnectionLayout
      rootRef={root}
      subTrackRef={subTrack}
      apiTrackRef={apiTrack}
      selected={selected}
      open={open}
      onSelect={setSelected}
      onOpen={openStack}
      onBack={onBack}
      onClose={closeAll}
      tag={tag}
      tagVisible={tagVisible}
      onTagClose={() => setTagVisible(false)}
      tagAnchor={() => (open === "sub" ? subStack.current! : apiStack.current!).current()}
      subPages={providers.map((provider, index) => (
        <SubscriptionSheet
          key={provider.id}
          provider={provider}
          subscription={subscriptions[provider.id]}
          index={index}
          total={providers.length}
          onUseCodex={useCodex}
          onAccount={account}
          onModels={subModels}
          onQuota={loadQuota}
          onWorkspace={editWorkspace}
        />
      ))}
      apiPages={[...presets, plus].map((draft, index) => (
        <ConnectionSheet
          key={draft.paperKey}
          draft={draft}
          index={index}
          total={presets.length + 1}
          activeId={activeId}
          getTagSession={() => tagSession.current}
          onTag={(value, session) => {
            if (apiStack.current!.current()?.dataset.i === String(index)) setTag(value, session);
          }}
          onChange={(patch) => {
            saveApiDraft(sessionStorage, { ...draft, ...patch });
            if (draft.plus) setPlus((current) => ({ ...current, ...patch }));
            else
              setPresets((current) =>
                current.map((p) =>
                  p.paperKey === draft.paperKey ? { ...p, ...patch } : p,
                ),
              );
          }}
          onAdd={() => {
            saveApiDraft(sessionStorage, { ...plus, plus: false });
            setPresets((current) => [...current, { ...plus, plus: false }]);
            setPlus(blankDraft());
            rearrange(index);
          }}
          onSave={(saved) => {
            removeApiDraft(sessionStorage, draft);
            rememberApiPaper(sessionStorage, {
              ...saved,
              paperKey: draft.paperKey,
            });
            if (draft.plus) {
              setPresets((current) => [
                ...current,
                { ...saved, paperKey: draft.paperKey },
              ]);
              setPlus(blankDraft());
            } else
              setPresets((current) =>
                current.map((p) =>
                  p.paperKey === draft.paperKey
                    ? { ...saved, paperKey: p.paperKey }
                    : p,
                ),
              );
            rearrange(index);
          }}
          onUse={() => setActiveId(draft.id)}
          onDeleteStart={() => removeApiDraft(sessionStorage, draft)}
          onDelete={() => {
            setPresets((current) =>
              current.filter((p) => p.paperKey !== draft.paperKey),
            );
            if (activeId === draft.id) setActiveId(null);
            rearrange(index);
          }}
        />
      ))}
    />
  );
}
