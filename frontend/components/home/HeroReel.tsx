'use client';

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

type Slide = {
  src: string;
  side: 'left' | 'right';
  alt: string;
  duplicate?: boolean;
};

const slides: Slide[] = [
  {
    src: '/hero/portfolio.png',
    side: 'left',
    alt: 'Hustix Macro - Client Portfolio and Asset Allocation',
  },
  {
    src: '/hero/stress.png',
    side: 'right',
    alt: 'Hustix Macro - Stagflation Stress Test Results',
  },
  {
    src: '/hero/montecarlo.png',
    side: 'left',
    alt: 'Hustix Macro - Monte Carlo Portfolio Stress Test Report',
  },
  {
    src: '/hero/client-report.png',
    side: 'right',
    alt: 'Hustix Macro - Client Stress Test Report',
  },
  {
    src: '/hero/advisor-report.png',
    side: 'left',
    alt: 'Hustix Macro - Advisor Stress Test Report',
  },
  {
    src: '/hero/portfolio.png',
    side: 'left',
    alt: '',
    duplicate: true,
  },
];

type PopupBox = {
  left: number;
  top: number;
  width: number;
  height: number;
};

function shownSlide(index: number): Slide {
  const slide = slides[index] ?? slides[0];
  if (!slide.duplicate) return slide;
  return slides.find((item) => item.src === slide.src && !item.duplicate) ?? slide;
}

function indexFromReel(reel: HTMLElement) {
  const count = slides.length;
  const transform = getComputedStyle(reel).transform;
  if (!transform || transform === 'none') return 0;
  const tx = new DOMMatrixReadOnly(transform).m41;
  const slideWidth = reel.getBoundingClientRect().width / count;
  if (!Number.isFinite(tx) || slideWidth <= 0) return 0;
  const raw = Math.round(-tx / slideWidth);
  return ((raw % count) + count) % count;
}

function popupBox(anchor: DOMRect): PopupBox {
  const margin = 16;
  const maxW = window.innerWidth - margin * 2;
  const maxH = window.innerHeight - margin * 2;
  let width = Math.min(maxW, 1040);
  let height = (width * 9) / 16;
  if (height > maxH) {
    height = maxH;
    width = Math.min(maxW, (height * 16) / 9);
    height = (width * 9) / 16;
  }
  width *= 0.75;
  height *= 0.75;
  let left = anchor.left + anchor.width / 2 - width / 2;
  let top = anchor.top + anchor.height / 2 - height / 2;
  left = Math.min(Math.max(margin, left), margin + maxW - width);
  top = Math.min(Math.max(margin, top), margin + maxH - height);
  return { left, top, width, height };
}

function hoverEnabled() {
  return window.matchMedia('(hover: hover) and (pointer: fine)').matches;
}

/** Slow slide through one account's portfolio, stress test, Monte Carlo, and reports. */
export default function HeroReel() {
  const frameRef = useRef<HTMLDivElement>(null);
  const reelRef = useRef<HTMLDivElement>(null);
  const popupRef = useRef<HTMLDivElement>(null);
  const closeTimer = useRef<number | null>(null);
  const [active, setActive] = useState<number | null>(null);
  const [box, setBox] = useState<PopupBox | null>(null);

  useEffect(() => {
    return () => {
      if (closeTimer.current !== null) window.clearTimeout(closeTimer.current);
    };
  }, []);

  function cancelClose() {
    if (closeTimer.current !== null) {
      window.clearTimeout(closeTimer.current);
      closeTimer.current = null;
    }
  }

  function pauseOnSlide() {
    const reel = reelRef.current;
    const frame = frameRef.current;
    if (!reel || !frame || !hoverEnabled()) return;
    cancelClose();
    reel.style.animationPlayState = 'paused';
    setActive(indexFromReel(reel));
    setBox(popupBox(frame.getBoundingClientRect()));
  }

  function pointInside(node: HTMLElement | null, x: number, y: number) {
    if (!node) return false;
    const rect = node.getBoundingClientRect();
    return x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom;
  }

  function scheduleClose(event?: { relatedTarget: EventTarget | null; clientX?: number; clientY?: number }) {
    const next = event?.relatedTarget;
    if (next instanceof Node) {
      if (frameRef.current?.contains(next) || popupRef.current?.contains(next)) return;
    }
    const x = event?.clientX;
    const y = event?.clientY;
    cancelClose();
    closeTimer.current = window.setTimeout(() => {
      if (typeof x === 'number' && typeof y === 'number') {
        if (pointInside(frameRef.current, x, y) || pointInside(popupRef.current, x, y)) return;
      }
      const reel = reelRef.current;
      if (reel) reel.style.animationPlayState = '';
      setActive(null);
      setBox(null);
    }, 80);
  }

  const slide = active === null ? null : shownSlide(active);

  return (
    <>
      <div
        ref={frameRef}
        className="group flex h-auto cursor-zoom-in flex-col overflow-hidden rounded-xl border border-slate-800 bg-slate-900 shadow-2xl shadow-black/40 sm:h-full"
        onMouseEnter={pauseOnSlide}
        onMouseLeave={scheduleClose}
      >
        <div className="flex shrink-0 items-center gap-1.5 border-b border-slate-800 px-4 py-3">
          <span className="h-2.5 w-2.5 rounded-full bg-slate-700" />
          <span className="h-2.5 w-2.5 rounded-full bg-slate-700" />
          <span className="h-2.5 w-2.5 rounded-full bg-slate-700" />
        </div>
        <div className="relative aspect-video overflow-hidden bg-slate-950 sm:aspect-auto sm:min-h-0 sm:flex-1">
          <div className="absolute inset-0">
            <div
              ref={reelRef}
              className="flex h-full w-[600%] animate-hero-reel group-hover:[animation-play-state:paused]"
              style={active !== null ? { animationPlayState: 'paused' } : undefined}
            >
              {slides.map((item, index) => (
                <div
                  key={`${item.src}-${index}`}
                  className="h-full w-[16.666%] overflow-hidden"
                  aria-hidden={item.duplicate || undefined}
                >
                  <img
                    src={item.src}
                    alt={item.alt}
                    className={`h-full w-full object-cover ${
                      item.side === 'left'
                        ? 'origin-left object-left scale-[2.05]'
                        : 'origin-right object-right scale-[2.05]'
                    }`}
                  />
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
      {slide && box && typeof document !== 'undefined'
        ? createPortal(
            <div
              ref={popupRef}
              className="fixed z-[60] overflow-hidden rounded-xl border border-slate-600 bg-slate-950 shadow-2xl shadow-black/70"
              style={{ left: box.left, top: box.top, width: box.width, height: box.height }}
              onMouseEnter={cancelClose}
              onMouseLeave={scheduleClose}
            >
              <img
                src={slide.src}
                alt={slide.alt}
                className={`h-full w-full object-cover ${
                  slide.side === 'left'
                    ? 'origin-left object-left scale-[2.05]'
                    : 'origin-right object-right scale-[2.05]'
                }`}
              />
            </div>,
            document.body,
          )
        : null}
    </>
  );
}
