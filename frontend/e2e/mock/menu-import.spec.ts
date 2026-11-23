import { test, expect } from "./fixtures";
import { MENU, menuState } from "./menu-f12-data";

// Fase 12 con la API mockeada: importar un menú (JSON schema 1), confirmar que sustituye a otro que
// empieza el mismo día, y usar la lista de la compra por sección con su casilla. Datos inventados.

test("importar un menú, confirmar la sustitución y tachar en la lista", async ({ page, session }) => {
  void session;
  let imported = false;
  const uploads: string[] = [];
  const checks: unknown[] = [];
  await page.route("**/api/proxy/coach/menu*", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(menuState(imported ? MENU : null)) }));
  await page.route("**/api/proxy/coach/products", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ products: [] }) }));
  await page.route("**/api/proxy/coach/tickets*", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ enabled: false, max_upload_mb: 2, tickets: [] }) }));
  await page.route("**/api/proxy/coach/menu/import", async (route) => {
    const body = route.request().postData() ?? "";
    uploads.push(body.includes('name="replace_start"') ? "replace" : "first");
    if (uploads.length === 1) {
      return route.fulfill({ status: 409, contentType: "application/json", body: JSON.stringify({ code: "start_taken", detail: "x" }) });
    }
    imported = true;
    return route.fulfill({
      status: 201, contentType: "application/json",
      body: JSON.stringify({
        summary: { menu_id: "2026-11-02", title: "Menú de prueba", start: "2026-11-02", end: "2026-11-04", days: 2, dishes: 1, batch_sessions: 1, shopping_items: 2, source: "json" },
        replaced: false, kept_checks: 0, menu: MENU,
      }),
    });
  });
  await page.route("**/api/proxy/coach/menu/9/shopping", async (route) => {
    checks.push(JSON.parse(route.request().postData() ?? "{}"));
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ...MENU.shopping_list, checked: 1 }) });
  });

  await page.goto("/nutrition/menu");
  await page.getByTestId("menu-import-input").setInputFiles({
    name: "menu-2026-11-02.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify({ schema: 1, id: "2026-11-02", days: [] }), "utf-8"),
  });
  const confirm = page.getByTestId("menu-import-confirm");
  await expect(confirm).toContainText("Ya hay otro menú que empieza ese día");
  await confirm.getByRole("button", { name: "Sustituir" }).click();
  await expect(page.getByTestId("menu-import-done")).toContainText("Menú de prueba");
  expect(uploads).toEqual(["first", "replace"]);

  await expect(page.getByTestId("menu-header")).toHaveAttribute("data-source", "json");
  const list = page.getByTestId("shopping-list");
  await expect(list.getByTestId("shopping-section")).toHaveCount(2);
  const lentils = list.locator('[data-testid="shopping-item"][data-key="lentejas, cocidas"]');
  await expect(lentils).toContainText("bote de lentejas cocidas 400 g");
  await lentils.getByRole("checkbox").check();
  await expect.poll(() => checks).toEqual([{ item: "lentejas, cocidas", checked: true }]);
  await expect(page.getByTestId("meal-storage").first()).toHaveAttribute("data-where", "fridge");

  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
});
