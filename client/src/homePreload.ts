import { api } from "./api";
import { loadAvatars } from "./avatars";
import { homePhotoKeys } from "./homePhotos";
import { readSettingsMedia } from "./mediaStorage";
import { pagePreloads } from "./pagePreloads";

export const preloadHomePages = () => Promise.all(Object.values(pagePreloads).map(preload => preload()));

// 登录许可拿到后才读取私人数据，继续使用现有缓存和后台更新。
export const preloadHomeData = () => Promise.all([
  api.getConfig(),
  api.apiPresets(),
  api.listConversations(),
  api.fontPresets(),
  loadAvatars(),
  ...Object.values(homePhotoKeys).map(readSettingsMedia),
]);
