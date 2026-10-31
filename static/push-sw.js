// Uniquement pour les notifications : le site ne fonctionne pas hors ligne.
self.addEventListener('push', (event) => {
  const { title, body, url, tag } = event.data.json();
  event.waitUntil(
    self.registration.showNotification(title, {
      body,
      tag,
      icon: '/favicon.svg',
      data: { url },
    }),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const { url } = event.notification.data;
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windows) => {
      const open = windows.find((client) => 'focus' in client);
      if (!open) return self.clients.openWindow(url);
      return open.focus().then((client) => client.navigate(url));
    }),
  );
});
