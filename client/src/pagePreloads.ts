import { cacheLazyImport } from "./lazyImport";

export const preloadChat = cacheLazyImport("chat", () => import("./pages/Chat"));
export const preloadClues = cacheLazyImport("clues", () => import("./pages/Clues"));
export const preloadConnections = cacheLazyImport("connections", () =>
  import("./pages/Connections"),
);
export const preloadSettings = cacheLazyImport("settings", () =>
  import("./pages/Settings"),
);

// 新路由也在这里登记，lazy、入口预加载和空闲预加载共用同一份请求。
export const pagePreloads = {
  "/chat": preloadChat,
  "/clues": preloadClues,
  "/connections": preloadConnections,
  "/settings": preloadSettings,
};

export type RoutePath = "/" | keyof typeof pagePreloads;
