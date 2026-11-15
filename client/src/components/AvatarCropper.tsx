import {
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type PointerEvent,
} from "react";
import { createPortal } from "react-dom";
import {
  INITIAL_AVATAR_CROP,
  type AvatarCrop,
  type AvatarEditor,
  type AvatarRole,
} from "../avatars";
import { notify } from "./Notify";
import "./hang-tag.css";
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
  role,
  onSave,
  onClose,
}: {
  editor: AvatarEditor;
  role: AvatarRole;
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
  const [visible, setVisible] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const pathId = useId();
  const pose = useRef(crop);
  const frame = useRef<HTMLDivElement>(null);
  const pointers = useRef(new Map<number, Point>());

  useLayoutEffect(() => {
    const element = dialog.current!;
    element.showModal();
    void element.offsetWidth;
    const opening = requestAnimationFrame(() => setVisible(true));
    return () => {
      cancelAnimationFrame(opening);
      element.close();
    };
  }, []);

  const close = () => {
    if (!saving) setVisible(false);
  };
  const save = async () => {
    setSaving(true);
    try {
      await onSave({ file, crop });
      setVisible(false);
    } catch (error) {
      notify.fail("保存失敗", error);
      setSaving(false);
    }
  };

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
      x: (clientX - rect.left - rect.width / 2) / rect.width,
      y: (clientY - rect.top - rect.height / 2) / rect.height,
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
      ref={dialog}
      className="avatar-cropper"
      aria-label="調整頭像"
      tabIndex={-1}
      onCancel={(event) => {
        event.preventDefault();
        close();
      }}
    >
      <div
        className={`tag-overlay${visible ? " is-visible" : ""}`}
        onClick={close}
      />
      <div
        className={`hang-tag${visible ? " is-visible" : ""}`}
        onTransitionEnd={(event) => {
          if (
            event.target === event.currentTarget &&
            event.propertyName === "transform" &&
            !visible
          )
            onClose();
        }}
      >
        <div className="tag-string" />
        <div className="avatar-crop-disc">
          <div
            ref={frame}
            className="avatar-crop-frame"
            inert={saving || !size}
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
                  width: `${((size?.width ?? 1) / short) * crop.zoom * 100}%`,
                  height: `${((size?.height ?? 1) / short) * crop.zoom * 100}%`,
                  left: `${50 + crop.x * 100}%`,
                  top: `${50 + crop.y * 100}%`,
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
          </div>
          <svg className="avatar-crop-ring" viewBox="0 0 200 200">
            <defs>
              <path
                id={`${pathId}-top`}
                d="M 13.08 100 A 86.92 86.92 0 0 1 186.92 100"
              />
              <path
                id={`${pathId}-bottom`}
                d="M 7.69 100 A 92.31 92.31 0 0 0 192.31 100"
              />
            </defs>
            <g fill="none" stroke="rgba(59,77,90,.3)" strokeWidth=".615">
              <circle cx="100" cy="100" r="96.15" />
              <circle cx="100" cy="100" r="80.38" />
            </g>
            <circle
              cx="100"
              cy="10"
              r="4.62"
              fill="none"
              stroke="rgba(59,77,90,.25)"
              strokeWidth=".846"
            />
            <circle cx="100" cy="10" r="3.08" fill="#5d6b75" />
            <g className="avatar-crop-heading" textAnchor="middle">
              <text>
                <textPath href={`#${pathId}-top`} startOffset="27%">
                  PORTRAIT
                </textPath>
              </text>
              <text>
                <textPath href={`#${pathId}-top`} startOffset="40%">
                  —
                </textPath>
              </text>
              <text>
                <textPath href={`#${pathId}-top`} startOffset="60%">
                  —
                </textPath>
              </text>
              <text>
                <textPath href={`#${pathId}-top`} startOffset="73%">
                  {role === "assistant" ? "彼方肖像" : "此方肖像"}
                </textPath>
              </text>
            </g>
            <g className="avatar-crop-actions" textAnchor="middle">
              {[
                { name: "confirm", label: "確定", offset: "31%", run: save },
                {
                  name: "replace",
                  label: "換照片",
                  offset: "50%",
                  run: () => fileInput.current!.click(),
                },
                { name: "cancel", label: "取消", offset: "69%", run: close },
              ].map((action) => (
                <text
                  key={action.name}
                  className={`avatar-crop-${action.name}`}
                  role="button"
                  aria-disabled={saving || !size}
                  tabIndex={saving || !size ? -1 : 0}
                  onClick={() => {
                    if (!saving && size) void action.run();
                  }}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      if (!saving && size) void action.run();
                    }
                  }}
                >
                  <textPath
                    href={`#${pathId}-bottom`}
                    startOffset={action.offset}
                  >
                    {action.label}
                  </textPath>
                </text>
              ))}
              <text className="avatar-crop-divider">
                <textPath href={`#${pathId}-bottom`} startOffset="41%">
                  —
                </textPath>
              </text>
              <text className="avatar-crop-divider">
                <textPath href={`#${pathId}-bottom`} startOffset="59%">
                  —
                </textPath>
              </text>
            </g>
          </svg>
        </div>
      </div>
      <input
        ref={fileInput}
        type="file"
        accept="image/*"
        hidden
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
    </dialog>,
    document.body,
  );
}
