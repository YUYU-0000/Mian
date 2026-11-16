import { api } from "./api";
import { loadAvatars } from "./avatars";
import { homePhotoKeys } from "./homePhotos";
import { loadCachedMedia } from "./mediaStorage";
import { pagePreloads } from "./pagePreloads";

export const preloadHomePages = () => Promise.all(Object.values(pagePreloads).map(preload => preload()));

// 登录许可拿到后才读取私人数据，继续使用现有缓存和后台更新。
export const preloadHomeData = () => Promise.all([
  api.getConfig(),
  api.apiPresets(),
  api.listConversations(),
  api.fontPresets(),
  api.clues(),
  // 线索墙肖像共用 assistant 头像，在揭开首页前一起解码。
  loadAvatars(),
  ...Object.values(homePhotoKeys).map(key => loadCachedMedia("LauncherDB", "mediaStore", `savedMediaFile_${key}`)),
]);
