/* One import site for the plugin's virtual module, so tests can mock this
   path and the vitest config can alias it to a stub. */
export { useRegisterSW } from 'virtual:pwa-register/react';
