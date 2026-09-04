/// <reference lib="webworker" />
import { cleanupOutdatedCaches, createHandlerBoundToURL, precacheAndRoute } from 'workbox-precaching';
import { NavigationRoute, registerRoute } from 'workbox-routing';

declare const self: ServiceWorkerGlobalScope;

// The app shell is precached at build time; packs are downloaded at provisioning time
// into the `levante-packs` cache and served from here under /pack/<packId>/...
export const PACK_CACHE = 'levante-packs';

cleanupOutdatedCaches();
precacheAndRoute(self.__WB_MANIFEST);
registerRoute(new NavigationRoute(createHandlerBoundToURL('/index.html')));

registerRoute(
  ({ url }) => url.origin === self.location.origin && url.pathname.startsWith('/pack/'),
  async ({ request }) => {
    const cache = await caches.open(PACK_CACHE);
    const hit = await cache.match(request.url, { ignoreSearch: true });
    if (hit) return hit;
    return new Response(`Not in any provisioned pack: ${new URL(request.url).pathname}`, {
      status: 404,
      headers: { 'content-type': 'text/plain' },
    });
  },
);

self.addEventListener('message', (event) => {
  if (event.data?.type === 'SKIP_WAITING') void self.skipWaiting();
});
