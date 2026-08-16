/* ============================================================
   Scroll reveal — cards and headings fade up as they enter view.
   Ported from the inline IntersectionObserver in index.html.
   Elements reveal once, then stop being observed.
   ============================================================ */

import { useEffect } from 'react';

const SELECTOR = 'article, h2, .lp-eyebrow, .heading-shine';

export function useScrollReveal(enabled = true) {
  useEffect(() => {
    if (!enabled) return;

    const els = Array.from(document.querySelectorAll<HTMLElement>(SELECTOR));
    if (!els.length) return;

    // No observer, or the viewer asked for less motion: show everything.
    const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    if (!('IntersectionObserver' in window) || reduced) {
      els.forEach((el) => el.classList.add('kv-reveal', 'kv-in'));
      return;
    }

    const io = new IntersectionObserver(
      (entries) => {
        entries.forEach((e) => {
          if (e.isIntersecting) {
            e.target.classList.add('kv-in');
            io.unobserve(e.target);
          }
        });
      },
      { threshold: 0.12, rootMargin: '0px 0px -40px 0px' },
    );

    els.forEach((el) => {
      el.classList.add('kv-reveal');
      io.observe(el);
    });

    return () => io.disconnect();
  }, [enabled]);
}
