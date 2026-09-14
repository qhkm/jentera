import { useCallback, useEffect, useRef, useState } from 'react';
import type { AskMessage } from '@/hooks/useAsk';

/** Follow the conversation only while the owner is already at the bottom. */
export function useConversationScroll(messages: AskMessage[], sessionId: string, active: boolean) {
  const viewport = useRef<HTMLDivElement>(null);
  const pinned = useRef(true);
  const previousSession = useRef(sessionId);
  const previousMessages = useRef(messages);
  const [away, setAway] = useState(false);
  const [unread, setUnread] = useState(false);
  const frame = useRef<number | null>(null);
  const lastWritten = useRef<number | null>(null);
  const opened = useRef(false);
  const stopFollowing = useCallback(() => {
    if (frame.current !== null) cancelAnimationFrame(frame.current);
    frame.current = null;
    lastWritten.current = null;
  }, []);

  const jumpToLatest = useCallback(() => {
    stopFollowing();
    pinned.current = true;
    setAway(false);
    setUnread(false);
    const element = viewport.current;
    if (element) element.scrollTop = element.scrollHeight;
  }, [stopFollowing]);

  const follow = useCallback(() => {
    if (!pinned.current || frame.current !== null) return;
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
      jumpToLatest();
      return;
    }
    let previous = performance.now();
    const started = previous;
    const tick = (now: number) => {
      const element = viewport.current;
      if (!element || !pinned.current) { stopFollowing(); return; }
      const target = Math.max(0, element.scrollHeight - element.clientHeight);
      const distance = target - element.scrollTop;
      const elapsed = Math.min(64, Math.max(1, now - previous));
      previous = now;
      if (Math.abs(distance) < 1 || now - started > 600) {
        element.scrollTop = element.scrollHeight;
        lastWritten.current = element.scrollTop;
        frame.current = null;
        return;
      }
      // Ease towards the latest layout, rather than restarting a native
      // smooth scroll for every token. No artificial delay to answer text.
      element.scrollTop += distance * (1 - Math.exp(-elapsed / 65));
      lastWritten.current = element.scrollTop;
      frame.current = requestAnimationFrame(tick);
    };
    frame.current = requestAnimationFrame(tick);
  }, [jumpToLatest, stopFollowing]);

  const onScroll = useCallback(() => {
    const element = viewport.current;
    if (!element) return;
    if (frame.current !== null && lastWritten.current !== null && Math.abs(element.scrollTop - lastWritten.current) < 2) return;
    if (frame.current !== null) stopFollowing();
    pinned.current = element.scrollHeight - element.scrollTop - element.clientHeight < 80;
    setAway(!pinned.current);
    if (pinned.current) setUnread(false);
  }, [stopFollowing]);

  useEffect(() => {
    if (previousSession.current !== sessionId) {
      stopFollowing();
      opened.current = false;
      pinned.current = true;
      previousSession.current = sessionId;
      setAway(false);
      setUnread(false);
    }
    if (!active) { stopFollowing(); return; }
    const changed = previousMessages.current !== messages;
    previousMessages.current = messages;
    if (!pinned.current) {
      if (changed) setUnread(true);
      return;
    }
    if (!opened.current) {
      opened.current = true;
      frame.current = requestAnimationFrame(() => jumpToLatest());
    } else follow();
  }, [messages, sessionId, active, jumpToLatest, follow, stopFollowing]);

  useEffect(() => stopFollowing, [stopFollowing]);

  useEffect(() => {
    const element = viewport.current;
    if (!element || !active) return;
    const pause = () => {
      stopFollowing();
      pinned.current = false;
      setAway(true);
    };
    const wheel = (event: WheelEvent) => { if (event.deltaY < 0) pause(); };
    const key = (event: KeyboardEvent) => {
      if (['ArrowUp', 'PageUp', 'Home'].includes(event.key)) pause();
    };
    element.addEventListener('wheel', wheel, { passive: true });
    element.addEventListener('touchmove', pause, { passive: true });
    element.addEventListener('keydown', key);
    return () => {
      element.removeEventListener('wheel', wheel);
      element.removeEventListener('touchmove', pause);
      element.removeEventListener('keydown', key);
    };
  }, [active, stopFollowing]);

  useEffect(() => {
    const element = viewport.current;
    if (!element || !active || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(() => {
      if (pinned.current) follow();
    });
    observer.observe(element);
    // Observe content too: text wrapping and image loads can grow without
    // changing the scroll viewport's own dimensions.
    for (const child of element.children) observer.observe(child);
    const mutations = new MutationObserver(() => {
      for (const child of element.children) observer.observe(child);
      if (pinned.current) follow();
    });
    mutations.observe(element, { childList: true });
    return () => { observer.disconnect(); mutations.disconnect(); };
  }, [active, follow]);

  return { viewport, onScroll, jumpToLatest, away, unread };
}
