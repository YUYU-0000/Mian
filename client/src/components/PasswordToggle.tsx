import AnimatedText from "./AnimatedText";
import "./password-toggle.css";

export default function PasswordToggle({ visible, onToggle, className = "" }: {
  visible: boolean;
  onToggle: () => void;
  className?: string;
}) {
  return <button type="button" className={`password-toggle ${className}`} aria-pressed={visible}
    aria-label={visible ? "隱藏密碼" : "顯示密碼"}
    onPointerDown={event => event.preventDefault()} onClick={onToggle}>
    <AnimatedText text={visible ? "HIDE" : "SHOW"} />
  </button>;
}
