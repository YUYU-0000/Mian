// 共用照片显影层：先解码，再覆盖旧图；已经展示过的媒体重新挂载时直接显示。
import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type TransitionEvent, type ImgHTMLAttributes } from "react";
import { decodeImage, imageDecoded } from "../imageLoading";
import "./media.css";

const shown = new Set<string>();
let pictureId = 0;

type Picture = { id: number; src: string; video: boolean; animate: boolean; time: number };
type Props = {
  src?: string;
  video?: boolean;
  active?: boolean;
  time?: number;
  className?: string;
  style?: CSSProperties;
  alt?: string;
  referrerPolicy?: ImgHTMLAttributes<HTMLImageElement>["referrerPolicy"];
  onReady?: (image: HTMLImageElement) => void;
  onError?: () => void;
  onTimeUpdate?: (src: string, time: number) => void;
  onPlaybackBlocked?: () => void;
};

function Layer({ picture, active, alt, referrerPolicy, onFinish, onTimeUpdate, onPlaybackBlocked }: Props & {
  picture: Picture;
  onFinish: (id: number) => void;
}) {
  const element = useRef<HTMLImageElement | HTMLVideoElement>(null);
  const frames = useRef<number[]>([]);
  const reveal = () => {
    shown.add(picture.src);
    if (!picture.animate) return;
    // 留出起始帧，直接交给同一份 CSS 过渡；动画过程不更新 React。
    frames.current.push(requestAnimationFrame(() => {
      frames.current.push(requestAnimationFrame(() => element.current!.classList.remove("developing")));
    }));
  };
  useLayoutEffect(() => {
    if (!picture.video) reveal();
    return () => frames.current.forEach(cancelAnimationFrame);
  }, []);
  useEffect(() => {
    if (!picture.video) return;
    const video = element.current as HTMLVideoElement;
    if (active) void video.play().catch(() => onPlaybackBlocked?.());
    else video.pause();
  }, [active]);
  const shared = {
    className: `uploaded-media${picture.animate ? " developing" : ""}`,
    src: picture.src,
    style: picture.animate ? { willChange: "opacity, filter, transform" } : undefined,
    onTransitionEnd: (event: TransitionEvent<HTMLElement>) => {
      if (event.propertyName !== "filter") return;
      event.currentTarget.style.removeProperty("will-change");
      onFinish(picture.id);
    },
  };
  return picture.video ? (
    <video {...shared} ref={node => { element.current = node; }} autoPlay={active} loop muted playsInline
      onLoadedMetadata={event => { event.currentTarget.currentTime = picture.time; }}
      onLoadedData={reveal}
      onTimeUpdate={event => onTimeUpdate?.(picture.src, event.currentTarget.currentTime)} />
  ) : (
    <img {...shared} ref={node => { element.current = node; }} alt={alt} referrerPolicy={referrerPolicy} draggable={false} />
  );
}

export default function DevelopingMedia({ src, video = false, time = 0, active = true, className = "", style, ...props }: Props) {
  const [pictures, setPictures] = useState<Picture[]>(() => src && (shown.has(src) || imageDecoded(src))
    ? [{ id: ++pictureId, src, video, time, animate: !shown.has(src) }] : []);
  const callbacks = useRef(props);
  callbacks.current = props;
  useEffect(() => {
    let current = true;
    if (!src) { setPictures([]); return; }
    const show = () => setPictures(previous => {
      if (previous.at(-1)?.src === src) return previous;
      const animate = previous.length > 0 || !shown.has(src);
      return [...previous, { id: ++pictureId, src, video, time, animate }];
    });
    if (video) show();
    else void decodeImage(src, props.referrerPolicy).then(image => {
      if (!current) return;
      callbacks.current.onReady?.(image);
      show();
    }).catch(() => { if (current) callbacks.current.onError?.(); });
    return () => { current = false; };
  }, [src, video, props.referrerPolicy]);
  const finish = (finished: number) => setPictures(previous =>
    previous.at(-1)?.id === finished ? previous.slice(-1) : previous);
  return (
    <span className={`developing-media ${className}`} style={style} data-media-loading={!pictures.length || undefined}>
      {pictures.map(picture => <Layer key={picture.id} {...props} picture={picture} active={active} onFinish={finish} />)}
    </span>
  );
}
