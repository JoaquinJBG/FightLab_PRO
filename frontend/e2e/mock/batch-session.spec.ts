import { test, expect } from "./fixtures";
import { menuState } from "./menu-f12-data";

// Fase 12 con la API mockeada: del menú a la sesión de batch a pantalla completa, con el reloj, los
// carriles por aparato y el temporizador de un paso, sin scroll horizontal en los tres anchos.

test("sesión de batch a pantalla completa con temporizador por paso y por aparato", async ({ page, session }) => {
  void session;
  await page.route("**/api/proxy/coach/menu*", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(menuState()) }));
  await page.route("**/api/proxy/coach/tickets*", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ enabled: false, max_upload_mb: 2, tickets: [] }) }));
  await page.route("**/api/proxy/coach/products", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ products: [] }) }));

  await page.goto("/nutrition/menu");
  const card = page.getByTestId("batch-session");
  await expect(card).toContainText("50 min");
  await card.getByTestId("batch-open").click();
  await page.waitForURL("**/nutrition/menu/batch?menu=9&session=0");

  const screen = page.getByTestId("batch-screen");
  await expect(screen).toHaveAttribute("data-running", "false");
  // Ocupa toda la pantalla: tapa la barra de pestañas.
  const box = await screen.boundingBox();
  const viewport = page.viewportSize()!;
  expect(box!.width).toBeGreaterThanOrEqual(viewport.width - 1);
  expect(box!.height).toBeGreaterThanOrEqual(viewport.height - 1);
  await expect(page.getByTestId("batch-lane")).toHaveCount(3);
  await expect(page.locator('[data-testid="batch-lane"][data-where="pressure_cooker"]')).toContainText("Olla exprés");

  await page.getByTestId("batch-start").click();
  await expect(screen).toHaveAttribute("data-running", "true");
  await expect(page.getByTestId("batch-clock")).not.toHaveText("00:00", { timeout: 5_000 });

  const timer = page.getByTestId("batch-step-timer").nth(1);
  await expect(timer).toHaveText("40 min");
  await timer.click();
  await expect(timer).toHaveText(/^(39|40):\d\d$/);

  await page.getByTestId("batch-step").first().getByRole("checkbox").check();
  await expect(page.getByTestId("batch-step").first()).toHaveAttribute("data-status", "done");

  // El estado sobrevive a recargar la página.
  await page.reload();
  await expect(page.getByTestId("batch-screen")).toHaveAttribute("data-running", "true");
  await expect(page.getByTestId("batch-step").first()).toHaveAttribute("data-status", "done");

  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
  await page.getByTestId("batch-close").click();
  await page.waitForURL("**/nutrition/menu?id=9");
});
