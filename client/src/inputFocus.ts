// 接管输入框与标签聚焦，阻止浏览器自动滚动并保留触屏键盘激活。
export const editableSelector = "textarea:not(:disabled):not([readonly]),input:not(:disabled):not([readonly]):not([type=\"file\"]):not([type=\"range\"]):not([type=\"checkbox\"]):not([type=\"radio\"]):not([type=\"hidden\"]):not([type=\"button\"]):not([type=\"submit\"]),[contenteditable=\"true\"]";

export function installInputFocus() {
  const focus = (event: MouseEvent | PointerEvent) => {
    if (event.button !== 0) return;
    const target = event.target as Element;
    const direct = target.closest<HTMLElement>(editableSelector);
    if (!direct && target.closest("button,a,select")) return;
    const field = direct ?? target.closest("label")?.control;
    if (!field?.matches(editableSelector)) return;
    // 已聚焦字段保留原生光标定位和选字；label 不再走浏览器的聚焦滚动。
    if (field === document.activeElement && direct) return;
    event.preventDefault();
    // 触屏的用户激活在松手后才成立，等 click 再聚焦才能正常唤起软键盘。
    if (event.type === "pointerdown" && (event as PointerEvent).pointerType !== "mouse") return;
    field.focus({ preventScroll: true });
  };
  document.addEventListener("pointerdown", focus, true);
  document.addEventListener("click", focus, true);
}
