// Service worker mínimo de FightLab Pro.
// Modo ONLINE: no cachea datos; solo permite instalar la PWA y abrir en standalone.
self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("fetch", () => {
  // Passthrough a la red. (Sin estrategia offline por ahora.)
});
