import * as Sentry from '@sentry/vue';
import type { App } from 'vue';

const dsn = (import.meta.env.VITE_SENTRY_DSN as string | undefined)?.trim();

export const sentryEnabled = Boolean(dsn);

export function initSentry(app: App) {
  if (!dsn) return;
  Sentry.init({
    app,
    dsn,
    environment: import.meta.env.MODE,
    release: __APP_BUILD__,
    sendDefaultPii: false,
    enableLogs: true,
    tracesSampleRate: 0.2,
    integrations: [Sentry.browserTracingIntegration()],
    beforeSend(event) {
      delete event.user?.ip_address;
      delete event.user?.email;
      if (event.contexts?.geo) delete event.contexts.geo;
      return event;
    },
  });
  Sentry.setTag('appBuild', __APP_BUILD__);
  Sentry.logger.info('launcher boot', { mode: import.meta.env.MODE, appBuild: __APP_BUILD__ });
}

export function setProctor(uid: string) {
  if (!sentryEnabled) return;
  Sentry.setUser({ id: uid });
}

export function clearProctor() {
  if (!sentryEnabled) return;
  Sentry.setUser(null);
}

export function logInfo(message: string, attrs: Record<string, string | number | boolean> = {}) {
  if (!sentryEnabled) return;
  Sentry.logger.info(message, attrs);
}

export function logError(message: string, err: unknown, attrs: Record<string, string | number | boolean> = {}) {
  if (!sentryEnabled) return;
  Sentry.captureException(err);
  Sentry.logger.error(message, {
    ...attrs,
    reason: err instanceof Error ? err.message : String(err),
  });
}
