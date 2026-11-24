import { test as base, expect, type Page } from "@playwright/test";
import { loginAsTestUser } from "./fixtures";
import { menuState } from "./menu-f12-data";

// Simplificar la beta (docs/ux/simplificar.md): el Menú sin menú cabe en
// 375 × 667 sin scroll vertical, y el menú ya no lleva la IA ni el texto de introducción.

const test = base;
test.use({ viewport: { width: 375, height: 667 } });

const json = (body: unknown) => ({ status: 200, contentType: "application/json", body: JSON.stringify(body) });

const noVerticalScroll = (page: Page) =>
  page.evaluate(() => ({ scroll: document.scrollingElement!.scrollHeight, inner: window.innerHeight }));

test("Historial de Entreno: calendario y estado vacío (el calendario mensual es alto: sin chequeo de scroll)", async ({ page }) => {
  await loginAsTestUser(page);
  await page.route("**/api/proxy/activities/calendar*", (route) => route.fulfill(json({})));
  await page.route("**/api/proxy/activities?*", (route) => route.fulfill(json([])));
  await page.goto("/training/history");
  await expect(page.getByTestId("training-calendar")).toBeVisible();
  await expect(page.getByTestId("history-empty")).toBeVisible();
});

test("Menú sin menú: chips en la cabecera, una frase y «Preparar menú», sin scroll ni IA", async ({ page }) => {
  await loginAsTestUser(page);
  await page.route("**/api/proxy/coach/menu*", (route) => route.fulfill(json(menuState(null))));
  await page.route("**/api/proxy/coach/products", (route) => route.fulfill(json({ products: [] })));
  await page.goto("/nutrition/menu");
  await expect(page.getByTestId("menu-prepare")).toBeVisible();
  await expect(page.getByTestId("menu-import-chip")).toBeVisible();
  await expect(page.getByTestId("menu-empty")).toBeVisible();
  await expect(page.getByTestId("menu-ai-copy")).toHaveCount(0);
  const { scroll, inner } = await noVerticalScroll(page);
  expect(scroll).toBeLessThanOrEqual(inner + 1);
  // El formulario vive en un panel inferior
  await page.getByTestId("menu-empty-prepare").click();
  await expect(page.getByRole("dialog").getByTestId("menu-form")).toBeVisible();
});
