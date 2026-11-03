// Service worker mínimo de FightLab Pro.
// Modo ONLINE: no cachea datos; permite instalar la PWA, abrir en standalone y recibir los avisos
// (Web Push, fase 11).
self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("fetch", () => {
  // Passthrough a la red. (Sin estrategia offline por ahora.)
});

// Solo rutas de la propia app: el aviso nunca abre otra web.
function safePath(url) {
  return typeof url === "string" && url.startsWith("/") && !url.startsWith("//") ? url : "/today";
}

// El backend manda {title, body, url, tag} (backend/notifications/reminders.py), cifrado.
self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { body: event.data ? event.data.text() : "" };
  }
  const title = data.title || "FightLab";
  event.waitUntil(
    self.registration.showNotification(title, {
      body: data.body || "",
      tag: data.tag || "fightlab",
      icon: "/icon-192.png",
      badge: "/icon-192.png",
      data: { url: safePath(data.url) },
    }),
  );
});

// Al tocar el aviso: si la app ya está abierta, se trae al frente en esa pantalla; si no, se abre.
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const path = safePath(event.notification.data && event.notification.data.url);
  const target = new URL(path, self.location.origin).href;
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((windows) => {
      for (const client of windows) {
        if (new URL(client.url).origin === self.location.origin && "focus" in client) {
          return client.focus().then((c) => (c && "navigate" in c ? c.navigate(target) : c));
        }
      }
      return self.clients.openWindow(target);
    }),
  );
});
