self.addEventListener('push', event => {
  const payload = event.data?.json?.() || {};
  event.waitUntil(self.registration.showNotification(payload.title || 'Procella OVK', {
    body: payload.body || 'Du har fått ett nytt meddelande.',
    icon: 'assets/procella-logo.jpg',
    badge: 'assets/procella-logo.jpg',
    tag: payload.conversationId || 'procella-message',
    data: { url: payload.url || './#messages' }
  }));
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  event.waitUntil(clients.matchAll({ type: 'window', includeUncontrolled: true }).then(windows => {
    const target = event.notification.data?.url || './#messages';
    const existing = windows.find(client => 'focus' in client);
    if (existing) {
      existing.navigate(target);
      return existing.focus();
    }
    return clients.openWindow(target);
  }));
});
