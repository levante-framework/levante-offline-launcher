/// <reference types="vite/client" />
/// <reference types="vite-plugin-pwa/client" />

declare const __APP_BUILD__: string;

declare module '*.vue' {
  import type { DefineComponent } from 'vue';
  const component: DefineComponent<object, object, unknown>;
  export default component;
}

// core-tasks ships an untyped rollup bundle; declare the surface the shell uses.
declare module '@levante-framework/core-tasks' {
  export class TaskLauncher {
    constructor(
      firekit: unknown,
      gameParams: Record<string, unknown>,
      userParams: Record<string, unknown>,
      logger?: unknown,
    );
    run(): Promise<void>;
  }
  export function setAssetBaseUrl(url?: string | null): void;
}
