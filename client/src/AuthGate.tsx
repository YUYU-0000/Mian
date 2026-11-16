import { useEffect, useLayoutEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { auth, cachedAccess, type Access } from "./auth";
import { backendAvailable, BackendUnavailable, OFFLINE_MESSAGE, setBackendAuthorized } from "./backend";
import { startOfflineSync } from "./offline";
import Notify, { notify } from "./components/Notify";
import AnimatedText from "./components/AnimatedText";
import PasswordToggle from "./components/PasswordToggle";
import ScrollText from "./components/ScrollText";
import AuthFish, { drawFish } from "./AuthFish";
import { preloadHomeData, preloadHomePages } from "./homePreload";
import { gateFontsReady } from "./gateFonts";
import { voicePlayer } from "./voicePlayer";
import "./auth.css";

type Phase = "checking" | "locked" | "welcome" | "drawing" | "settled" | "opening" | "open";
const WELCOME_MS = 600;
const PASSWORD_ECHO = "我聽見你來了，門就要開了";

export default function AuthGate({ children }: { children: ReactNode }) {
  const [access, setAccess] = useState<Access | null>(cachedAccess);
  const currentAccess = useRef(access);
  const [phase, setPhase] = useState<Phase>("checking");
  const currentPhase = useRef<Phase>("checking");
  const [homeReady, setHomeReady] = useState(false);
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [repeat, setRepeat] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [offline, setOffline] = useState(false);
  const [errorHint, setErrorHint] = useState("");
  const fish = useRef<SVGSVGElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const hintLine = useRef<HTMLSpanElement>(null);
  const drawing = useRef<ReturnType<typeof drawFish> | null>(null);
  const entryWasSlow = useRef(false);
  const navigate = useNavigate();
  const move = (next: Phase) => { currentPhase.current = next; setPhase(next); };
  const receiveAccess = (next: Access | null) => { currentAccess.current = next; setAccess(next); };

  const openDoor = async (permission: Promise<Access>, automatic = false) => {
    move("drawing");
    setHomeReady(false);
    entryWasSlow.current = false;
    let timer: number;
    const prepared = Promise.all([
      gateFontsReady,
      preloadHomePages(),
      permission.then(() => preloadHomeData()),
    ]).then(() => false).catch(error => {
      if (!currentAccess.current?.authenticated) throw error;
      return true;
    });
    // 给收笔和交叉淡化留一秒，整个等待不超过八秒。
    const ready = Promise.race([
      prepared,
      new Promise<boolean>(resolve => { timer = window.setTimeout(() => resolve(true), 7000 - (automatic ? WELCOME_MS : 0)); }),
    ]).then(slow => {
      if (!currentAccess.current?.authenticated) throw new BackendUnavailable();
      if (drawing.current !== run) return;
      entryWasSlow.current = slow;
      if (slow) navigate("/", { replace: true });
      setHomeReady(true);
    }).finally(() => window.clearTimeout(timer));
    const run = drawFish(fish.current!, ready);
    drawing.current = run;
    try {
      await run.finished;
      setPassword(""); setRepeat(""); setConfirming(false); setShowPassword(false);
      move("settled");
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return;
      if (confirming) setRepeat(""); else setPassword("");
      move("locked");
      if (error instanceof BackendUnavailable) {
        setOffline(true);
        setErrorHint(OFFLINE_MESSAGE);
      } else {
        setErrorHint("不對。");
        if (error instanceof Error && error.message !== "不對，再想想。") notify.fail("門還沒開", error);
      }
    } finally { if (drawing.current === run) drawing.current = null; }
  };

  useEffect(() => {
    const lock = () => {
      setBackendAuthorized(false);
      voicePlayer.stop();
      localStorage.removeItem("mian.access-until");
      drawing.current?.cancel();
      setHomeReady(false);
      receiveAccess(currentAccess.current ? { ...currentAccess.current, authenticated: false, expiresAt: 0 } : null);
      move("locked");
    };
    const receive = (event: Event) => {
      const next = (event as CustomEvent<Access>).detail;
      receiveAccess(next);
      if (!next.authenticated) lock();
    };
    const refresh = () => void auth.status().then(() => setOffline(false)).catch(error => {
      setOffline(error instanceof BackendUnavailable);
      if (!(error instanceof BackendUnavailable) || !cachedAccess()) lock();
    });
    const visible = () => { if (document.visibilityState === "visible") refresh(); };
    const storage = (event: StorageEvent) => { if (event.key === "mian.access-until" && !event.newValue) lock(); };
    window.addEventListener("mian:access", receive);
    window.addEventListener("mian:login-required", lock);
    window.addEventListener("online", refresh);
    window.addEventListener("storage", storage);
    document.addEventListener("visibilitychange", visible);
    const timer = window.setInterval(refresh, 30_000);
    refresh();
    return () => {
      drawing.current?.cancel();
      currentPhase.current = "checking";
      window.clearInterval(timer);
      window.removeEventListener("mian:access", receive);
      window.removeEventListener("mian:login-required", lock);
      window.removeEventListener("online", refresh);
      window.removeEventListener("storage", storage);
      document.removeEventListener("visibilitychange", visible);
    };
  }, []);
  useEffect(() => {
    if (access?.authenticated && (currentPhase.current === "checking" || currentPhase.current === "locked"))
      move("welcome");
  }, [access?.authenticated]);
  useEffect(() => {
    if (phase !== "welcome") return;
    const timer = window.setTimeout(() => void openDoor(Promise.resolve(currentAccess.current!), true), WELCOME_MS);
    return () => window.clearTimeout(timer);
  }, [phase]);
  useEffect(() => { if (access?.authenticated) return startOfflineSync(); }, [access?.authenticated]);
  useEffect(() => {
    if (!errorHint) return;
    const timer = window.setTimeout(() => setErrorHint(""), 3000);
    return () => window.clearTimeout(timer);
  }, [errorHint]);
  useEffect(() => {
    if (phase !== "settled") return;
    // 首页已在不透明的门后挂载，下一帧开始揭开，不卸载或重建首页。
    const frame = requestAnimationFrame(() => move("opening"));
    return () => cancelAnimationFrame(frame);
  }, [phase]);

  const setup = access && !access.configured;
  const canEnter = access && !access.authenticated && (!setup || access.canSetup);
  const busy = phase === "drawing" || phase === "settled" || phase === "opening";
  const value = confirming ? repeat : password;
  const typing = phase === "locked" && !!value && !errorHint;
  const echoLength = Array.from(value).length;
  const echo = PASSWORD_ECHO.repeat(Math.ceil(echoLength / PASSWORD_ECHO.length)).slice(0, echoLength);
  const hint = phase === "checking" ? "" : busy || access?.authenticated ? "門開著，進來。" : errorHint || (typing ? showPassword ? value : echo : offline ? OFFLINE_MESSAGE : setup
    ? access.canSetup ? confirming ? "再寫一次。" : "先把門鎖好。至少十個字。" : "先在這台電腦上把門鎖好。"
    : "密碼給門，不用給我");
  useLayoutEffect(() => {
    const line = hintLine.current?.querySelector(".scroll-text");
    if (line && typing) line.scrollLeft = line.scrollWidth;
  }, [hint, typing]);
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!canEnter || busy) return;
    setErrorHint("");
    if (setup && !confirming) { setConfirming(true); input.current!.focus({ preventScroll: true }); return; }
    if (setup && password !== repeat) { setRepeat(""); setErrorHint("不對。"); return; }
    input.current!.blur();
    void openDoor(auth.login(password, !!setup));
  };
  return <>
    {access?.authenticated && homeReady && <div className="auth-content" inert={phase !== "open"}>{children}</div>}
    {phase !== "open" && <main className={`auth-page${busy ? " is-drawing" : ""}${phase === "locked" ? " is-locked" : ""}${phase === "welcome" ? " is-welcoming" : ""}${phase === "opening" ? " is-opening" : ""}`}
      onTransitionEnd={event => {
        if (event.target !== event.currentTarget || event.propertyName !== "opacity" || phase !== "opening") return;
        move("open");
        if (entryWasSlow.current || !backendAvailable()) notify.note(OFFLINE_MESSAGE);
      }}>
      <div className="auth-gate" data-keyboard-surface>
        <div className="auth-brand">Mian</div>
        <header className="auth-decor">
          <span className="auth-en">Private Archive</span>
          <span className="auth-decor-line" aria-hidden="true" />
          <h1 className="auth-cn">敲門</h1>
        </header>
        <AuthFish svgRef={fish} />
        <form className="auth-keyrow" aria-busy={busy} onSubmit={submit}>
          <span ref={hintLine} className={`auth-hint${typing ? " is-typing" : ""}`} id="auth-hint" aria-live="polite"><ScrollText><AnimatedText text={hint} revealCharacters={typing && !showPassword} transitionKey={showPassword} /></ScrollText></span>
          <input ref={input} className="auth-password" type="password" aria-label={confirming ? "再次確認密碼" : "密碼"}
            aria-describedby="auth-hint" autoComplete={setup ? "new-password" : "current-password"} enterKeyHint={setup && !confirming ? "next" : "go"}
            minLength={setup ? 10 : undefined} required disabled={!canEnter} readOnly={phase !== "locked"} value={value}
            onChange={event => { setErrorHint(""); if (confirming) setRepeat(event.target.value); else setPassword(event.target.value); }} />
          {canEnter && phase === "locked" && <PasswordToggle className="auth-password-toggle" visible={showPassword} onToggle={() => setShowPassword(value => !value)} />}
          <button className="auth-submit" type="submit" aria-label="敲門" disabled={!canEnter || phase !== "locked" || !value} />
        </form>
        <div className="auth-foot">SINCE  10.15</div>
      </div>
      {!homeReady && <Notify page="/login" />}
    </main>}
  </>;
}
