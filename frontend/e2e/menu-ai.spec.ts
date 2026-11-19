import { expect, test, type Page } from "@playwright/test";
import es from "../messages/es.json";
import { madridDay, schema1 } from "./menu-f12-files";
import { PASSWORD, READY_USERS } from "./users";

// Fase 14 de punta a punta (Next + Django + motor), sin ninguna IA: la «respuesta de la IA» la
// escribe la prueba. Perfil → Mi IA crea un token que solo vale para /api/ext/menu (la puerta de
// la skill); en Menú se copia el contexto, se pega un JSON roto (error claro) y uno bueno (se
// guarda con origen «IA del usuario»); y al revocar el token deja de valer. Menús inventados.

async function login(page: Page, email: string) {
  await page.goto("/login");
  await page.locator('input[type="email"]').fill(email);
  await page.locator('input[type="password"]').fill(PASSWORD);
  await page.locator('button[type="submit"]').click();
  await page.waitForURL("**/today");
}

/** Lo que devolvería la IA: el JSON de la app sin `totals` ni lista, con el id del contexto. */
function aiMenu(id: string) {
  const menu = schema1(id) as Record<string, unknown> & { days: Record<string, unknown>[] };
  delete menu.shopping;
  delete menu.batch_sessions;
  for (const day of menu.days) delete day.totals;
  return menu;
}

test("token de la skill, copiar el contexto y pegar un JSON roto y uno bueno", async ({ page }) => {
  await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
  await login(page, READY_USERS.menuAi);

  // B: el token se ve una vez y abre solo /api/ext/menu.
  await page.goto("/profile/my-ai");
  await expect(page.getByTestId("my-ai-url")).toHaveText(/\/api\/ext$/);
  await page.getByTestId("my-ai-name").fill("PC de casa");
  await page.getByTestId("my-ai-create").click();
  const token = (await page.getByTestId("my-ai-token-value").textContent())!.trim();
  expect(token).toMatch(/^flm_/);
  await expect(page.getByTestId("my-ai-token")).toHaveCount(1);
  await expect(page.getByTestId("my-ai-token")).not.toContainText(token);

  const auth = { Authorization: `Bearer ${token}` };
  const ctx = await page.request.get(`/api/ext/menu/context?days=5&start=${madridDay(1)}`, { headers: auth });
  expect(ctx.status()).toBe(200);
  const context = await ctx.json();
  expect(context.request.id).toBe(`ia-${madridDay(1)}`);
  expect(context.instructions).toContain("schema: 1");
  expect(context.foods.map((f: unknown[]) => f[0])).toContain("copos de avena");
  // Sin token, o con la cookie de la sesión, la puerta de la skill no abre.
  expect((await page.request.get("/api/ext/menu/context")).status()).toBe(401);
  const dry = await page.request.post("/api/ext/menu/import", { headers: auth, data: { menu: aiMenu(context.request.id), dry_run: true } });
  expect(dry.status()).toBe(200);
  const checked = await dry.json();
  expect(checked.dry_run).toBe(true);
  expect(checked.days).toHaveLength(5);

  // C: copiar el texto para la IA.
  await page.goto("/nutrition/menu");
  await page.getByTestId("menu-ai-copy").click();
  const copied = page.getByTestId("menu-ai-copied");
  const manual = page.getByTestId("menu-ai-prompt");
  await expect(copied.or(manual)).toBeVisible();
  const text = (await copied.isVisible()) ? await page.evaluate(() => navigator.clipboard.readText()) : await manual.inputValue();
  expect(text).toContain("Eres el planificador de menús de FightLab");
  expect(text).toContain(es.menu.ai.dataTitle);

  // Pegar un JSON roto: error con línea y columna, y nada guardado.
  const area = page.getByTestId("menu-ai-paste");
  await area.fill('{"schema": 1, "days": [}');
  await page.getByTestId("menu-ai-save").click();
  const error = page.getByTestId("menu-ai-error");
  await expect(error).toHaveAttribute("data-code", "paste_not_json");
  await expect(error).toContainText("línea 1, columna 24");

  // Un JSON que no es un menú: dice dónde falla.
  const wrong = aiMenu("roto");
  (wrong.days[0].meals as Record<string, unknown>[])[0].dish_id = "NOPE";
  await area.fill(JSON.stringify(wrong));
  await page.getByTestId("menu-ai-save").click();
  await expect(error).toHaveAttribute("data-code", "import_invalid");
  await expect(error).toContainText("NOPE");

  // Pegar la respuesta buena, con las vallas de código que añade la IA.
  await area.fill("Aquí tienes tu menú:\n```json\n" + JSON.stringify(aiMenu(context.request.id), null, 2) + "\n```");
  await page.getByTestId("menu-ai-save").click();
  const done = page.getByTestId("menu-ai-done");
  await expect(done).toHaveAttribute("data-replaced", "false");
  await expect(done).toContainText("Menú E2E");
  await expect(page.getByTestId("menu-header")).toHaveAttribute("data-source", "user_ai");
  await expect(page.getByTestId("menu-origin")).toHaveText(es.menu.header.origin.user_ai);
  await expect(page.getByTestId("menu-day")).toHaveCount(5);

  // La skill sube el mismo menú: lo sustituye en la misma fila.
  const up = await page.request.post("/api/ext/menu/import", { headers: auth, data: { menu: aiMenu(context.request.id) } });
  expect(up.status()).toBe(200);
  expect((await up.json()).replaced).toBe(true);

  // Revocar: deja de valer al momento.
  await page.goto("/profile/my-ai");
  await page.getByTestId("my-ai-revoke").click();
  await page.getByTestId("my-ai-revoke-confirm").click();
  await expect(page.getByText(es.myAi.tokens.none)).toBeVisible();
  expect((await page.request.get("/api/ext/menu/context", { headers: auth })).status()).toBe(401);
});
