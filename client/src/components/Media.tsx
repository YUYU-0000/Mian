import { getCachedMedia, loadCachedMedia, watchMedia, writeMedia, type CachedMedia } from "../mediaStorage";
import { compressImage } from "../imageCompression";
import {
  INITIAL_AVATAR_CROP,
  readAvatarEditor,
  saveAvatar,
  type AvatarEditor,
  type AvatarRole,
} from "../avatars";
import { useEffect, useRef, useState, type CSSProperties } from "react";
import { notify } from "./Notify";
import AvatarCropper from "./AvatarCropper";
import "./media.css";

type Picture = CachedMedia & { developing: boolean };
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
  const [pictures, setPictures] = useState<Picture[]>(() => cached ? [{ ...cached, developing: false }] : []);
  const [loading, setLoading] = useState(cached === undefined);
  const [icon, setIcon] = useState(!cached);
  const [playButton, setPlayButton] = useState(false);
  const [editor, setEditor] = useState<AvatarEditor | null>(null);
  const container = useRef<HTMLSpanElement>(null);
  const uploading = useRef(false);
  const timers = useRef<number[]>([]);
  const frames = useRef<number[]>([]);
  const show = (picture: CachedMedia | null, animate: boolean) => {
    setPictures((current) =>
      picture ? animate ? [...current, { ...picture, developing: true }]
        : [{ ...picture, developing: false }] : [],
    );
    setLoading(false);
    if (!animate) setIcon(!picture);
  };
  useEffect(() => {
    let mounted = true;
    const unwatch = watchMedia(name, store, key, () => {
      show(getCachedMedia(name, store, key)!, uploading.current);
      uploading.current = false;
    });
    const current = getCachedMedia(name, store, key);
    if (current !== undefined) show(current, false);
    else void loadCachedMedia(name, store, key).catch((error) => {
      if (mounted) {
        setLoading(false);
        notify.fail("資料庫出錯", error);
      }
    });
    return () => {
      mounted = false;
      unwatch();
      timers.current.forEach(window.clearTimeout);
      frames.current.forEach(cancelAnimationFrame);
    };
  }, [key]);
  useEffect(() => {
    if (cover)
      container.current!.parentElement!.classList.toggle(
        "has-image",
        pictures.length > 0,
      );
    container.current!.querySelectorAll("video").forEach((video) => {
      if (active) void video.play().catch(() => setPlayButton(true));
      else video.pause();
    });
  }, [active, pictures.length]);
  const developed = (picture: Picture) => {
    if (!picture.developing) return;
    frames.current.push(
      requestAnimationFrame(() =>
        frames.current.push(
          requestAnimationFrame(() => {
            setPictures((current) =>
              current.map((item) =>
                item.url === picture.url
                  ? { ...item, developing: false }
                  : item,
              ),
            );
          }),
        ),
      ),
    );
    timers.current.push(window.setTimeout(() => setIcon(false), 300));
    timers.current.push(
      window.setTimeout(() => {
        setPictures((current) => {
          const index = current.findIndex((item) => item.url === picture.url);
          return current.slice(index);
        });
      }, 900),
    );
  };
  const style = (index: number): CSSProperties => ({
    width: "100%",
    height: "100%",
    objectFit: "cover",
    position: "absolute",
    inset: 0,
    zIndex: index ? "2" : "1",
  });
  return (
    <span ref={container} style={{ display: "contents" }}>
      <span
        className="upload-icon"
        style={{ display: icon && !loading ? "flex" : "none" }}
      >
        +<span className="upload-text">點擊上傳</span>
      </span>
      <div
        className="loading-text"
        style={{ display: loading ? "block" : "none" }}
      >
        載入中
      </div>
      <input
        type="file"
        className={cover ? "cover-art-file" : "file-input"}
        accept={cover || avatar ? "image/*" : "image/*, video/*"}
        onClick={(event) => {
          if (!avatar || !pictures.length) return;
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
            uploading.current = true;
            await writeMedia(name, store, key, media);
          } catch (error) {
            uploading.current = false;
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
            uploading.current = true;
            try { await saveAvatar(avatar, next); }
            finally { uploading.current = false; }
            notify.ok("已更換");
          }}
        />
      )}
      {pictures.map((picture, index) =>
        picture.video ? (
          <video
            key={picture.url}
            className={`uploaded-media${picture.developing ? " developing" : ""}`}
            src={picture.url}
            style={style(index)}
            autoPlay={active}
            loop
            muted
            playsInline
            onLoadedMetadata={event => { event.currentTarget.currentTime = picture.time; }}
            onTimeUpdate={event => {
              const current = getCachedMedia(name, store, key);
              if (current?.url === picture.url) current.time = event.currentTarget.currentTime;
            }}
            onLoadedData={() => developed(picture)}
          />
        ) : (
          <img
            key={picture.url}
            className={`uploaded-media${picture.developing ? " developing" : ""}`}
            src={picture.url}
            style={cover ? { zIndex: index ? "2" : "1" } : style(index)}
            onLoad={() => developed(picture)}
            alt=""
          />
        ),
      )}
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
