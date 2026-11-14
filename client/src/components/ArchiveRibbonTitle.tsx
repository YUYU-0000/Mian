import { useLayoutEffect, useRef, useState } from "react";

type RibbonTitleValue = {
  conversationId: string;
  text: string;
};

type RibbonTitleTransition = {
  from: RibbonTitleValue;
  to: RibbonTitleValue;
  generation: number;
};

export default function ArchiveRibbonTitle({
  conversationId,
  title,
}: {
  conversationId: string;
  title: string;
}) {
  const target = {
    conversationId,
    text: title || "ARCHIVE CHAT",
  };
  const [displayed, setDisplayed] = useState<RibbonTitleValue>(target);
  const [transition, setTransition] =
    useState<RibbonTitleTransition | null>(null);
  const generation = useRef(0);
  const targetIdentity = `${target.conversationId}\u0000${target.text}`;
  const visibleTarget = transition?.to ?? displayed;
  const visibleIdentity = `${visibleTarget.conversationId}\u0000${visibleTarget.text}`;

  useLayoutEffect(() => {
    if (targetIdentity === visibleIdentity) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setDisplayed(target);
      setTransition(null);
      return;
    }
    const nextGeneration = ++generation.current;
    setTransition((current) => ({
      from: current?.from ?? displayed,
      to: target,
      generation: nextGeneration,
    }));
  }, [displayed, targetIdentity, visibleIdentity]);

  return (
    <div
      id="archiveRibbonTitle"
      data-title-conversation-id={target.conversationId}
      data-title-transition-generation={transition?.generation ?? 0}
    >
      {transition ? (
        <>
          <span className="archive-title-text archive-title-outgoing">
            {transition.from.text}
          </span>
          <span
            key={transition.generation}
            className="archive-title-text archive-title-incoming"
            onAnimationEnd={(event) => {
              if (
                event.currentTarget !== event.target ||
                event.animationName !== "archiveTitleInkIn" ||
                generation.current !== transition.generation
              )
                return;
              setDisplayed(transition.to);
              setTransition(null);
            }}
          >
            {transition.to.text}
          </span>
        </>
      ) : (
        <span className="archive-title-text">{displayed.text}</span>
      )}
    </div>
  );
}
