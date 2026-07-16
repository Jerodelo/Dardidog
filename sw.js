self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil(clients.claim()));

self.addEventListener('push', event => {
  const data = event.data ? event.data.json() : {};
  event.waitUntil(
    self.registration.showNotification(data.title || 'Dardidog', {
      body:     data.body || '',
      icon:     data.icon || '/images/logo_192.png',
      badge:    '/images/logo_192.png',
      vibrate:  [200, 100, 200],
      tag:      'dardidog-rappel',
      renotify: true,
    })
  );
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  event.waitUntil(clients.openWindow('/gestion.html'));
});
