import { test, expect } from "./fixtures";

// Arreglos de la prueba en el móvil real del 9 de noviembre (sesión B): el mismo ancho que el
// Honor plegado (353×681 CSS).
test.use({ viewport: { width: 353, height: 681 } });

test("F4: el chat del coach ocupa la pantalla y con el teclado se ve la última respuesta", async ({ page, session }) => {
  void session;
  await page.goto("/coach");
  const chat = page.getByTestId("coach-chat");
  const log = page.getByTestId("coach-chat-log");
  await expect(chat).toBeVisible();
  // Ya no es una caja de 137 px: en la página la conversación tiene sitio para varias burbujas
  expect((await log.boundingBox())!.height).toBeGreaterThan(200);

  await page.getByPlaceholder("Pregunta a tu coach…").tap();
  await expect(chat).toHaveAttribute("data-expanded", "true");
  const full = (await chat.boundingBox())!;
  expect(full.y).toBeLessThanOrEqual(1);
  expect(full.height).toBeGreaterThan(660);
  // Con el foco en el campo la barra de navegación no sube encima del teclado
  await expect(page.getByTestId("tab-bar")).toBeHidden();

  // Teclado abierto: la zona visible baja a 330 px (como en el móvil)
  await page.setViewportSize({ width: 353, height: 330 });
  await page.getByPlaceholder("Pregunta a tu coach…").fill("¿Cómo voy?");
  await page.getByRole("button", { name: "Enviar" }).click();
  const reply = log.locator("> div").last();
  await expect(reply).not.toContainText("El coach está escribiendo");
  await expect(reply).toBeInViewport({ ratio: 0.3 });
  const small = (await chat.boundingBox())!;
  expect(small.y + small.height).toBeLessThanOrEqual(331);
  await expect(page.getByPlaceholder("Pregunta a tu coach…")).toBeInViewport();

  // Se cierra y vuelve la página con su barra
  await page.setViewportSize({ width: 353, height: 681 });
  await page.getByRole("button", { name: "Cerrar chat" }).click();
  await expect(chat).toHaveAttribute("data-expanded", "false");
  await expect(page.getByTestId("tab-bar")).toBeVisible();
});

test("F15: cerrar sesión lleva a /login sin «Sesión caducada» y sin peticiones que den 401", async ({ page, session }) => {
  void session;
  let loggedOut = false;
  const after401: string[] = [];
  await page.route("**/api/auth/logout", (route) => {
    loggedOut = true;
    return route.fulfill({ status: 200, contentType: "application/json", body: "{}" });
  });
  // Tras el cierre, el proxy da 401 como el BFF sin cookies; se apunta cada petición que llegue.
  await page.route("**/api/proxy/**", (route) => {
    if (!loggedOut) return route.fallback();
    after401.push(new URL(route.request().url()).pathname);
    return route.fulfill({ status: 401, contentType: "application/json", body: "{}" });
  });
  await page.goto("/profile");
  await page.getByRole("button", { name: "Cerrar sesión" }).click();
  await expect(page).toHaveURL(/\/login$/);
  await expect(page.getByText("Sesión caducada")).toBeHidden();
  await page.waitForTimeout(1_000);
  expect(after401).toEqual([]);
});

test("F5: sin conexión, las pantallas ya abiertas cargan su armazón y las demás, la página propia", async ({ page, context, session }) => {
  void session;
  // Solo contra el build (`pnpm start`, como en la CI): con `next dev` los archivos de la app
  // cambian en cada carga y la copia guardada no llega a arrancar.
  test.skip(!process.env.CI, "necesita el build de producción (CI=1)");
  await page.goto("/today");
  // El service worker toma el control (la primera visita lo instala; se recarga para que la sirva él)
  await page.evaluate(async () => { await navigator.serviceWorker.ready; });
  await page.reload();
  await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true);
  await expect(page.getByTestId("tab-bar")).toBeVisible();

  await context.setOffline(true);
  // Hoy ya se abrió con red: sin ella abre la app (armazón y barra) con el aviso de sin conexión
  await page.goto("/today");
  await expect(page.getByTestId("tab-bar")).toBeVisible();
  await expect(page.getByTestId("offline-notice")).toContainText("Sin conexión");
  // Una pantalla que no estaba guardada: página propia, no la de Chrome
  await page.goto("/training/plan");
  await expect(page.getByRole("heading", { name: "Sin conexión" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Reintentar" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Ir a Hoy" })).toHaveAttribute("href", "/today");
  // (La vuelta de la red no se prueba aquí: Playwright no siempre devuelve la red al service
  // worker al quitar el modo sin conexión. Lo cubre la prueba del service worker en vitest.)
});
