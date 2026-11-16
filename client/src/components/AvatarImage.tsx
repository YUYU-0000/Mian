// 聊天头像和线索墙肖像订阅同一头像地址，换图沿用共用显影层。
import { useSyncExternalStore } from "react";
import { avatarUrl, watchAvatars, type AvatarRole } from "../avatars";
import DevelopingMedia from "./DevelopingMedia";

export default function AvatarImage({ role }: { role: AvatarRole }) {
  const src = useSyncExternalStore(watchAvatars, () => avatarUrl(role));
  return src ? <DevelopingMedia className="avatar-image" src={src} /> : null;
}
