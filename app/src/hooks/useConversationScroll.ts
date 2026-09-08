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

  const jumpToLatest = useCallback(() => {
    pinned.current = true;
    setAway(false);
    setUnread(false);
    const element = viewport.current;
    if (element) element.scrollTop = element.scrollHeight;
  }, []);

  const onScroll = useCallback(() => {
    const element = viewport.current;
    if (!element) return;
    pinned.current = element.scrollHeight - element.scrollTop - element.clientHeight < 80;
    setAway(!pinned.current);
    if (pinned.current) setUnread(false);
  }, []);

  useEffect(() => {
    if (previousSession.current !== sessionId) {
      pinned.current = true;
      previousSession.current = sessionId;
      setAway(false);
      setUnread(false);
    }
    if (!active) return;
    const changed = previousMessages.current !== messages;
    previousMessages.current = messages;
    if (!pinned.current) {
      if (changed) setUnread(true);
      return;
    }
    const frame = requestAnimationFrame(() => {
      if (pinned.current) jumpToLatest();
    });
    return () => cancelAnimationFrame(frame);
  }, [messages, sessionId, active, jumpToLatest]);

  useEffect(() => {
    const element = viewport.current;
    if (!element || !active || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(() => {
      if (pinned.current) jumpToLatest();
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [active, jumpToLatest]);

  return { viewport, onScroll, jumpToLatest, away, unread };
}
