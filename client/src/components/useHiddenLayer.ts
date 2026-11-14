import {
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type TransitionEvent,
} from "react";
import { measureText } from "./ScrollText";

// 退出动画结束后跳过隐藏内容的布局，保留表单与纸片状态。
export function useHiddenLayer<T extends HTMLElement = HTMLDivElement>(
  visible: boolean,
  endProperty: string,
) {
  const ref = useRef<T>(null);
  const [retained, setRetained] = useState(visible);
  useLayoutEffect(() => {
    if (visible) {
      setRetained(true);
      for (const text of ref.current!.querySelectorAll<HTMLElement>(
        ".scroll-text",
      ))
        measureText(text);
    }
  }, [visible]);
  const hidden = !visible && !retained;
  return {
    ref,
    "data-content-hidden": hidden ? "" : undefined,
    style: {
      contentVisibility: hidden ? "hidden" : "visible",
    } as CSSProperties,
    onTransitionEnd: (event: TransitionEvent<HTMLElement>) => {
      if (
        event.target === event.currentTarget &&
        event.propertyName === endProperty &&
        !visible
      )
        setRetained(false);
    },
  };
}
