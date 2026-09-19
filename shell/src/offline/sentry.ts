import * as Sentry from '@sentry/vue';
import type { App } from 'vue';

const dsn = (import.meta.env.VITE_SENTRY_DSN as string | undefined)?.trim();

export const sentryEnabled = Boolean(dsn);

type Scalar = string | number | boolean;

function taskAttrs(properties?: Record<string, unknown>): Record<string, Scalar> {
  const game = properties?.gameParams as Record<string, unknown> | undefined;
  const ctx = properties?.context as Record<string, unknown> | undefined;
  const out: Record<string, Scalar> = {};
  if (typeof game?.taskName === 'string') out.taskName = game.taskName;
  if (typeof game?.language === 'string') out.language = game.language;
  if (ctx) {
    for (const [k, v] of Object.entries(ctx)) {
      if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') out[k] = v;
    }
  }
  return out;
}

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
    transport: (options) =>
      Sentry.makeBrowserOfflineTransport(Sentry.makeFetchTransport)({
        ...options,
        maxQueueSize: 200,
        flushAtStartup: true,
      }),
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

export function logInfo(message: string, attrs: Record<string, Scalar> = {}) {
  if (!sentryEnabled) return;
  Sentry.logger.info(message, attrs);
}

export function logError(message: string, err: unknown, attrs: Record<string, Scalar> = {}) {
  if (!sentryEnabled) return;
  Sentry.withScope((scope) => {
    for (const [k, v] of Object.entries(attrs)) scope.setExtra(k, v);
    if (typeof attrs.taskName === 'string') scope.setTag('taskName', attrs.taskName);
    Sentry.captureException(err);
  });
  Sentry.logger.error(message, {
    ...attrs,
    reason: err instanceof Error ? err.message : String(err),
  });
}

/** Injected into TaskLauncher so handled core-tasks errors share the launcher queue. */
export const coreTasksLogger = {
  capture(name: string, properties?: Record<string, unknown>) {
    if (!sentryEnabled) return;
    const attrs = taskAttrs(properties);
    Sentry.addBreadcrumb({ category: 'core-tasks', message: name, data: attrs });
    Sentry.logger.info(name, attrs);
  },
  error(error: unknown, context?: Record<string, unknown>) {
    logError('core-tasks', error, taskAttrs(context));
  },
};
