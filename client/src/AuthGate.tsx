import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { auth, cachedAccess, type Access } from "./auth";
import { BackendUnavailable, OFFLINE_MESSAGE } from "./backend";
import { startOfflineSync } from "./offline";
import Notify, { notify } from "./components/Notify";
import AnimatedText from "./components/AnimatedText";
import AuthFish, { drawFish } from "./AuthFish";
import { preloadHomeData, preloadHomePages } from "./homePreload";
import "./auth.css";

export default function AuthGate({ children }: { children: ReactNode }) {
  const [access, setAccess] = useState<Access | null>(cachedAccess);
  const [password, setPassword] = useState("");
  const [repeat, setRepeat] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [phase, setPhase] = useState<"idle" | "drawing" | "settled" | "opening" | "retry">("idle");
  const [offline, setOffline] = useState(false);
  const [errorHint, setErrorHint] = useState("");
  const fish = useRef<SVGSVGElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const drawing = useRef<ReturnType<typeof drawFish> | null>(null);
  useEffect(() => {
    const refresh = () => void auth.status().then(() => setOffline(false)).catch(error => {
      setOffline(error instanceof BackendUnavailable);
      if (!(error instanceof BackendUnavailable) || !cachedAccess()) setAccess(null);
    });
    const receive = (event: Event) => setAccess((event as CustomEvent<Access>).detail);
    const lock = () => {
      drawing.current?.cancel();
      setPhase("idle");
      localStorage.removeItem("mian.access-until");
      setAccess(current => current ? { ...current, authenticated: false, expiresAt: 0 } : null);
    };
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
      window.clearInterval(timer);
      window.removeEventListener("mian:access", receive);
      window.removeEventListener("mian:login-required", lock);
      window.removeEventListener("online", refresh);
      window.removeEventListener("storage", storage);
      document.removeEventListener("visibilitychange", visible);
    };
  }, []);
  useEffect(() => { if (access?.authenticated) return startOfflineSync(); }, [access?.authenticated]);
  useEffect(() => {
    if (!errorHint) return;
    const timer = window.setTimeout(() => setErrorHint(""), 3000);
    return () => window.clearTimeout(timer);
  }, [errorHint]);
  useEffect(() => {
    if (phase !== "settled") return;
    const timer = window.setTimeout(() => setPhase("opening"), 500);
    return () => window.clearTimeout(timer);
  }, [phase]);
  const setup = access && !access.configured;
  const canEnter = access && (!setup || access.canSetup);
  const busy = phase === "drawing" || phase === "settled" || phase === "opening";
  const value = confirming ? repeat : password;
  const hint = errorHint || (offline ? OFFLINE_MESSAGE : setup
    ? access.canSetup ? confirming ? "再寫一次。" : "先把門鎖好。至少十個字。" : "先在這台電腦上把門鎖好。"
    : "密碼給門，不用給我");
  const showApp = access?.authenticated && (phase === "idle" || phase === "settled" || phase === "opening");
  const showGate = !access?.authenticated || phase !== "idle";
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!canEnter || busy) return;
    setErrorHint("");
    if (setup && !confirming) { setConfirming(true); input.current!.focus(); return; }
    if (setup && password !== repeat) { setRepeat(""); setErrorHint("不對。"); return; }
    input.current!.blur();
    setPhase("drawing");
    let accepted = false;
    const ready = Promise.all([
      preloadHomePages(),
      auth.login(password, !!setup).then(() => { accepted = true; return preloadHomeData(); }),
    ]);
    drawing.current = drawFish(fish.current!, ready);
    try {
      await drawing.current.finished;
      setPassword(""); setRepeat(""); setConfirming(false); setOffline(false);
      setPhase("settled");
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return;
      if (confirming) setRepeat(""); else setPassword("");
      setPhase("retry");
      if (error instanceof BackendUnavailable || accepted) {
        setOffline(true);
        setErrorHint(OFFLINE_MESSAGE);
      } else {
        setErrorHint("不對。");
        if (error instanceof Error && error.message !== "不對，再想想。") notify.fail("門還沒開", error);
      }
    } finally { drawing.current = null; }
  };
  return <>
    {showApp && <div className={`auth-content${phase === "settled" ? " is-preparing" : phase === "opening" ? " is-entering" : ""}`}>{children}</div>}
    {showGate && <main className={`auth-page${busy ? " is-drawing" : ""}${phase === "opening" && access?.authenticated ? " is-opening" : ""}`}
      onTransitionEnd={event => {
        if (event.target === event.currentTarget && event.propertyName === "opacity" && phase === "opening") setPhase("idle");
      }}>
      <div className="auth-gate">
        <div className="auth-brand">Mian</div>
        <header className="auth-decor">
          <span className="auth-en">Private Archive</span>
          <span className="auth-decor-line" aria-hidden="true" />
          <h1 className="auth-cn">敲門</h1>
        </header>
        <AuthFish svgRef={fish} />
        <form className={`auth-keyrow${value && !errorHint ? " has-value" : ""}`} aria-busy={busy} onSubmit={submit}>
          <span className="auth-hint" id="auth-hint" aria-live="polite"><AnimatedText text={hint} /></span>
          <input ref={input} className="auth-password" type="password" aria-label={confirming ? "再次確認密碼" : "密碼"}
            aria-describedby="auth-hint" autoComplete={setup ? "new-password" : "current-password"} enterKeyHint={setup && !confirming ? "next" : "go"}
            minLength={setup ? 10 : undefined} required disabled={!canEnter || busy} value={value}
            onChange={event => { setErrorHint(""); if (confirming) setRepeat(event.target.value); else setPassword(event.target.value); }} />
          <button className="auth-submit" type="submit" aria-label="敲門" disabled={!canEnter || busy || !value} />
        </form>
        <div className="auth-foot">SINCE  10.15</div>
      </div>
      <Notify page="/login" />
    </main>}
  </>;
}
