'use client';

import { useEffect, useRef } from 'react';

/** The checkbox stays off until this box has been scrolled to the end. */
export default function AgreementScroll({
  children,
  active,
  read,
  onRead,
  className,
}: {
  children: React.ReactNode;
  active: boolean;
  read: boolean;
  onRead: () => void;
  className?: string;
}) {
  const scroller = useRef<HTMLDivElement>(null);
  const onReadRef = useRef(onRead);
  onReadRef.current = onRead;

  useEffect(() => {
    const node = scroller.current;
    if (!node || !active) return;

    const check = () => {
      const content = node.firstElementChild;
      if (!content) return;
      const contentHeight = content.getBoundingClientRect().height;
      if (contentHeight < 40) return;
      const hidden = contentHeight - node.clientHeight;
      if (hidden <= 12) {
        onReadRef.current();
        return;
      }
      if (node.scrollTop + node.clientHeight - 44 >= contentHeight - 12) onReadRef.current();
    };

    check();
    node.addEventListener('scroll', check, { passive: true });
    const observer = new ResizeObserver(check);
    observer.observe(node);
    if (node.firstElementChild) observer.observe(node.firstElementChild);
    return () => {
      node.removeEventListener('scroll', check);
      observer.disconnect();
    };
  }, [active, children]);

  return (
    <div>
      <div className="relative">
        <div ref={scroller} className={className}>
          {children}
          {active && !read ? <div className="h-14" aria-hidden="true" /> : null}
        </div>
        {active && !read ? (
          <div className="pointer-events-none absolute inset-x-0 bottom-0 overflow-hidden rounded-b-lg">
            <div className="h-8 bg-gradient-to-t from-indigo-600 to-transparent" />
            <p className="flex items-center justify-center gap-2 bg-indigo-600 px-3 py-2.5 text-xs font-semibold text-white">
              Scroll down to enable the checkbox
              <span className="inline-block animate-bounce text-sm leading-none" aria-hidden="true">↓</span>
            </p>
          </div>
        ) : null}
      </div>
      {active && read ? (
        <p className="mt-2 text-xs font-medium text-emerald-300">End of the agreement. The checkbox is ready.</p>
      ) : null}
    </div>
  );
}
