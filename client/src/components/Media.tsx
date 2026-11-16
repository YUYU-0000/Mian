// 连接本地媒体缓存、上传和头像裁切，显示统一交给共用显影层。
import { getCachedMedia, loadCachedMedia, watchMedia, writeMedia, type CachedMedia } from "../mediaStorage";
import { compressImage } from "../imageCompression";
import {
  INITIAL_AVATAR_CROP,
  readAvatarEditor,
  saveAvatar,
  type AvatarEditor,
  type AvatarRole,
} from "../avatars";
import { useEffect, useRef, useState } from "react";
import { notify } from "./Notify";
import AvatarCropper from "./AvatarCropper";
import DevelopingMedia from "./DevelopingMedia";

export default function Media({
  storageKey,
  cover = false,
  active = true,
  avatar,
}: {
  storageKey: string;
  cover?: boolean;
  active?: boolean;
  avatar?: AvatarRole;
}) {
  const name = cover ? "mian_connections" : "LauncherDB";
  const store = cover ? "media" : "mediaStore";
  const key = cover ? `${storageKey}_cover` : `savedMediaFile_${storageKey}`;
  const cached = getCachedMedia(name, store, key);
  const [picture, setPicture] = useState<CachedMedia | null>(cached ?? null);
  const [loading, setLoading] = useState(cached === undefined);
  const [playButton, setPlayButton] = useState(false);
  const [editor, setEditor] = useState<AvatarEditor | null>(null);
  const container = useRef<HTMLSpanElement>(null);
  const show = (next: CachedMedia | null) => {
    setPicture(next);
    setLoading(false);
  };
  useEffect(() => {
    let mounted = true;
    const unwatch = watchMedia(name, store, key, () => {
      show(getCachedMedia(name, store, key)!);
    });
    const current = getCachedMedia(name, store, key);
    if (current !== undefined) show(current);
    else void loadCachedMedia(name, store, key).catch((error) => {
      if (mounted) {
        setLoading(false);
        notify.fail("資料庫出錯", error);
      }
    });
    return () => {
      mounted = false;
      unwatch();
    };
  }, [key]);
  useEffect(() => {
    if (cover)
      container.current!.parentElement!.classList.toggle(
        "has-image",
        !!picture,
      );
  }, [cover, picture]);
  return (
    <span ref={container} style={{ display: "contents" }}>
      <span
        className="upload-icon"
        style={{ display: !picture && !loading ? "flex" : "none" }}
      >
        +<span className="upload-text">點擊上傳</span>
      </span>
      <input
        type="file"
        className={cover ? "cover-art-file" : "file-input"}
        accept={cover || avatar ? "image/*" : "image/*, video/*"}
        onClick={(event) => {
          if (!avatar || !picture) return;
          event.preventDefault();
          void readAvatarEditor(avatar)
            .then(setEditor)
            .catch((error) => notify.fail("讀取失敗", error));
        }}
        onChange={async (event) => {
          const file = event.currentTarget.files?.[0];
          if (!file) return;
          event.currentTarget.value = "";
          if (avatar) {
            setEditor({ file, crop: INITIAL_AVATAR_CROP });
            return;
          }
          try {
            const media = file.type.startsWith("image/")
              ? await compressImage(file)
              : file;
            if (!cover && media.size > 5 * 1024 * 1024) {
              notify.fail("文件太大", "請選擇小於 5MB 的文件。");
              return;
            }
            await writeMedia(name, store, key, media);
          } catch (error) {
            notify.fail(cover ? "封面存失敗" : "保存失敗", error);
          }
        }}
      />
      {editor && avatar && (
        <AvatarCropper
          editor={editor}
          role={avatar}
          onClose={() => setEditor(null)}
          onSave={async (next) => {
            await saveAvatar(avatar, next);
            notify.ok("已更換");
          }}
        />
      )}
      {(picture || loading) && <DevelopingMedia className="media-photo" src={picture?.url} video={picture?.video}
        time={picture?.time} active={active} onPlaybackBlocked={() => setPlayButton(true)}
        onTimeUpdate={(src, time) => {
          const current = getCachedMedia(name, store, key);
          if (current?.url === src) current.time = time;
        }} />}
      {playButton && (
        <div
          className="video-play-btn"
          onClick={(event) => {
            event.preventDefault();
            event.stopPropagation();
            void container
              .current!.querySelector("video")!
              .play()
              .then(() => setPlayButton(false));
          }}
        >
          點擊播放
        </div>
      )}
    </span>
  );
}
