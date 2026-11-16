export const OFFLINE_MESSAGE = "那邊沒醒，等一下";
export class BackendUnavailable extends Error {
  constructor() { super(OFFLINE_MESSAGE); }
}

let available = true;
const listeners = new Set<() => void>();
export const backendAvailable = () => available;
export function setBackendAvailable(next: boolean) {
  const recovered = !available && next;
  available = next;
  if (recovered) for (const listener of listeners) listener();
}
export function onBackendRecovery(listener: () => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

export async function backendFetch(url: string, init?: RequestInit) {
  let response: Response;
  try {
    response = await fetch(url, {
      ...init,
      signal: AbortSignal.any([AbortSignal.timeout(init?.method && init.method !== "GET" ? 120000 : 10000), ...(init?.signal ? [init.signal] : [])]),
    });
  } catch (error) {
    if (init?.signal?.aborted) throw error;
    setBackendAvailable(false);
    throw new BackendUnavailable();
  }
  if (response.status >= 500) {
    setBackendAvailable(false);
    throw new BackendUnavailable();
  }
  setBackendAvailable(true);
  return response;
}

export async function readResponse<T>(response: Response): Promise<T> {
  const body = await response.text();
  const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
  let parsed: unknown;
  if (body.trim() && contentType.includes("application/json")) {
    try { parsed = JSON.parse(body); }
    catch { throw new Error(`服务返回了无效的 JSON（HTTP ${response.status}）`); }
  } else if (body.trim()) parsed = body;
  if (!response.ok) {
    throw new Error(typeof parsed === "object" && parsed !== null && "error" in parsed
      ? String(parsed.error) : typeof parsed === "string" ? parsed : `请求失败（HTTP ${response.status}）`);
  }
  if (!body.trim()) return undefined as T;
  if (!contentType.includes("application/json"))
    throw new Error(`服务返回了非 JSON 内容（HTTP ${response.status}）`);
  return parsed as T;
}

export async function request<T>(url: string, init?: RequestInit): Promise<T> {
  return readResponse<T>(await backendFetch(url, {
    ...init,
    headers: { "Content-Type": "application/json", ...init?.headers },
  }));
}
