self.addEventListener("push", function (event) {
  let payload = {};
  try {
    payload = event.data ? event.data.json() : {};
  } catch (e) {
    payload = {
      title: "Notifikasi",
      body: event.data ? event.data.text() : "Ada notifikasi baru",
    };
  }

  const title = payload.title || "KOPRAL POS";
  const options = Object.assign(
    {
      body: payload.body || "",
      icon: "/assets/logo.png",
      badge: "/assets/logo.png",
      data: payload.data || {},
    },
    payload.options || {},
  );

  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("notificationclick", function (event) {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || "/";
  event.waitUntil(
    clients
      .matchAll({ type: "window", includeUncontrolled: true })
      .then(function (clientList) {
        for (const client of clientList) {
          if (client.url === url && "focus" in client) return client.focus();
        }
        if (clients.openWindow) return clients.openWindow(url);
      }),
  );
});
