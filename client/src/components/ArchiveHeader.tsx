import "./archive-header.css";

export function BackFish() {
  return (
    <svg
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path
        d="M10 4L2 12L10 20"
        stroke="var(--icon-bg-4)"
        strokeWidth="1.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx="9" cy="12" r="1.4" fill="var(--icon-bg-4)" />
      <path
        d="M18 8.5L13.5 12L18 15.5"
        stroke="var(--icon-bg-4)"
        strokeWidth="1.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function ArchiveTitle({ en, cn }: { en: string; cn: string }) {
  return (
    <div className="right-decor">
      <div className="archive-en">{en}</div>
      <div className="decor-line" />
      <div className="archive-cn">{cn}</div>
    </div>
  );
}
