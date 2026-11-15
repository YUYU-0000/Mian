function cachePage<T>(load: () => Promise<T>) {
  let module: Promise<T> | undefined;
  return () => (module ??= load());
}

export const preloadChat = cachePage(() => import("./pages/Chat"));
export const preloadClues = cachePage(() => import("./pages/Clues"));
export const preloadConnections = cachePage(() => import("./pages/Connections"));
export const preloadSettings = cachePage(() => import("./pages/Settings"));

// 新路由也在这里登记，lazy、入口预加载和空闲预加载共用同一份请求。
export const pagePreloads = {
  "/chat": preloadChat,
  "/clues": preloadClues,
  "/connections": preloadConnections,
  "/settings": preloadSettings,
};

export type RoutePath = "/" | keyof typeof pagePreloads;
