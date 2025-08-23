// Service worker for Lhyst
// Updated cache version to v35 to include latest changes to register and login pages. Bump cache version to force refresh whenever files change.
self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open('lhyst-cache-v35').then((cache) =>
      cache.addAll([
        './index.html',
        // cache signup page for offline free trial signups
        './signup.html',
        // also cache the legacy subscribe page in case old links are used
        './subscribe.html',
        // cache the new checkout page used for payment selection
        './checkout.html',
        // cache the custom registration page used for creating accounts
        './register.html',
        // cache the custom login page
        './login.html',
        './manifest.webmanifest',
        './assets/icon-192.png',
        './assets/icon-512.png',
        './assets/brand-logo.png',
        './assets/icon-192.png',
        './assets/icon-512.png',
        './assets/apple-touch-icon.png',
        './assets/favicon-32.png',
        './assets/favicon-16.png',
        './favicon.ico',
        './assets/icon-192.upperleft.v1.png',
        './assets/icon-512.upperleft.v1.png',
        './assets/apple-touch-icon.upperleft.v1.png',
        './assets/favicon-32.upperleft.v1.png',
        './assets/favicon-16.upperleft.v1.png',
        './favicon.upperleft.v1.ico',
        './assets/brand-logo.upperleft.v2.png',
      ])
    )
  );
});

// Serve files from cache first, falling back to network
self.addEventListener('fetch', (e) => {
  e.respondWith(caches.match(e.request).then((resp) => resp || fetch(e.request)));
});

// Handle notification clicks (used by equipment cleaning alerts)
self.addEventListener('notificationclick', (event) => {
  const equipId = event.notification?.data?.equipId;
  event.notification.close();
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clis) => {
      for (const c of clis) {
        if ('focus' in c) {
          c.focus();
          if (equipId) c.postMessage({ type: 'gotoCleaning', equipId });
          return;
        }
      }
      if (clients.openWindow) {
        const url = equipId ? './index.html#log-cleaning?equipId=' + equipId : './index.html#view-cleaning';
        return clients.openWindow(url);
      }
    })
  );
});