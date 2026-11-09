// Makes the app installable. It caches nothing on purpose: rides, prices and safety features must always be live.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));
self.addEventListener('fetch', () => {});
