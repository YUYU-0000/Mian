import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type AnimationEvent,
} from "react";
import {
  Route,
  Routes,
  useLocation,
  useNavigate,
} from "react-router-dom";
import { api } from "./api";
import {
  hasCompletedConversation,
  lastVisibleMessageSummary,
} from "./chatSession";
import { ConversationSessions } from "./conversationSessions";
import type {
  ConnectionStatus,
  ConversationActivity,
  ConversationRecord,
} from "./types";
import Home from "./pages/Home";
import Chat from "./pages/Chat";
import Connections from "./pages/Connections";
import ErrorBoundary from "./ErrorBoundary";
import { isTicketArchiveEligible } from "./ticketGestures";
import {
  resolveAvailableConversationId,
  upsertConversation,
} from "./conversationState";
import type { FrozenConversationFrame } from "./conversationTransition";
const initial: ConnectionStatus = {
  state: "not-connected",
  message: "尚未连接",
};
const DEFAULT_CONVERSATION_ID = "c1";
const ACTIVE_CONVERSATION_KEY = "mian.active-conversation.v1";
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
type TransitionPhase = "press" | "crossfade";
type RouteTransition = {
  target: string;
  phase: TransitionPhase;
  fromLocation: ReturnType<typeof useLocation>;
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
  const nav = useNavigate();
  const location = useLocation();
  const [status, setStatus] = useState(initial);
  const [transition, setTransition] = useState<RouteTransition | null>(null);
  const [conversations, setConversations] = useState<ConversationRecord[]>([
    defaultConversation,
  ]);
  const [activeConversationId, setActiveConversationId] = useState(() =>
    localStorage.getItem(ACTIVE_CONVERSATION_KEY) || DEFAULT_CONVERSATION_ID,
  );
  const [displayedConversationId, setDisplayedConversationId] = useState(() =>
    localStorage.getItem(ACTIVE_CONVERSATION_KEY) || DEFAULT_CONVERSATION_ID,
  );
  const [conversationSwitch, setConversationSwitch] =
    useState<ConversationSwitch | null>(null);
  const transitionLocked = useRef(false);
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
  const activityTimersRef = useRef(
    new Map<string, number>(),
  );
  const activityTargetsRef = useRef(
    new Map<string, ConversationActivity>(),
  );
  const recordConversationActivity = useCallback((
    conversationId: string,
    patch: ConversationActivity,
  ) => {
    setConversations((current) =>
      current.map((conversation) =>
        conversation.conversationId === conversationId
          ? { ...conversation, ...patch }
          : conversation,
      ),
    );
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
  }, []);
  const conversationSessionsRef = useRef<ConversationSessions | null>(null);
  if (!conversationSessionsRef.current)
    conversationSessionsRef.current = new ConversationSessions({
      initialConversationIds: [
        DEFAULT_CONVERSATION_ID,
        activeConversationId,
      ],
      onActivity: recordConversationActivity,
    });
  const conversationSessions = conversationSessionsRef.current;
  const chatSession = conversationSessions.get(displayedConversationId);
  const displayedConversationRecordRef = useRef(defaultConversation);
  const displayedConversation =
    conversations.find(
      (conversation) =>
        conversation.conversationId === displayedConversationId,
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
      if (records.some((conversation) => conversation.conversationId === current))
        return current;
      localStorage.setItem(ACTIVE_CONVERSATION_KEY, fallback);
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
          else if (event.type === "conversation-updated")
            setConversations((current) => {
              conversationSessions.register(event.conversation);
              return upsertConversation(current, event.conversation);
            });
          else if (event.conversationId) conversationSessions.route(event);
          else console.error(`Unroutable ${event.type} event`, event);
        },
        (remote) => {
          if (remote.conversations?.length) {
            setConversations(remote.conversations);
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
        },
      ),
    [],
  );
  useEffect(() => {
    let alive = true;
    void api.listConversations().then(({ conversations: records, defaultConversationId }) => {
      if (!alive) return;
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
    }).catch(console.error);
    return () => {
      alive = false;
    };
  }, []);
  useEffect(
    () => () => {
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
    localStorage.setItem(ACTIVE_CONVERSATION_KEY, conversationId);
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
    conversationSessions.register(conversation).seedFrom(source);
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
    patch: Partial<Pick<ConversationRecord, "title" | "frontName" | "image" | "pinned">>,
  ) => {
    const { conversation } = await api.updateConversation(conversationId, patch);
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

  const navigateWithTransition = (target: string) => {
    if (target === location.pathname || transitionLocked.current) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      nav(target);
      return;
    }
    transitionLocked.current = true;
    setTransition({
      target,
      phase: "press",
      fromLocation: location,
    });
  };

  const finishTransition = () => {
    transitionLocked.current = false;
    setTransition(null);
  };

  const handleTransitionEnd = (event: AnimationEvent<HTMLDivElement>) => {
    if (!transition) return;
    if (
      transition.phase === "press" &&
      event.animationName === "routeControlPress"
    ) {
      nav(transition.target);
      setTransition({ ...transition, phase: "crossfade" });
      return;
    }
    if (
      transition.phase === "crossfade" &&
      event.animationName === "routePageEnter" &&
      event.target instanceof HTMLElement &&
      event.target.classList.contains("route-transition-incoming")
    )
      finishTransition();
  };

  const transitionClass = transition
    ? `route-transition-${transition.phase}`
    : "";
  const surface =
    location.pathname === "/connections" ? "connections" : "paper";
  const crossfadeReady =
    transition?.phase === "crossfade" &&
    location.pathname === transition.target;

  const renderRoutes = (routeLocation: ReturnType<typeof useLocation>) => (
    <Routes location={routeLocation}>
      <Route
        path="/"
        element={
          <ErrorBoundary>
            <Home
              status={status}
              onChat={() => navigateWithTransition("/chat")}
              onSettings={() => navigateWithTransition("/connections")}
            />
          </ErrorBoundary>
        }
      />
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
                  ? conversationViewStates.current.get(
                      displayedConversationId,
                    )?.scrollTop ?? null
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
              status={status}
              onStatus={setStatus}
              onBack={() => navigateWithTransition("/")}
            />
          </ErrorBoundary>
        }
      />
    </Routes>
  );

  const routeLayers = crossfadeReady
    ? [
        <div
          className={`route-transition-layer route-layer-surface-${
            transition.fromLocation.pathname === "/connections"
              ? "connections"
              : "paper"
          } route-transition-outgoing`}
          key={transition.fromLocation.key}
        >
          {renderRoutes(transition.fromLocation)}
        </div>,
        <div
          className={`route-transition-layer route-layer-surface-${surface} route-transition-incoming`}
          key={location.key}
        >
          {renderRoutes(location)}
        </div>,
      ]
    : [
        <div
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
      {routeLayers}
    </div>
  );
}
