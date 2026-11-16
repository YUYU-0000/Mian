// 请求登录状态与首次设置或登录，并同步浏览器中的登录有效期。
import { request, setBackendAuthorized } from "./backend";

export type Access = {
  configured: boolean;
  authenticated: boolean;
  canSetup: boolean;
  local: boolean;
  localBypass: boolean;
  expiresAt: number;
};
const ACCESS_KEY = "mian.access-until";
export function cachedAccess(): Access | null {
  const expiresAt = Number(localStorage.getItem(ACCESS_KEY));
  return expiresAt > Date.now()
    ? { configured: true, authenticated: true, canSetup: false, local: false, localBypass: false, expiresAt }
    : null;
}
function rememberAccess(access: Access) {
  setBackendAuthorized(access.authenticated);
  if (access.authenticated) localStorage.setItem(ACCESS_KEY, String(access.expiresAt));
  else localStorage.removeItem(ACCESS_KEY);
  window.dispatchEvent(new CustomEvent<Access>("mian:access", { detail: access }));
  return access;
}
const write = (url: string, body: unknown) => request<Access>(`/api/auth/${url}`, {
  method: "POST", body: JSON.stringify(body),
}).then(rememberAccess);
export const auth = {
  status: () => request<Access>("/api/auth/status", { cache: "no-store" }).then(rememberAccess),
  login: (password: string, setup: boolean) => write(setup ? "setup" : "login", { password }),
};
