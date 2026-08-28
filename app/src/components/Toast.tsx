/* ============================================================
   Toast. The engine had a global kvToast() writing into a fixed
   div; here it is a provider so any component can call it without
   reaching for the DOM.
   ============================================================ */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';

interface ToastValue {
  toast: (message: string, tone?: ToastTone) => void;
}

type ToastTone = 'success' | 'error' | 'neutral';

const ToastContext = createContext<ToastValue | null>(null);

const DURATION = 3200;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [notice, setNotice] = useState<{ message: string; tone: ToastTone } | null>(null);
  const timer = useRef<number | null>(null);

  const toast = useCallback((message: string, tone: ToastTone = 'success') => {
    setNotice({ message, tone });
    if (timer.current !== null) clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setNotice(null), DURATION);
  }, []);

  useEffect(
    () => () => {
      if (timer.current !== null) clearTimeout(timer.current);
    },
    [],
  );

  const value = useMemo(() => ({ toast }), [toast]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div
        className={`pointer-events-none fixed bottom-6 left-1/2 z-[999] -translate-x-1/2 transition-all duration-300 ease-signature ${
          notice ? 'translate-y-0 opacity-100' : 'translate-y-5 opacity-0'
        }`}
        role={notice?.tone === 'error' ? 'alert' : 'status'}
        aria-live={notice?.tone === 'error' ? 'assertive' : 'polite'}
      >
        {notice ? (
          <div className="card flex-row items-center gap-2 px-5 py-3 shadow-lg">
            <span
              className={notice.tone === 'error'
                ? 'text-[var(--color-red-400)]'
                : notice.tone === 'neutral' ? 'text-text-muted' : 'text-brand'}
              aria-hidden="true"
            >
              {notice.tone === 'error' ? '!' : notice.tone === 'neutral' ? '•' : '✓'}
            </span>
            <span className="text-[13px]">{notice.message}</span>
          </div>
        ) : null}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): (message: string, tone?: ToastTone) => void {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used inside <ToastProvider>');
  return ctx.toast;
}
