import { useId, type Ref } from "react";
import DATA from "./authFishData.json";

const [x, y, width, height] = DATA.vb;
const bounds = { x, y, width, height };
const ys = DATA.paths.map(path => path.y);
const ymin = Math.min(...ys), ymax = Math.max(...ys);
const strokes = DATA.paths.map(path => ({
  ...path,
  start: (path.y - ymin) / (ymax - ymin) * 0.62,
  duration: Math.min(0.38, 0.12 + path.len / height * 0.5),
}));
const dots = DATA.dots.map(([cx, cy]) => ({ cx, cy, at: (cy - ymin) / (ymax - ymin) * 0.75 }));
const cx = DATA.dots.reduce((sum, dot) => sum + dot[0], 0) / DATA.dots.length;
const cy = DATA.dots.reduce((sum, dot) => sum + dot[1], 0) / DATA.dots.length;
const radius = Math.max(...DATA.dots.map(([dx, dy]) => Math.hypot(dx - cx, dy - cy))) + width / 300 * 2;
const clamp = (value: number) => Math.max(0, Math.min(1, value));

export default function AuthFish({ svgRef }: { svgRef: Ref<SVGSVGElement> }) {
  const id = useId();
  const alpha = `${id}-fish`, reveal = `${id}-reveal`, gradient = `${id}-gradient`;
  return <svg ref={svgRef} className="auth-fish" viewBox={DATA.vb.join(" ")} aria-hidden="true" stroke="none">
    <defs>
      <mask id={alpha} maskUnits="userSpaceOnUse" {...bounds} style={{ maskType: "alpha" }}>
        <image href="/fish_hi.png" {...bounds} />
      </mask>
      <linearGradient id={gradient} gradientUnits="userSpaceOnUse" x1={x + width * 0.32} x2={x + width * 0.68} y1={0} y2={0}>
        <stop offset="0" stopColor="#7f9bb8" /><stop offset="1" stopColor="#c58f92" />
      </linearGradient>
      <mask id={reveal} maskUnits="userSpaceOnUse" {...bounds}>
        {strokes.map((path, index) => <path key={index} data-stroke d={path.d} pathLength={1}
          fill="none" stroke="#fff" strokeWidth={width / 300 * 9} strokeLinecap="round" strokeLinejoin="round"
          strokeDasharray={1} strokeDashoffset={1} />)}
        {dots.map((dot, index) => <circle key={index} data-dot cx={dot.cx} cy={dot.cy} r={0} fill="#fff" />)}
        <circle data-ring cx={cx} cy={cy} r={radius} fill="none" stroke="#fff" strokeWidth={width / 300 * 10}
          pathLength={1} strokeDasharray={1} strokeDashoffset={1} transform={`rotate(-90 ${cx} ${cy})`} />
      </mask>
    </defs>
    <g mask={`url(#${alpha})`} opacity={0.2}><rect {...bounds} fill={`url(#${gradient})`} /></g>
    <g className="auth-fish-ink" mask={`url(#${alpha})`}>
      <rect {...bounds} fill={`url(#${gradient})`} mask={`url(#${reveal})`} />
    </g>
  </svg>;
}

export function drawFish(svg: SVGSVGElement, ready: Promise<unknown>) {
  const paths = svg.querySelectorAll<SVGPathElement>("[data-stroke]");
  const circles = svg.querySelectorAll<SVGCircleElement>("[data-dot]");
  const ring = svg.querySelector<SVGCircleElement>("[data-ring]")!;
  const paint = (progress: number) => {
    paths.forEach((path, index) => {
      const stroke = strokes[index];
      path.style.strokeDashoffset = String(Math.pow(1 - clamp((progress - stroke.start) / stroke.duration), 2.2));
    });
    circles.forEach((circle, index) => circle.setAttribute("r", String(progress > dots[index].at ? width / 300 * 6 : 0)));
    ring.style.strokeDashoffset = String(1 - clamp((progress - 0.2) / 0.7));
  };
  const started = performance.now();
  let frame = 0, progress = 0, readyAt: number | undefined, finishFrom = 0, finishDuration = 0;
  let rejectDrawing: (error: unknown) => void;
  paint(0);
  const finished = new Promise<void>((resolve, reject) => {
    rejectDrawing = reject;
    ready.then(() => {
      readyAt = performance.now();
      finishFrom = progress;
      finishDuration = Math.max(300, 3000 - (readyAt - started));
    }, error => { cancelAnimationFrame(frame); reject(error); });
    const tick = (now: number) => {
      const elapsed = (now - started) / 3000;
      // 慢请求停留在最后几笔，准备好后从当前笔迹继续，不跳到终点。
      progress = readyAt === undefined
        ? elapsed <= 0.85 ? elapsed : 0.85 + (1 - Math.exp(-(elapsed - 0.85) * 1.2)) * 0.04
        : finishFrom + (1 - finishFrom) * clamp((now - readyAt) / finishDuration);
      paint(progress);
      if (progress >= 1) resolve();
      else frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
  });
  return {
    finished,
    cancel() { cancelAnimationFrame(frame); rejectDrawing(new DOMException("Drawing cancelled", "AbortError")); },
  };
}
