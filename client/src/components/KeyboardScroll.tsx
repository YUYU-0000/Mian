import type { ReactNode } from "react";
import "../keyboard.css";

// 纸面尺寸和装饰不动，键盘遮住的内容在这一层滚动。
export default function KeyboardScroll({ children }: { children: ReactNode }) {
  return <div className="keyboard-scroll" data-keyboard-scroll>
    <div className="keyboard-content">{children}</div>
  </div>;
}
