/* Stands in for `virtual:pwa-register/react` under vitest, where no Vite
   plugin provides it: the app renders as if no service worker existed. */
import { useState } from 'react';

export function useRegisterSW() {
  const needRefresh = useState(false);
  const offlineReady = useState(false);
  return { needRefresh, offlineReady, updateServiceWorker: async (_reload?: boolean) => undefined };
}
