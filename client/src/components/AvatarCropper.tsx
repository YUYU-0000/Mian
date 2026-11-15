import { useEffect, useRef, useState, type PointerEvent } from "react";
import { createPortal } from "react-dom";
import {
  INITIAL_AVATAR_CROP,
  type AvatarCrop,
  type AvatarEditor,
} from "../avatars";
import { notify } from "./Notify";
import { usePaperPreview } from "./usePaperPreview";
import "./file-preview.css";
import "./avatar-cropper.css";

type Point = { x: number; y: number };
const midpoint = (a: Point, b: Point) => ({
  x: (a.x + b.x) / 2,
  y: (a.y + b.y) / 2,
});
const distance = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);
const zoomLimit = (zoom: number) => Math.max(1, Math.min(4, zoom));

export default function AvatarCropper({
  editor,
  onSave,
  onClose,
}: {
  editor: AvatarEditor;
  onSave: (editor: AvatarEditor) => Promise<void>;
  onClose: () => void;
}) {
  const [file, setFile] = useState(editor.file);
  const [url, setUrl] = useState("");
  const [size, setSize] = useState<{ width: number; height: number } | null>(
    null,
  );
  const [crop, setCrop] = useState(editor.crop);
  const [saving, setSaving] = useState(false);
  const pose = useRef(crop);
  const frame = useRef<HTMLDivElement>(null);
  const pointers = useRef(new Map<number, Point>());
  const preview = usePaperPreview(size !== null, false, onClose, () => {});

  useEffect(() => {
    const source = URL.createObjectURL(file);
    setUrl(source);
    return () => URL.revokeObjectURL(source);
  }, [file]);

  const update = (next: AvatarCrop) => {
    const short = Math.min(size!.width, size!.height);
    const limitX = ((size!.width / short) * next.zoom - 1) / 2;
    const limitY = ((size!.height / short) * next.zoom - 1) / 2;
    pose.current = {
      ...next,
      x: Math.max(-limitX, Math.min(limitX, next.x)),
      y: Math.max(-limitY, Math.min(limitY, next.y)),
    };
    setCrop(pose.current);
  };
  const point = (clientX: number, clientY: number): Point => {
    const rect = frame.current!.getBoundingClientRect();
    return {
      x: (clientX - rect.left - rect.width / 2) / (rect.width * 0.8),
      y: (clientY - rect.top - rect.height / 2) / (rect.width * 0.8),
    };
  };
  const zoomAt = (zoom: number, focus: Point = { x: 0, y: 0 }) => {
    const current = pose.current;
    const next = zoomLimit(zoom);
    update({
      zoom: next,
      x: focus.x - ((focus.x - current.x) * next) / current.zoom,
      y: focus.y - ((focus.y - current.y) * next) / current.zoom,
    });
  };
  useEffect(() => {
    if (!size) return;
    const element = frame.current!;
    const wheel = (event: WheelEvent) => {
      event.preventDefault();
      zoomAt(
        pose.current.zoom * Math.exp(-event.deltaY * 0.002),
        point(event.clientX, event.clientY),
      );
    };
    element.addEventListener("wheel", wheel, { passive: false });
    return () => element.removeEventListener("wheel", wheel);
  }, [size]);

  const move = (event: PointerEvent<HTMLDivElement>) => {
    if (!pointers.current.has(event.pointerId)) return;
    const previous = [...pointers.current.values()];
    const before = pointers.current.get(event.pointerId)!;
    const next = point(event.clientX, event.clientY);
    pointers.current.set(event.pointerId, next);
    const current = pose.current;
    if (pointers.current.size === 1) {
      update({
        ...current,
        x: current.x + next.x - before.x,
        y: current.y + next.y - before.y,
      });
    } else {
      const after = [...pointers.current.values()];
      const from = midpoint(previous[0], previous[1]);
      const to = midpoint(after[0], after[1]);
      const zoom = zoomLimit(
        (current.zoom * distance(after[0], after[1])) /
          distance(previous[0], previous[1]),
      );
      update({
        zoom,
        x: to.x - ((from.x - current.x) * zoom) / current.zoom,
        y: to.y - ((from.y - current.y) * zoom) / current.zoom,
      });
    }
  };
  const end = (event: PointerEvent<HTMLDivElement>) => {
    pointers.current.delete(event.pointerId);
  };
  const short = size ? Math.min(size.width, size.height) : 1;

  return createPortal(
    <dialog
      ref={preview.dialog}
      className="pv-viewer avatar-cropper"
      aria-label="調整頭像"
      tabIndex={-1}
      onCancel={(event) => {
        event.preventDefault();
        if (!saving) preview.close();
      }}
    >
      <div
        className="pv-mask"
        ref={preview.mask}
        onClick={() => {
          if (!saving) preview.close();
        }}
      />
      <div className={`pv${size ? " is-ready" : ""}`}>
        <div className="pv-motion" ref={preview.paper}>
          <div className="pv-under a" />
          <div className="pv-under b" />
          <div className="pv-card">
            <div
              ref={frame}
              className="avatar-crop-frame"
              onPointerDown={(event) => {
                if (event.button !== 0) return;
                event.currentTarget.setPointerCapture(event.pointerId);
                pointers.current.set(
                  event.pointerId,
                  point(event.clientX, event.clientY),
                );
              }}
              onPointerMove={move}
              onPointerUp={end}
              onPointerCancel={end}
              onLostPointerCapture={end}
            >
              {url && (
                <img
                  src={url}
                  alt="頭像裁切預覽"
                  draggable={false}
                  style={{
                    width: `${((size?.width ?? 1) / short) * crop.zoom * 80}%`,
                    height: `${((size?.height ?? 1) / short) * crop.zoom * 80}%`,
                    left: `${50 + crop.x * 80}%`,
                    top: `${50 + crop.y * 80}%`,
                  }}
                  onLoad={(event) =>
                    setSize({
                      width: event.currentTarget.naturalWidth,
                      height: event.currentTarget.naturalHeight,
                    })
                  }
                  onError={() => {
                    notify.fail("圖片讀取失敗", "圖片無法載入。");
                    onClose();
                  }}
                />
              )}
              <div className="avatar-crop-circle" />
            </div>
            <div className="avatar-crop-controls">
              <label className="avatar-crop-replace">
                更換照片
                <input
                  type="file"
                  accept="image/*"
                  disabled={saving}
                  onChange={(event) => {
                    const next = event.currentTarget.files?.[0];
                    if (!next) return;
                    setSize(null);
                    pose.current = INITIAL_AVATAR_CROP;
                    setCrop(INITIAL_AVATAR_CROP);
                    setFile(next);
                    event.currentTarget.value = "";
                  }}
                />
              </label>
              <input
                className="avatar-crop-zoom"
                type="range"
                aria-label="頭像縮放"
                min="1"
                max="4"
                step="0.01"
                value={crop.zoom}
                disabled={saving}
                onChange={(event) => zoomAt(Number(event.currentTarget.value))}
              />
              <div className="avatar-crop-actions">
                <button
                  type="button"
                  disabled={saving}
                  onClick={async () => {
                    setSaving(true);
                    try {
                      await onSave({ file, crop });
                      preview.close();
                    } catch (error) {
                      notify.fail("保存失敗", error);
                      setSaving(false);
                    }
                  }}
                >
                  確定
                </button>
                <button type="button" disabled={saving} onClick={preview.close}>
                  取消
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </dialog>,
    document.body,
  );
}
