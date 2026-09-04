import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'org.levante.offlinelauncher',
  appName: 'LEVANTE Offline Launcher',
  webDir: 'dist',
  server: {
    // https scheme on Android so the web app is a secure context (service worker, WebCrypto).
    androidScheme: 'https',
  },
  ios: {
    // WKWebView only allows service workers for app-bound domains; the launcher's shell and
    // pack serving depend on one.
    limitsNavigationsToAppBoundDomains: true,
  },
};

export default config;
