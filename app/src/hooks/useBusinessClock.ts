import { useEffect, useState } from 'react';

/** Re-check the business date at midnight and after a background tab resumes.
 * This clock does not call the API or start any agent work. */
export function useBusinessClock(): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const tick = () => {
      if (document.visibilityState === 'visible') setNow(new Date());
    };
    const timer = window.setInterval(tick, 60_000);
    document.addEventListener('visibilitychange', tick);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', tick);
    };
  }, []);
  return now;
}
