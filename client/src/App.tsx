import { useRouteTransition } from "./useRouteTransition";
import { lazy, Suspense, useCallback, useEffect, useRef, useState } from "react";
import { Route, Routes, useLocation } from "react-router-dom";
import { api } from "./api";
import { applyBubbleFont } from "./bubbleFont";
import { loadAvatars } from "./avatars";
import {
  hasCompletedConversation,
  lastVisibleMessageSummary,
} from "./chatSession";
import { ConversationSessions } from "./conversationSessions";
import type {
  Channel,
  ConnectionStatus,
  Config,
  ConversationActivity,
  ConversationRecord,
} from "./types";
import Home from "./pages/Home";
import Notify, { notify } from "./components/Notify";
import { preloadReplyMarkdown } from "./components/DeferredReplyMarkdown";
import ErrorBoundary from "./ErrorBoundary";
import { isTicketArchiveEligible } from "./ticketGestures";
import {
  resolveAvailableConversationId,
  upsertConversation,
} from "./conversationState";
import type { FrozenConversationFrame } from "./conversationTransition";
import {
  pagePreloads,
  preloadChat,
  preloadClues,
  preloadConnections,
  preloadSettings,
} from "./pagePreloads";

const Chat = lazy(preloadChat);
const Clues = lazy(preloadClues);
const Connections = lazy(preloadConnections);
const Settings = lazy(preloadSettings);

const initial: ConnectionStatus = {
  state: "not-connected",
  message: "尚未连接",
};
const DEFAULT_CONVERSATION_ID = "c1";
const ACTIVE_CONVERSATION_KEY = "mian.active-conversation.v1";
function cacheActiveConversation(id: string) {
  try { localStorage.setItem(ACTIVE_CONVERSATION_KEY, id); }
  catch { /* 浏览器偏好存不下时仍可切换服务器上的会话。 */ }
}
const defaultConversation: ConversationRecord = {
  conversationId: DEFAULT_CONVERSATION_ID,
  threadId: null,
  parentConversationId: null,
  rootNumber: 1,
  branchPath: [],
  branchCounter: 0,
  abbr: "C-01",
  title: "ARCHIVE CHAT",
  frontName: "Mian",
  image: "",
  pinned: true,
  model: null,
  reasoningEffort: null,
  totalTokens: null,
  uncachedTotalTokens: null,
  lastActivityAt: null,
  lastMessage: null,
  collaborationMode: null,
  createdAt: new Date(0).toISOString(),
  updatedAt: new Date(0).toISOString(),
};
type ConversationSwitch = {
  outgoingFrame: FrozenConversationFrame;
  generation: number;
  latestTargetConversationId: string;
  latestGeneration: number;
};
type ConversationViewState = {
  draft: string;
  scrollTop: number;
};

export default function App() {
  const { location, transition, navigateWithTransition, handleTransitionEnd } =
    useRouteTransition();
  useEffect(() => {
    const stopFonts = api.fontPresets.watch(applyBubbleFont);
    void loadAvatars().catch((error) => notify.fail("頭像讀取失敗", error));
    if (sessionStorage.getItem("mian.imported")) {
      sessionStorage.removeItem("mian.imported");
      notify.ok("已導入");
    }
    return stopFonts;
  }, []);
  useEffect(() => {
    if (location.pathname !== "/") return;
    const preload = async () => {
      for (const preloadPage of Object.values(pagePreloads)) await preloadPage();
      void preloadReplyMarkdown();
    };
    if (typeof window.requestIdleCallback === "function") {
      const idle = window.requestIdleCallback(preload);
      return () => window.cancelIdleCallback(idle);
    }
    const timer = window.setTimeout(preload, 1500);
    return () => window.clearTimeout(timer);
  }, [location.pathname]);
  const [status, setStatus] = useState(initial);
  const [channel, setChannel] = useState<Channel>({
    kind: "codex",
    name: "CODEX",
  });
  useEffect(() => {
    let config: Config | undefined;
    let names = new Map<string, string>();
    const update = () => {
      if (!config) return;
      const selected = config.channel ?? { kind: "codex" };
      setChannel({ ...selected, name: selected.kind === "api" ? names.get(selected.presetId) ?? "API" : "CODEX" });
    };
    const stopConfig = api.getConfig.watch(value => { config = value; update(); });
    const stopPresets = api.apiPresets.watch(value => {
      names = new Map(value.presets.map(preset => [preset.id, preset.note]));
      update();
    });
    return () => { stopConfig(); stopPresets(); };
  }, []);
  const [conversations, setConversations] = useState<ConversationRecord[]>([
    defaultConversation,
  ]);
  const [activeConversationId, setActiveConversationId] = useState(
    () =>
      localStorage.getItem(ACTIVE_CONVERSATION_KEY) || DEFAULT_CONVERSATION_ID,
  );
  const [displayedConversationId, setDisplayedConversationId] = useState(
    () =>
      localStorage.getItem(ACTIVE_CONVERSATION_KEY) || DEFAULT_CONVERSATION_ID,
  );
  const [conversationSwitch, setConversationSwitch] =
    useState<ConversationSwitch | null>(null);
  const conversationSwitchGeneration = useRef(0);
  const conversationSwitchRef = useRef<ConversationSwitch | null>(null);
  const captureConversationFrameRef = useRef<
    (() => FrozenConversationFrame | null) | null
  >(null);
  const registerConversationFrameCapture = useCallback(
    (capture: (() => FrozenConversationFrame | null) | null) => {
      captureConversationFrameRef.current = capture;
    },
    [],
  );
  const displayedConversationIdRef = useRef(displayedConversationId);
  const conversationsRef = useRef(conversations);
  const conversationViewStates = useRef(
    new Map<string, ConversationViewState>(),
  );
  const archivedStoresPendingRelease = useRef(new Set<string>());
  conversationsRef.current = conversations;
  displayedConversationIdRef.current = displayedConversationId;
  conversationSwitchRef.current = conversationSwitch;
  const activityTimersRef = useRef(new Map<string, number>());
  const activityTargetsRef = useRef(new Map<string, ConversationActivity>());
  const activityViewTargets = useRef(new Map<string, ConversationActivity>());
  const activityViewTimer = useRef<number | null>(null);
  const recordConversationActivity = useCallback(
    (conversationId: string, patch: ConversationActivity) => {
      // 票根摘要每 100ms 合并更新，不让每条流式事件重画整页。
      activityViewTargets.current.set(conversationId, {
        ...activityViewTargets.current.get(conversationId),
        ...patch,
      });
      if (activityViewTimer.current === null)
        activityViewTimer.current = window.setTimeout(() => {
          const updates = activityViewTargets.current;
          activityViewTargets.current = new Map();
          activityViewTimer.current = null;
          setConversations((current) =>
            current.map((conversation) => {
              const activity = updates.get(conversation.conversationId);
              return activity ? { ...conversation, ...activity } : conversation;
            }),
          );
        }, 100);
      activityTargetsRef.current.set(conversationId, {
        ...activityTargetsRef.current.get(conversationId),
        ...patch,
      });
      const previous = activityTimersRef.current.get(conversationId);
      if (previous) window.clearTimeout(previous);
      activityTimersRef.current.set(
        conversationId,
        window.setTimeout(() => {
          activityTimersRef.current.delete(conversationId);
          const target = activityTargetsRef.current.get(conversationId);
          activityTargetsRef.current.delete(conversationId);
          if (!target) return;
          void api
            .updateConversationActivity(conversationId, target)
            .then(({ conversation }) =>
              setConversations((current) =>
                current.map((item) =>
                  item.conversationId === conversationId ? conversation : item,
                ),
              ),
            )
            .catch(console.error);
        }, 250),
      );
    },
    [],
  );
  const conversationSessionsRef = useRef<ConversationSessions | null>(null);
  if (!conversationSessionsRef.current)
    conversationSessionsRef.current = new ConversationSessions({
      initialConversationIds: [DEFAULT_CONVERSATION_ID, activeConversationId],
      onActivity: recordConversationActivity,
      onSendError: (error) => notify.fail("發送失敗", error),
    });
  const conversationSessions = conversationSessionsRef.current;
  const chatSession = conversationSessions.get(displayedConversationId);
  const displayedConversationRecordRef = useRef(defaultConversation);
  const displayedConversation =
    conversations.find(
      (conversation) => conversation.conversationId === displayedConversationId,
    ) ?? displayedConversationRecordRef.current;
  if (displayedConversation.conversationId === displayedConversationId)
    displayedConversationRecordRef.current = displayedConversation;
  const applyConversationFallback = (
    records: ConversationRecord[],
    preferred?: string,
  ) => {
    const fallback = resolveAvailableConversationId(
      records,
      preferred,
      DEFAULT_CONVERSATION_ID,
    );
    conversationSessions.register(fallback);
    setActiveConversationId((current) => {
      if (
        records.some((conversation) => conversation.conversationId === current)
      )
        return current;
      cacheActiveConversation(fallback);
      return fallback;
    });
    if (
      !records.some(
        (conversation) =>
          conversation.conversationId === displayedConversationIdRef.current,
      )
    ) {
      displayedConversationIdRef.current = fallback;
      conversationSwitchRef.current = null;
      setConversationSwitch(null);
      setDisplayedConversationId(fallback);
    }
  };
  useEffect(
    () =>
      api.subscribe(
        (event) => {
          if (event.type === "connection") setStatus(event.status);
          else if (event.type === "channel") setChannel(event.channel);
          else if (event.type === "files-error")
            notify.fail("文件讀取失敗", event.message);
          else if (event.type === "conversation-updated") {
            conversationSessions.register(event.conversation);
            void api.rememberConversation(event.conversation).catch(console.error);
          }
          else if (event.conversationId) conversationSessions.route(event);
          else console.error(`Unroutable ${event.type} event`, event);
        },
        (remote) => {
          if (remote.conversations?.length) {
            void api.listConversations.refresh().catch(() => {});
            conversationSessions.synchronize(remote);
            applyConversationFallback(
              remote.conversations,
              remote.defaultConversationId,
            );
          } else {
            conversationSessions.register(DEFAULT_CONVERSATION_ID);
            conversationSessions.synchronize({
              ...remote,
              defaultConversationId: DEFAULT_CONVERSATION_ID,
              conversations: [defaultConversation],
            });
          }
          if (remote.connectionStatus) setStatus(remote.connectionStatus);
          if (remote.channel) setChannel(remote.channel);
        },
      ),
    [],
  );
  useEffect(() => {
    return api.listConversations.watch(({ conversations: records, defaultConversationId }) => {
        conversationSessions.registerAll(records);
        setConversations(records);
        for (const record of records) {
          const store = conversationSessions.get(record.conversationId);
          const lastMessage = lastVisibleMessageSummary(
            store.getSnapshot().messages,
          );
          if (lastMessage && lastMessage !== record.lastMessage)
            recordConversationActivity(record.conversationId, {
              lastMessage,
            });
        }
        applyConversationFallback(records, defaultConversationId);
      });
  }, []);
  useEffect(
    () => () => {
      if (activityViewTimer.current !== null)
        window.clearTimeout(activityViewTimer.current);
      activityViewTargets.current.clear();
      for (const timer of activityTimersRef.current.values())
        window.clearTimeout(timer);
      activityTimersRef.current.clear();
      activityTargetsRef.current.clear();
    },
    [],
  );

  const releaseArchivedStores = (displayedId: string) => {
    for (const conversationId of archivedStoresPendingRelease.current) {
      if (conversationId === displayedId) continue;
      conversationSessions.remove(conversationId);
      archivedStoresPendingRelease.current.delete(conversationId);
      conversationViewStates.current.delete(conversationId);
    }
  };
  const commitDisplayedConversation = (conversationId: string) => {
    conversationSessions.get(conversationId);
    displayedConversationIdRef.current = conversationId;
    setDisplayedConversationId(conversationId);
    releaseArchivedStores(conversationId);
  };
  const updateConversationSwitch = (value: ConversationSwitch | null) => {
    conversationSwitchRef.current = value;
    setConversationSwitch(value);
  };
  const beginConversationSwitch = (
    conversationId: string,
    generation: number,
  ) => {
    const outgoingFrame = captureConversationFrameRef.current?.();
    if (!outgoingFrame) {
      commitDisplayedConversation(conversationId);
      updateConversationSwitch(null);
      return;
    }
    updateConversationSwitch({
      outgoingFrame,
      generation,
      latestTargetConversationId: conversationId,
      latestGeneration: generation,
    });
    commitDisplayedConversation(conversationId);
  };
  const requestDisplayedConversation = (conversationId: string) => {
    if (
      !conversationSwitchRef.current &&
      conversationId === displayedConversationIdRef.current
    )
      return;
    const reduced = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;
    if (reduced || location.pathname !== "/chat") {
      commitDisplayedConversation(conversationId);
      updateConversationSwitch(null);
      return;
    }
    const generation = ++conversationSwitchGeneration.current;
    const current = conversationSwitchRef.current;
    if (current) {
      updateConversationSwitch({
        ...current,
        latestTargetConversationId: conversationId,
        latestGeneration: generation,
      });
      return;
    }
    beginConversationSwitch(conversationId, generation);
  };
  const selectConversation = (conversationId: string) => {
    conversationSessions.get(conversationId);
    cacheActiveConversation(conversationId);
    setActiveConversationId(conversationId);
    requestDisplayedConversation(conversationId);
  };
  const finishConversationSwitch = (generation: number) => {
    const current = conversationSwitchRef.current;
    if (!current || current.generation !== generation) return;
    const records = conversationsRef.current;
    const latestTargetConversationId = records.some(
      (conversation) =>
        conversation.conversationId === current.latestTargetConversationId,
    )
      ? current.latestTargetConversationId
      : resolveAvailableConversationId(
          records,
          undefined,
          DEFAULT_CONVERSATION_ID,
        );
    if (latestTargetConversationId !== displayedConversationIdRef.current) {
      updateConversationSwitch(null);
      beginConversationSwitch(
        latestTargetConversationId,
        current.latestGeneration,
      );
      return;
    }
    updateConversationSwitch(null);
    releaseArchivedStores(displayedConversationIdRef.current);
  };
  const createConversation = async () => {
    const { conversation } = await api.createConversation();
    conversationSessions.register(conversation);
    const next = upsertConversation(conversationsRef.current, conversation);
    conversationsRef.current = next;
    setConversations(next);
    selectConversation(conversation.conversationId);
    return conversation;
  };
  const forkConversation = async (conversationId: string) => {
    const source = conversationSessions.get(conversationId).getSnapshot();
    if (!hasCompletedConversation(source)) return null;
    const { conversation } = await api.forkConversation(conversationId);
    conversationSessions.register(conversation);
    setConversations((current) => upsertConversation(current, conversation));
    return conversation;
  };
  const canArchiveConversation = (conversationId: string) => {
    const snapshot = conversationSessions.get(conversationId).getSnapshot();
    return isTicketArchiveEligible({
      conversationId,
      conversationCount: conversations.length,
      activeTurnId: snapshot.activeTurnId,
      pendingApprovalCount: snapshot.messages.reduce(
        (count, message) =>
          count + (message.role === "assistant" ? message.approvals.length : 0),
        0,
      ),
    });
  };
  const archiveConversation = async (conversationId: string) => {
    if (!canArchiveConversation(conversationId))
      throw new Error("当前会话不能归档");
    await api.archiveConversation(conversationId);
  };
  const commitArchivedConversation = (
    conversationId: string,
    _adjacentConversationId: string,
  ) => {
    const activityTimer = activityTimersRef.current.get(conversationId);
    if (activityTimer) window.clearTimeout(activityTimer);
    activityTimersRef.current.delete(conversationId);
    activityTargetsRef.current.delete(conversationId);
    if (displayedConversationIdRef.current === conversationId)
      archivedStoresPendingRelease.current.add(conversationId);
    else {
      conversationSessions.remove(conversationId);
      conversationViewStates.current.delete(conversationId);
    }
    setConversations((current) =>
      current.filter((item) => item.conversationId !== conversationId),
    );
  };
  const updateConversation = async (
    conversationId: string,
    patch: Partial<
      Pick<ConversationRecord, "title" | "frontName" | "image" | "pinned">
    >,
  ) => {
    const { conversation } = await api.updateConversation(
      conversationId,
      patch,
    );
    setConversations((current) => {
      const updated = current.map((item) =>
        item.conversationId === conversationId
          ? conversation
          : conversation.pinned
            ? { ...item, pinned: false }
            : item,
      );
      return conversation.pinned
        ? updated.sort((left, right) =>
            left.pinned === right.pinned
              ? left.createdAt.localeCompare(right.createdAt)
              : left.pinned
                ? -1
                : 1,
          )
        : updated;
    });
    return conversation;
  };
  const updateConversationViewState = (
    conversationId: string,
    patch: Partial<ConversationViewState>,
  ) => {
    conversationViewStates.current.set(conversationId, {
      draft: "",
      scrollTop: 0,
      ...conversationViewStates.current.get(conversationId),
      ...patch,
    });
  };

  const transitionClass = transition
    ? `route-transition-${transition.phase}`
    : "";
  const surface =
    location.pathname === "/connections"
      ? "connections"
      : location.pathname === "/settings"
        ? "settings"
        : "paper";
  const crossfadeReady =
    transition?.phase === "crossfade" &&
    location.pathname === transition.target;

  const renderRoutes = (routeLocation: ReturnType<typeof useLocation>) => (
    <Routes location={routeLocation}>
      <Route path="/" element={null} />
      <Route
        path="/chat"
        element={
          <ErrorBoundary>
            <Chat
              session={chatSession}
              onBack={() => navigateWithTransition("/")}
              conversations={conversations}
              activeConversationId={activeConversationId}
              displayedConversation={displayedConversation}
              onSelectConversation={selectConversation}
              onCreateConversation={createConversation}
              onForkConversation={forkConversation}
              onUpdateConversation={updateConversation}
              canArchiveConversation={canArchiveConversation}
              onArchiveConversation={archiveConversation}
              onArchivedConversation={commitArchivedConversation}
              conversationTransition={conversationSwitch}
              onConversationSwitchEnd={finishConversationSwitch}
              onRegisterFrameCapture={registerConversationFrameCapture}
              initialDraft={
                conversationViewStates.current.get(displayedConversationId)
                  ?.draft ?? ""
              }
              initialScrollTop={
                conversationSwitch
                  ? (conversationViewStates.current.get(displayedConversationId)
                      ?.scrollTop ?? null)
                  : null
              }
              onViewStateChange={updateConversationViewState}
            />
          </ErrorBoundary>
        }
      />
      <Route
        path="/connections"
        element={
          <ErrorBoundary>
            <Connections
              channel={channel}
              onBack={() => navigateWithTransition("/")}
            />
          </ErrorBoundary>
        }
      />
      <Route
        path="/clues"
        element={
          <ErrorBoundary>
            <Clues onBack={() => navigateWithTransition("/")} />
          </ErrorBoundary>
        }
      />
      <Route
        path="/settings"
        element={
          <ErrorBoundary>
            <Settings onBack={() => navigateWithTransition("/")} />
          </ErrorBoundary>
        }
      />
    </Routes>
  );

  const homeVisible = location.pathname === "/" || (crossfadeReady && transition.fromLocation.pathname === "/");
  const routeLayers = crossfadeReady
    ? [
        transition.fromLocation.pathname !== "/" && <div
          className={`route-transition-layer route-layer-surface-${
            transition.fromLocation.pathname === "/connections"
              ? "connections"
              : transition.fromLocation.pathname === "/settings"
                ? "settings"
                : "paper"
          } route-transition-outgoing`}
          key={transition.fromLocation.key}
        >
          {renderRoutes(transition.fromLocation)}
        </div>,
        location.pathname !== "/" && <div
          className={`route-transition-layer route-layer-surface-${surface} route-transition-incoming`}
          key={location.key}
        >
          {renderRoutes(location)}
        </div>,
      ]
    : [
        location.pathname !== "/" && <div
          className={`route-transition-layer route-layer-surface-${surface}`}
          key={location.key}
        >
          {renderRoutes(location)}
        </div>,
      ];

  return (
    <div
      className={`route-transition-frame route-surface-${surface} ${transitionClass}`}
      data-transition-target={transition?.target}
      data-transition-active={transition ? "true" : "false"}
      onAnimationEnd={handleTransitionEnd}
    >
      <div className={`route-transition-layer home-route${!homeVisible ? " is-hidden" : crossfadeReady ? location.pathname === "/" ? " route-transition-incoming" : " route-transition-outgoing" : ""}`}
        inert={location.pathname !== "/"} aria-hidden={!homeVisible}>
        <ErrorBoundary>
          <Home active={location.pathname === "/"}
            status={channel.kind === "api" ? { state: "ready", message: channel.name } : status}
            channelName={channel.name}
            onChat={() => navigateWithTransition("/chat")}
            onConnections={() => navigateWithTransition("/connections")}
            onSettings={() => navigateWithTransition("/settings")}
            onClues={() => navigateWithTransition("/clues")} />
        </ErrorBoundary>
      </div>
      <Suspense fallback={null}>{routeLayers}</Suspense>
      <Notify page={location.pathname} />
    </div>
  );
}
