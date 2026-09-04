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
  plugins: {
    // Route fetch/XHR through the native HTTP stack: the WebView origin is a custom scheme
    // (capacitor://localhost) that cross-origin servers such as the asset bucket reject
    // under CORS, and native requests are not subject to it.
    CapacitorHttp: { enabled: true },
  },
};

export default config;
