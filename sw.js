// Service worker for Lhyst
// Updated cache version to v40 to include new placeholder view, dynamic branding updates, and removal of cooldown logic.
self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open('lhyst-cache-v40').then((cache) =>
      cache.addAll([
        './index.html',
        // cache signup page for offline free trial signups
        './signup.html',
        // legacy subscribe page (deprecated but cached for compatibility)
        './subscribe.html',
        // cache the new checkout page used for payment selection
        './checkout.html',
        // cache the custom registration page used for creating accounts
        './register.html',
        // cache the custom login page
        './login.html',
        // cache the verification page
        './verify.html',
        // cache the placeholder for offline access
        './features-placeholder.png',
        // static assets
        './manifest.webmanifest',
        './assets/icon-192.png',
        './assets/icon-512.png',
        './assets/icon-192.upperleft.v1.png',
        './assets/icon-512.upperleft.v1.png',
        './assets/apple-touch-icon.upperleft.v1.png',
        './assets/favicon-32.upperleft.v1.png',
        './assets/favicon-16.upperleft.v1.png',
        './favicon.upperleft.v1.ico',
        './brand-logo.png'
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