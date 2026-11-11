// Service worker de FightLab Pro.
// Instalar la PWA, abrir en standalone, recibir los avisos (Web Push, fase 11) y, desde la prueba
// en móvil (F5), no quedarse en la página genérica de Chrome sin conexión:
// - las pantallas y los archivos de la app van primero a la red y se guarda una copia; sin red se
//   abre la copia (el armazón de la app, sin datos: los datos siguen viniendo de /api) y, si no
//   hay copia de esa pantalla, la página propia sin conexión (/offline.html, en es y en). Al
//   cerrar sesión, la app borra las copias de las pantallas (finishLogout en lib/hooks.ts);
// - /api nunca pasa por la caché: los datos y la sesión siempre van a la red.
// v2 (R4-3): la página sin conexión nueva (idioma de la app) sustituye a la guardada.
const VERSION = "v2";
const SHELL_CACHE = `flp-shell-${VERSION}`;
const PAGES_CACHE = `flp-pages-${VERSION}`;
const STATIC_CACHE = `flp-static-${VERSION}`;
// Imágenes de los ejercicios (F17): no cambian, así que van primero a la caché y se pueden ver
// en un gimnasio sin cobertura.
const MEDIA_CACHE = `flp-media-${VERSION}`;
const MEDIA_PREFIX = "/exercise-media/";
const CACHES = [SHELL_CACHE, PAGES_CACHE, STATIC_CACHE, MEDIA_CACHE];
const OFFLINE_URL = "/offline.html";
const SHELL_FILES = [OFFLINE_URL, "/icon.svg", "/icon-192.png"];
// Tope de archivos guardados por caché: cada build trae archivos nuevos con otro nombre.
const MAX_ENTRIES = { [PAGES_CACHE]: 40, [STATIC_CACHE]: 300, [MEDIA_CACHE]: 600 };

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(SHELL_CACHE)
      .then((cache) => cache.addAll(SHELL_FILES))
      .catch(() => {})
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith("flp-") && !CACHES.includes(k)).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

async function trim(cacheName) {
  const max = MAX_ENTRIES[cacheName];
  if (!max) return;
  const cache = await caches.open(cacheName);
  const keys = await cache.keys();
  for (const req of keys.slice(0, Math.max(0, keys.length - max))) await cache.delete(req);
}

// Solo respuestas buenas de la propia web (ni redirecciones al login ni errores).
function cacheable(response) {
  return !!response && response.ok && !response.redirected && response.type === "basic";
}

async function remember(cacheName, key, response) {
  try {
    const cache = await caches.open(cacheName);
    await cache.put(key, response);
    await trim(cacheName);
  } catch {
    // Sin espacio o modo incógnito: la app sigue igual, solo sin copia.
  }
}

// La copia de una pantalla se guarda sin la query (?redo=1, ?reason=…): es el mismo armazón.
function pageKey(url) {
  return url.origin + url.pathname;
}

async function navigate(event, url) {
  try {
    const response = await fetch(event.request);
    if (cacheable(response)) event.waitUntil(remember(PAGES_CACHE, pageKey(url), response.clone()));
    return response;
  } catch {
    const cached = await caches.match(pageKey(url), { cacheName: PAGES_CACHE, ignoreVary: true });
    if (cached) return cached;
    const offline = await caches.match(OFFLINE_URL, { cacheName: SHELL_CACHE, ignoreVary: true });
    return offline || new Response("Offline", { status: 503, headers: { "Content-Type": "text/plain; charset=utf-8" } });
  }
}

async function asset(event) {
  try {
    const response = await fetch(event.request);
    if (cacheable(response)) event.waitUntil(remember(STATIC_CACHE, event.request, response.clone()));
    return response;
  } catch (err) {
    const cached = await caches.match(event.request);
    if (cached) return cached;
    throw err;
  }
}

async function media(event) {
  const cached = await caches.match(event.request, { cacheName: MEDIA_CACHE });
  if (cached) return cached;
  const response = await fetch(event.request);
  if (cacheable(response)) event.waitUntil(remember(MEDIA_CACHE, event.request, response.clone()));
  return response;
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith("/api/")) return; // datos y sesión: siempre a la red
  if (url.pathname.startsWith(MEDIA_PREFIX)) {
    event.respondWith(media(event));
    return;
  }
  if (request.mode === "navigate") {
    event.respondWith(navigate(event, url));
    return;
  }
  if (url.pathname.startsWith("/_next/static/") || SHELL_FILES.includes(url.pathname) || /\.(?:png|svg|ico|webmanifest|woff2?)$/.test(url.pathname)) {
    event.respondWith(asset(event));
  }
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
