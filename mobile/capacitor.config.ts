import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'ai.jentera.app',
  appName: 'Jentera',
  webDir: '../app/dist',
  appendUserAgent: ' Jentera/1.0.0',
  server: {
    /* This names the bundled WebView origin; it does not load a remote site.
       Android uses https://app.jentera.ai and iOS keeps Capacitor's
       capacitor://app.jentera.ai origin, as required by the auth design. */
    hostname: 'app.jentera.ai',
    androidScheme: 'https',
  },
};

export default config;
