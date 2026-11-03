import { expect, test, type Page } from "@playwright/test";
import es from "../messages/es.json";
import { PASSWORD, READY_USERS } from "./users";

// Menús y lista de la compra (fase 8) de punta a punta: BFF de Next + Django + motor del coach.
// Los platos los propone el proveedor simulado (nunca la API de Anthropic) y el motor comprueba
// cada día. El backend corre sin COACH_OFF_CONTACT: el proxy de Open Food Facts no está
// configurado y no se hace ninguna petición a OFF.

async function login(page: Page, email: string) {
  await page.goto("/login");
  await page.locator('input[type="email"]').fill(email);
  await page.locator('input[type="password"]').fill(PASSWORD);
  await page.locator('button[type="submit"]').click();
  await page.waitForURL("**/dashboard");
}

async function openMenu(page: Page) {
  await page.goto("/nutrition");
  await page.getByTestId("menu-card").click();
  await page.waitForURL("**/nutrition/menu");
  await expect(page.getByTestId("menu-form")).toBeVisible();
}

test("preparar un menú: cada día comprobado por el coach, sin la alergia y con la compra", async ({ page }) => {
  await login(page, READY_USERS.menu);
  await openMenu(page);

  // Alergia al pollo: el menú no lo lleva.
  await page.getByTestId("tastes-form").locator('input[name="allergies"]').fill("pollo");
  await page.getByRole("button", { name: es.menu.tastes.save }).click();
  await expect(page.getByText(es.menu.tastes.saved)).toBeVisible();

  await page.locator('select[name="days"]').selectOption("3");
  await page.getByRole("button", { name: es.menu.form.generate }).click();
  const days = page.getByTestId("menu-day");
  await expect(days).toHaveCount(3);
  for (let i = 0; i < 3; i++) {
    await expect(days.nth(i)).toHaveAttribute("data-ok", "true");
    const checks = days.nth(i).getByTestId("menu-check");
    await expect(checks).toHaveCount(4);
    for (let k = 0; k < 4; k++) {
      await expect(checks.nth(k)).toHaveAttribute("data-status", "ok");
      await expect(checks.nth(k).getByTestId("evidence-chip")).toBeVisible();
    }
  }
  await expect(page.getByTestId("menu-simulated")).toBeVisible();
  const items = await page.getByTestId("menu-item").allTextContents();
  expect(items.length).toBeGreaterThan(10);
  for (const text of items) expect(text.toLowerCase()).not.toMatch(/\bpollo\b/);
  // No se repite ningún plato.
  const dishes = await page.getByTestId("menu-dish").evaluateAll((els) => els.map((e) => e.getAttribute("data-dish")));
  expect(new Set(dishes).size).toBe(dishes.length);
  // Lista de la compra.
  await expect(page.getByTestId("shopping-list").getByTestId("shopping-item").first()).toBeVisible();

  // Valorar un plato: entra en el recetario.
  const first = page.getByTestId("menu-dish").first();
  await first.getByRole("button").first().click();
  await first.getByRole("button", { name: es.menu.rate.loved }).click();
  await expect(first.getByText(es.menu.rate.saved)).toBeVisible();
  const recipes = await page.request.get("/api/proxy/coach/recipes");
  expect((await recipes.json()).recipes[0].rating).toBe("loved");
});

test("con el proxy de Open Food Facts sin configurar, la app lo explica sin romperse", async ({ page }) => {
  await login(page, READY_USERS.menu);
  await openMenu(page);
  const card = page.getByTestId("products-card");
  await card.getByRole("textbox").fill("revuelto de verduras");
  await card.getByRole("button", { name: es.menu.products.search }).click();
  await expect(page.getByTestId("off-not-configured")).toHaveText(es.menu.products.notConfigured);
  const resp = await page.request.get("/api/proxy/coach/products/search?q=leche");
  expect(resp.status()).toBe(503);
  expect((await resp.json()).code).toBe("off_not_configured");
  const lookup = await page.request.get("/api/proxy/coach/products/lookup/8480000123456");
  expect((await lookup.json()).code).toBe("off_not_configured");
  // El resto de la pantalla sigue funcionando.
  await expect(page.getByTestId("menu-form")).toBeVisible();
});

test("con SCOFF positivo el menú va a mantenimiento y sin cifras de peso", async ({ page }) => {
  await login(page, READY_USERS.menuScoff);
  await openMenu(page);
  await page.locator('select[name="days"]').selectOption("1");
  await page.getByRole("button", { name: es.menu.form.generate }).click();
  await expect(page.getByTestId("menu-day")).toHaveCount(1);
  const menu = await (await page.request.get("/api/proxy/coach/menu")).json();
  const targets = await (await page.request.get("/api/proxy/coach/targets")).json();
  expect(menu.menu.targets.in_deficit).toBe(false);
  expect(menu.menu.targets.kcal).toBe(targets.maintenance_kcal);
  expect(JSON.stringify(menu)).not.toMatch(/"(weight|weight_kg|goal_weight_kg)"/);
  await expect(page.getByTestId("menu").getByText(/\bkg\b/)).toHaveCount(0);
});

test("sin sexo para la ecuación no hay objetivos ni menú", async ({ page }) => {
  await login(page, READY_USERS.noSex);
  await page.goto("/nutrition/menu");
  await expect(page.getByTestId("menu-missing")).toBeVisible();
  await expect(page.getByTestId("menu-form")).toHaveCount(0);
  const resp = await page.request.post("/api/proxy/coach/menu", { data: { days: 1 } });
  expect(resp.status()).toBe(409);
  expect((await resp.json()).code).toBe("profile_incomplete");
});
