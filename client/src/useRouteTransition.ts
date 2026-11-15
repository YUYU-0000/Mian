import { useRef, useState, type AnimationEvent } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { preloadReplyMarkdown } from "./components/DeferredReplyMarkdown";

type TransitionPhase = "press" | "crossfade";
type RouteTransition = {
  target: string;
  phase: TransitionPhase;
  fromLocation: ReturnType<typeof useLocation>;
};
export function useRouteTransition() {
  const nav = useNavigate();
  const location = useLocation();
  const [transition, setTransition] = useState<RouteTransition | null>(null);
  const transitionLocked = useRef(false);
  const navigateWithTransition = (target: string) => {
    if (target === "/chat") void preloadReplyMarkdown();
    if (target === location.pathname || transitionLocked.current) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      nav(target);
      return;
    }
    transitionLocked.current = true;
    setTransition({
      target,
      phase: "press",
      fromLocation: location,
    });
  };

  const finishTransition = () => {
    transitionLocked.current = false;
    setTransition(null);
  };

  const handleTransitionEnd = (event: AnimationEvent<HTMLDivElement>) => {
    if (!transition) return;
    if (
      transition.phase === "press" &&
      event.animationName === "routeControlPress"
    ) {
      nav(transition.target);
      setTransition({ ...transition, phase: "crossfade" });
      return;
    }
    if (
      transition.phase === "crossfade" &&
      event.animationName === "routePageEnter" &&
      event.target instanceof HTMLElement &&
      event.target.classList.contains("route-transition-incoming")
    )
      finishTransition();
  };

  return { location, transition, navigateWithTransition, handleTransitionEnd };
}
