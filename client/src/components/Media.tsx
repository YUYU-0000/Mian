import { openMediaDatabase, writeMedia } from "../mediaStorage";
import { applyAvatar, cropAvatar, type AvatarRole } from "../avatars";
import { useEffect, useRef, useState, type CSSProperties } from "react";
import { notify } from "./Notify";

type Picture = { url: string; video: boolean; developing: boolean };
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
  const [pictures, setPictures] = useState<Picture[]>([]);
  const [loading, setLoading] = useState(true);
  const [icon, setIcon] = useState(true);
  const [playButton, setPlayButton] = useState(false);
  const container = useRef<HTMLSpanElement>(null);
  const urls = useRef(new Set<string>());
  const timers = useRef<number[]>([]);
  const frames = useRef<number[]>([]);
  const name = cover ? "mian_connections" : "LauncherDB";
  const store = cover ? "media" : "mediaStore";
  const key = cover ? `${storageKey}_cover` : `savedMediaFile_${storageKey}`;
  const show = (file: Blob, animate: boolean) => {
    const url = URL.createObjectURL(file);
    urls.current.add(url);
    setPictures((current) =>
      animate
        ? [
            ...current,
            { url, video: file.type.startsWith("video/"), developing: true },
          ]
        : [{ url, video: file.type.startsWith("video/"), developing: false }],
    );
    setLoading(false);
    if (!animate) setIcon(false);
  };
  useEffect(() => {
    let mounted = true;
    openMediaDatabase(name, store)
      .then((db) => {
        const request = db.transaction(store).objectStore(store).get(key);
        request.onsuccess = () => {
          if (!mounted) return;
          if (request.result) show(request.result, false);
          else setLoading(false);
        };
        request.onerror = () => {
          if (mounted) {
            setLoading(false);
            notify.fail("讀取失敗", request.error);
          }
        };
      })
      .catch((error) => {
        if (mounted) {
          setLoading(false);
          notify.fail("資料庫出錯", error);
        }
      });
    return () => {
      mounted = false;
      urls.current.forEach((url) => URL.revokeObjectURL(url));
      urls.current.clear();
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
          current.slice(0, index).forEach((item) => {
            URL.revokeObjectURL(item.url);
            urls.current.delete(item.url);
          });
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
        className={`upload-icon${cover ? " js-icon" : ""}`}
        style={{ display: icon && !loading ? "flex" : "none" }}
      >
        +<span className="upload-text">點擊上傳</span>
      </span>
      <div
        className={`loading-text${cover ? " js-loading" : ""}`}
        style={{ display: loading ? "block" : "none" }}
      >
        載入中
      </div>
      <input
        type="file"
        className={cover ? "cover-art-file js-file" : "file-input"}
        accept={cover || avatar ? "image/*" : "image/*, video/*"}
        onChange={async (event) => {
          const file = event.currentTarget.files?.[0];
          if (!file) return;
          event.currentTarget.value = "";
          if (!cover && !avatar && file.size > 5 * 1024 * 1024) {
            notify.fail("文件太大", "請選擇小於 5MB 的文件。");
            return;
          }
          try {
            const picture = avatar ? await cropAvatar(file) : file;
            show(picture, true);
            await writeMedia(name, store, key, picture);
            if (avatar) {
              applyAvatar(avatar, picture);
              notify.ok("已更換");
            }
          } catch (error) {
            notify.fail(
              avatar ? "上傳失敗" : cover ? "封面存失敗" : "保存失敗",
              error,
            );
          }
        }}
      />
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
