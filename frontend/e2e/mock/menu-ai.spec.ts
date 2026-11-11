import { test, expect } from "./fixtures";
import { MENU, menuState } from "./menu-f12-data";

// Fase 14 con la API mockeada: «Prepararlo con mi IA» copia el texto para la IA del usuario, y
// pegar su respuesta: primero un JSON roto (error claro) y después uno válido (se guarda con su
// origen). Ninguna IA de verdad: la «respuesta» la escribe la prueba. Datos inventados.

const CONTEXT = {
  context_version: 1,
  lang: "es",
  request: { start: "2026-11-02", end: "2026-11-04", days: 3, meals: ["breakfast", "lunch", "dinner", "snack"], tupper_meals: [], id: "ia-2026-11-02" },
  targets: { kcal: 2600, protein_g: 112, fat_min_g: 57.8, fibre_g: 25 },
  foods_columns: ["name", "per", "kcal", "protein_g", "carbs_g", "fat_g", "fibre_g"],
  foods: [["copos de avena", "100 g", 379, 13.2, 67.7, 6.5, 10.1]],
  instructions: "Eres el planificador de menús de FightLab. Responde SOLO con un JSON schema: 1.",
};

const AI_MENU = { ...MENU, menu_id: "ia-2026-11-02", source: "user_ai", origin: "user_ai", provider: "user_ai" };

test("copiar el contexto para la IA y pegar su respuesta, rota y buena", async ({ page, session }) => {
  void session;
  await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
  let saved = false;
  const pastes: unknown[] = [];
  await page.route("**/api/proxy/coach/menu*", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(menuState(saved ? AI_MENU : null)) }));
  await page.route("**/api/proxy/coach/products", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ products: [] }) }));
  await page.route("**/api/proxy/coach/tickets*", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ enabled: false, max_upload_mb: 2, tickets: [] }) }));
  await page.route("**/api/proxy/coach/menu/context*", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(CONTEXT) }));
  await page.route("**/api/proxy/coach/menu/paste", async (route) => {
    const body = JSON.parse(route.request().postData() ?? "{}");
    pastes.push(body);
    if (!String(body.menu).includes("\"dishes\"")) {
      return route.fulfill({
        status: 400, contentType: "application/json",
        body: JSON.stringify({ code: "paste_not_json", detail: "x", info: "line 1, column 24: Expecting value", params: { line: 1, column: 24 } }),
      });
    }
    saved = true;
    return route.fulfill({
      status: 201, contentType: "application/json",
      body: JSON.stringify({
        summary: { menu_id: "ia-2026-11-02", title: "Menú de prueba", start: "2026-11-02", end: "2026-11-04", days: 2, dishes: 1, batch_sessions: 1, shopping_items: 2, source: "user_ai" },
        replaced: false, kept_checks: 0, checked: true, days_ok: 2, days_failing: [], menu: AI_MENU,
      }),
    });
  });

  await page.goto("/nutrition/menu");
  await page.getByTestId("menu-ai-copy").click();
  // Con portapapeles, «Copiado»; si el navegador no deja, el texto sale en un cuadro.
  const copied = page.getByTestId("menu-ai-copied");
  const manual = page.getByTestId("menu-ai-prompt");
  await expect(copied.or(manual)).toBeVisible();
  const text = (await copied.isVisible())
    ? await page.evaluate(() => navigator.clipboard.readText())
    : await manual.inputValue();
  expect(text.startsWith(CONTEXT.instructions)).toBe(true);
  expect(text).toContain('"id":"ia-2026-11-02"');

  const area = page.getByTestId("menu-ai-paste");
  await area.fill('{"schema": 1, "days": [}');
  await page.getByTestId("menu-ai-save").click();
  const error = page.getByTestId("menu-ai-error");
  await expect(error).toHaveAttribute("data-code", "paste_not_json");
  await expect(error).toContainText("línea 1, columna 24");

  await area.fill('Aquí tienes:\n```json\n{"schema": 1, "days": [], "dishes": {}}\n```');
  await page.getByTestId("menu-ai-save").click();
  await expect(page.getByTestId("menu-ai-done")).toContainText("Guardado: Menú de prueba");
  await expect(page.getByTestId("menu-ai-done")).toContainText("Los 2 días cuadran");
  await expect(page.getByTestId("menu-origin")).toHaveAttribute("data-origin", "user_ai");
  await expect(page.getByTestId("menu-origin")).toHaveText("IA del usuario");
  expect(pastes).toHaveLength(2);

  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
});
