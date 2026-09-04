import type { CapacitorConfig } from '@capacitor/cli';

// Emulator builds talk plain HTTP to the host's Firebase emulator and bundle server
// (10.0.2.2 from an AVD); production never sets this.
const cleartext = process.env.CAP_CLEARTEXT === '1';

const config: CapacitorConfig = {
  appId: 'org.levante.offlinelauncher',
  appName: 'LEVANTE Offline Launcher',
  webDir: 'dist',
  server: {
    // https scheme on Android so the web app is a secure context (service worker, WebCrypto).
    androidScheme: 'https',
    ...(cleartext ? { cleartext: true } : {}),
  },
  android: {
    ...(cleartext ? { allowMixedContent: true } : {}),
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
