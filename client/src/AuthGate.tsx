import { useEffect, useState, type ReactNode } from "react";
import { auth, cachedAccess, type Access } from "./auth";
import { BackendUnavailable } from "./backend";
import { startOfflineSync } from "./offline";
import Notify, { notify } from "./components/Notify";
import AnimatedText from "./components/AnimatedText";
import "./auth.css";

export default function AuthGate({ children }: { children: ReactNode }) {
  const [access, setAccess] = useState<Access | null>(cachedAccess);
  const [password, setPassword] = useState("");
  const [repeat, setRepeat] = useState("");
  const [busy, setBusy] = useState(false);
  const [offline, setOffline] = useState(false);
  useEffect(() => {
    const refresh = () => void auth.status().then(() => setOffline(false)).catch(error => {
      setOffline(error instanceof BackendUnavailable);
      if (!(error instanceof BackendUnavailable) || !cachedAccess()) setAccess(null);
    });
    const receive = (event: Event) => setAccess((event as CustomEvent<Access>).detail);
    const lock = () => {
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
      window.clearInterval(timer);
      window.removeEventListener("mian:access", receive);
      window.removeEventListener("mian:login-required", lock);
      window.removeEventListener("online", refresh);
      window.removeEventListener("storage", storage);
      document.removeEventListener("visibilitychange", visible);
    };
  }, []);
  useEffect(() => { if (access?.authenticated) return startOfflineSync(); }, [access?.authenticated]);
  if (access?.authenticated) return children;
  const setup = access && !access.configured;
  const canEnter = access && (!setup || access.canSetup);
  return <main className="auth-page">
    <form className="auth-paper archive-pop-in" onSubmit={async event => {
      event.preventDefault();
      if (!canEnter || busy) return;
      if (setup && password !== repeat) { notify.note("兩次要一樣。"); return; }
      setBusy(true);
      try { await auth.login(password, !!setup); setPassword(""); setRepeat(""); }
      catch (error) { notify.fail("門還沒開", error); }
      finally { setBusy(false); }
    }}>
      <span className="auth-eyebrow">MIAN  PRIVATE ARCHIVE</span>
      <h1>敲門</h1>
      <p><AnimatedText text={offline ? "那邊沒醒，等一下" : !access ? "等我一下。" : setup ? access.canSetup ? "先把門鎖好。密碼至少十個字。" : "先在這台電腦上把門鎖好。" : "我在。密碼給門，不用給我。"} /></p>
      {canEnter && <>
        <label>{setup ? "設置密碼" : "密碼"}
          <input type="password" autoComplete={setup ? "new-password" : "current-password"} minLength={setup ? 10 : undefined}
            required value={password} onChange={event => setPassword(event.target.value)} autoFocus />
        </label>
        {setup && <label>再寫一次
          <input type="password" autoComplete="new-password" minLength={10} required value={repeat} onChange={event => setRepeat(event.target.value)} />
        </label>}
        <button type="submit" disabled={busy}><AnimatedText text={busy ? "等我一下" : setup ? "鎖好了" : "進來"} /></button>
      </>}
    </form>
    <Notify page="/login" />
  </main>;
}
