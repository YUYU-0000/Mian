// Gesture geometry and animation values from the connection design.
export type PaperStack = { index: number; dragged: boolean; busy: boolean; update: () => void; current: () => HTMLElement; goTo: (index: number) => void; destroy: () => void };
        export function makeStack(track: HTMLDivElement, onChange: (index: number) => void): PaperStack {
            /* 紙張層級按頁序固定；只顯示目前頁與下一頁，抽走的紙保持隱藏。 */
            const vp = track.parentElement!;
            const controller = new AbortController();
            const signal = controller.signal;
            const st: PaperStack = { index: 0, dragged: false, busy: false, update: () => {}, current: () => track.children[0] as HTMLElement, goTo: () => {}, destroy: () => {} };
            const shade = document.createElement('div');
            shade.className = 'stack-shadow';
            shade.setAttribute('aria-hidden', 'true');
            const pages = () => (Array.from(track.children) as HTMLElement[]).filter(p => p !== shade);
            const EASE = 'cubic-bezier(.25,.8,.3,1)';
            const DUR = 620;
            const soft = (d: number, w: number) => { const cap = w * 0.85; return Math.sign(d) * cap * (1 - Math.exp(-Math.abs(d) / cap)); };
            let w = 0, off = 0;
            let motion: { animation: Animation; shadowAnimation: Animation; index: number } | null = null;
            let sx = 0, sy = 0, cx = 0, t0 = 0, dragging = false, pid = 0;
            /* 拖動時微微旋轉並帶陰影；抽出末段淡出，上一張隨右拖淡入。 */
            const transform = (x: number) => `translate3d(${x}px, ${-x * 0.012}px, 0) rotate(${x * 0.01}deg)`;
            function shadow(paper: HTMLElement, strength: number) {
                shade.style.zIndex = String(Number(paper.style.zIndex) - 1);
                shade.style.transform = paper.style.transform;
                shade.style.opacity = String(strength * Number(paper.style.opacity));
            }

            function rest() {
                w = vp.clientWidth;
                off = (window.innerWidth + w) / 2 + vp.clientHeight * 0.2 + 40;
                const list = pages();
                list.forEach((p, i) => {
                    p.style.zIndex = String((list.length - i) * 2);
                    p.style.visibility = i === st.index || i === st.index + 1 ? 'visible' : 'hidden';
                    p.style.opacity = String(i < st.index ? 0 : 1);
                    p.style.transform = transform(i < st.index ? -off : 0);
                    p.inert = i !== st.index;
                });
                shade.style.opacity = String(0);
            }
            st.update = () => {
                track.appendChild(shade);
                rest();
                if (motion) {
                    motion.animation.onfinish = null;
                    motion.animation.cancel();
                    motion.shadowAnimation.cancel();
                    motion = null;
                }
                dragging = false;
                st.busy = false;
                onChange && onChange(st.index);
            };
            st.current = () => pages()[st.index];

            function paint(d: number) {
                const list = pages(), cur = list[st.index], prev = list[st.index - 1];
                const pulling = d < 0 && st.index < list.length - 1;
                const k = pulling ? Math.min(1, -d / w) : 0;
                cur.style.transform = transform(pulling ? d : 0);
                cur.style.opacity = String(k > 0.85 ? Math.max(0, 1 - (k - 0.85) / 0.15) : 1);
                if (prev) {
                    /* 右拖時，上一張從紙堆左側淡入，隨手勢蓋回。 */
                    const kp = Math.min(1, Math.max(0, d) / w);
                    prev.style.transform = transform(-(w + 40) * (1 - kp));
                    prev.style.opacity = String(Math.min(1, kp * 3));
                    prev.style.visibility = kp > 0 ? 'visible' : 'hidden';
                    if (d > 0) { shadow(prev, 1 - kp); return; }
                }
                shadow(cur, k);
            }

            function finish() {
                if (!motion) return;
                const changed = st.index !== motion.index;
                st.index = motion.index;
                motion.animation.onfinish = null;
                /* 先寫入落定狀態，再取消動畫；淡出的紙不會重新變成不透明。 */
                rest();
                motion.animation.cancel();
                motion.shadowAnimation.cancel();
                motion = null;
                st.busy = false;
                if (changed && onChange) onChange(st.index);
            }

            /* 回彈與翻頁共用動畫，先設定終點樣式，再銜接拖曳位置。 */
            function settle(i: number, d: number) {
                const list = pages();
                const returning = d > 0 && st.index > 0;
                const paper = list[returning ? st.index - 1 : st.index];
                const from = { transform: paper.style.transform, opacity: paper.style.opacity || 1 };
                const shadowFrom = { transform: from.transform, opacity: shade.style.opacity };
                const toX = returning ? (i < st.index ? 0 : -off) : (i > st.index ? -off : 0);
                const out = toX !== 0;   /* 移至螢幕外 */
                /* 保留可見範圍內的淡出；結束後先隱藏，再移到螢幕外。 */
                const visX = out ? (returning ? -(w + 40) : -w * 1.08) : 0;
                const to = { transform: transform(visX), opacity: out ? 0 : 1 };
                const shadowTo = { transform: to.transform, opacity: 0 };
                paper.style.visibility = 'visible';
                paper.style.transform = to.transform;
                paper.style.opacity = String(to.opacity);
                shade.style.zIndex = String(Number(paper.style.zIndex) - 1);
                shade.style.transform = shadowTo.transform;
                shade.style.opacity = String(shadowTo.opacity);
                st.busy = true;
                /* 抽出時延後淡出；蓋回時提早恢復不透明。 */
                const frames = out
                    ? [from, { opacity: from.opacity, offset: 0.4 }, to]
                    : [from, { opacity: 1, offset: 0.3 }, to];
                /* 蓋回時使用較長時間與較緩的緩動。 */
                const timing: KeyframeAnimationOptions = out
                    ? { duration: DUR, easing: EASE, fill: 'both' }
                    : { duration: DUR + 120, easing: 'cubic-bezier(.22,.65,.2,1)', fill: 'both' };
                const animation = paper.animate(frames, timing);
                const shadowAnimation = shade.animate(out
                    ? [shadowFrom, { opacity: from.opacity, offset: 0.4 }, shadowTo]
                    : [shadowFrom, shadowTo], timing);
                animation.startTime = shadowAnimation.startTime = document.timeline.currentTime;
                motion = { animation, shadowAnimation, index: i };
                animation.onfinish = finish;
            }
            st.goTo = i => {
                i = Math.max(0, Math.min(i, pages().length - 1));
                finish();
                if (i === st.index) return;
                if (Math.abs(i - st.index) === 1) { settle(i, i < st.index ? 1 : -1); return; }
                st.index = i; st.update();
            };

            vp.addEventListener('pointerdown', e => {
                if (!e.isPrimary || e.button > 0) return;
                st.dragged = false;
                if ((e.target as Element).closest('input')) return;
                finish();
                rest();
                sy = e.clientY;
                sx = cx = e.clientX; t0 = performance.now(); dragging = true; pid = e.pointerId;
            }, { signal });
            vp.addEventListener('pointermove', e => {
                if (!dragging || e.pointerId !== pid) return;
                cx = e.clientX;
                if (!st.dragged) {
                    const dx = Math.abs(cx - sx), dy = Math.abs(e.clientY - sy);
                    if (dy > 6 && dy > dx) { dragging = false; return; }
                    if (dx <= 6) return;
                    st.dragged = true;
                    vp.setPointerCapture(pid);
                }
                paint(soft(cx - sx, w));
            }, { signal });
            const end = (e: PointerEvent) => {
                if (!dragging || e.pointerId !== pid) return;
                dragging = false;
                if (vp.hasPointerCapture(pid)) vp.releasePointerCapture(pid);
                if (!st.dragged) return;
                const d = soft(cx - sx, w);
                const fast = Math.abs(cx - sx) / Math.max(1, performance.now() - t0) > 0.5;
                let i = st.index;
                if (e.type !== 'pointercancel') {
                    if ((d < -w * 0.22 || (fast && d < -30)) && i < pages().length - 1) i++;
                    else if ((d > w * 0.22 || (fast && d > 30)) && i > 0) i--;
                }
                settle(i, d);
            };
            vp.addEventListener('pointerup', end, { signal });
            vp.addEventListener('pointercancel', end, { signal });
            /* Safari 的原生文字／圖片拖曳不能接管紙張手勢。 */
            vp.addEventListener('dragstart', e => { if (!(e.target as Element).closest('input')) e.preventDefault(); }, { signal });
            /* 攔下拖曳結束後的點擊；下次按下時重設 dragged。 */
            vp.addEventListener('click', e => { if (st.dragged && e.detail !== 0) { e.stopPropagation(); e.preventDefault(); } }, { capture: true, signal });
            st.destroy = () => { controller.abort(); motion?.animation.cancel(); motion?.shadowAnimation.cancel(); shade.remove(); };
            return st;
        }

