import type { CSSProperties } from "react";
export const avatarFlower = (
  <svg
    className="wp-flower-svg"
    viewBox="0 0 80 160"
    xmlns="http://www.w3.org/2000/svg"
  >
    <path
      d="M 40,45 Q 45,90 37,125 T 35,160"
      fill="none"
      stroke="#4a3e36"
      strokeWidth="1.2"
      strokeLinecap="round"
    />
    <g
      className="clickable-flora"
      style={{ "--origin-x": "41.5px", "--origin-y": "95px" } as CSSProperties}
    >
      <path
        d="M 41.5,95 C 47,92 52,85 54,80 C 49,85 43.5,88 41.5,95"
        fill="#5c6352"
      />
    </g>
    <g
      className="clickable-flora"
      style={{ "--origin-x": "36.5px", "--origin-y": "130px" } as CSSProperties}
    >
      <path
        d="M 36.5,130 C 30,128 25,122 22,118 C 26,122 32,124 36.5,130"
        fill="#5c6352"
      />
    </g>
    <g
      className="clickable-flora"
      style={{ "--origin-x": "40px", "--origin-y": "45px" } as CSSProperties}
    >
      <path
        d="M 40,45 C 22,32 25,15 40,16 C 55,17 58,32 40,45"
        fill="rgba(102, 144, 204, 0.85)"
        transform="rotate(-45 40 45)"
      />
    </g>
    <g
      className="clickable-flora"
      style={{ "--origin-x": "40px", "--origin-y": "45px" } as CSSProperties}
    >
      <path
        d="M 40,45 C 20,33 28,14 41,15 C 54,16 60,33 40,45"
        fill="rgba(88, 131, 191, 0.85)"
        transform="rotate(45 40 45)"
      />
    </g>
    <g
      className="clickable-flora"
      style={{ "--origin-x": "40px", "--origin-y": "45px" } as CSSProperties}
    >
      <path
        d="M 40,45 C 23,30 24,17 39,18 C 56,19 57,31 40,45"
        fill="rgba(94, 137, 197, 0.8)"
        transform="rotate(135 40 45)"
      />
    </g>
    <g
      className="clickable-flora"
      style={{ "--origin-x": "40px", "--origin-y": "45px" } as CSSProperties}
    >
      <path
        d="M 40,45 C 21,34 29,16 42,17 C 53,18 59,34 40,45"
        fill="rgba(112, 154, 214, 0.85)"
        transform="rotate(225 40 45)"
      />
    </g>
    <circle cx="40" cy="45" r="3" fill="#242b47" opacity="0.95" />
    <circle cx="40" cy="45" r="1.5" fill="#35406b" />
  </svg>
);
