import { useEffect, useState } from "react";
import { auth, type Access } from "../auth";
import AnimatedText from "../components/AnimatedText";
import PasswordToggle from "../components/PasswordToggle";
import { notify } from "../components/Notify";

export default function SettingsSecurity({ active }: { active: boolean }) {
  const [access, setAccess] = useState<Access | null>(null);
  const [current, setCurrent] = useState("");
  const [password, setPassword] = useState("");
  const [repeat, setRepeat] = useState("");
  const [busy, setBusy] = useState(false);
  const [shown, setShown] = useState({ current: false, password: false, repeat: false });
  useEffect(() => {
    if (active) void auth.status().then(setAccess).catch(error => notify.fail("門鎖沒連上", error));
    else { setCurrent(""); setPassword(""); setRepeat(""); }
  }, [active]);
  const run = async (operation: () => Promise<Access>, message: string) => {
    setBusy(true);
    try { setAccess(await operation()); notify.ok(message); }
    catch (error) { notify.fail("還沒改好", error); }
    finally { setBusy(false); }
  };
  return <section className="security-panel" data-keyboard-scroll>
    <span className="auth-eyebrow">PRIVATE ACCESS</span>
    <h2>門鎖</h2>
    <label className="security-local">
      <input type="checkbox" checked={access?.localBypass ?? false} disabled={!access || busy}
        onChange={event => void run(() => auth.settings(event.target.checked), "記住了")} />
      本機與局域網免登錄
    </label>
    <p>關掉後，用 https 網址進來。</p>
    <form onSubmit={event => {
      event.preventDefault();
      if (password !== repeat) { notify.note("兩次要一樣。"); return; }
      void run(async () => {
        const result = await auth.password(current, password);
        setCurrent(""); setPassword(""); setRepeat("");
        return result;
      }, "換好了，其他設備已退出");
    }}>
      <label>現在的密碼<span className="password-field"><input type={shown.current ? "text" : "password"} autoComplete="current-password" required value={current} onChange={event => setCurrent(event.target.value)} />
        <PasswordToggle visible={shown.current} onToggle={() => setShown(value => ({ ...value, current: !value.current }))} /></span></label>
      <label>新密碼<span className="password-field"><input type={shown.password ? "text" : "password"} autoComplete="new-password" minLength={10} required value={password} onChange={event => setPassword(event.target.value)} />
        <PasswordToggle visible={shown.password} onToggle={() => setShown(value => ({ ...value, password: !value.password }))} /></span></label>
      <label>再寫一次<span className="password-field"><input type={shown.repeat ? "text" : "password"} autoComplete="new-password" minLength={10} required value={repeat} onChange={event => setRepeat(event.target.value)} />
        <PasswordToggle visible={shown.repeat} onToggle={() => setShown(value => ({ ...value, repeat: !value.repeat }))} /></span></label>
      <button disabled={busy}><AnimatedText text={busy ? "等我一下" : "換一把鎖"} /></button>
    </form>
    <button className="security-logout" disabled={busy} onClick={() => void run(auth.logoutAll, "所有設備已退出")}>退出所有設備登錄</button>
  </section>;
}
