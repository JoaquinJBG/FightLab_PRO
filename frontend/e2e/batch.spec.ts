import { expect, test, type Page } from "@playwright/test";
import { schema1 } from "./menu-f12-files";
import { PASSWORD, READY_USERS } from "./users";

// Fase 12 de punta a punta: el menaje del usuario manda en el cronograma de batch. El menú trae una
// sesión con olla exprés; sin olla exprés en su cocina, el cronograma se rehace con la olla normal y
// se marca el cambio. Después, la sesión a pantalla completa con el reloj y un temporizador.

async function login(page: Page, email: string) {
  await page.goto("/login");
  await page.locator('input[type="email"]').fill(email);
  await page.locator('input[type="password"]').fill(PASSWORD);
  await page.locator('button[type="submit"]').click();
  await page.waitForURL("**/today");
}

test("menaje y comensales, cronograma con mis aparatos y sesión de batch a pantalla completa", async ({ page }) => {
  await login(page, READY_USERS.batch);

  // Mi cocina: una olla, dos fuegos y horno; sin olla exprés. La pareja cena sin pescado salvo gambas.
  await page.goto("/profile");
  await page.getByTestId("kitchen-link").click();
  await page.waitForURL("**/profile/kitchen");
  await page.getByTestId("kitchen-pots").fill("1");
  await page.getByTestId("kitchen-burners_large").fill("2");
  await page.getByTestId("kitchen-oven").check();
  await page.getByTestId("kitchen-add-diner").click();
  await page.getByTestId("kitchen-diner-name").fill("Pareja");
  await page.getByTestId("kitchen-exclude").fill("pescado");
  await page.getByTestId("kitchen-allow").fill("gambas");
  await page.getByTestId("kitchen-save").click();
  await expect(page.getByTestId("kitchen-saved")).toBeVisible();
  await page.reload();
  await expect(page.getByTestId("kitchen-diner-name")).toHaveValue("Pareja");

  // Importar un menú con su sesión de batch.
  await page.goto("/nutrition/menu");
  await page.getByTestId("menu-import-input").setInputFiles({
    name: "menu.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(schema1("e2e-batch")), "utf-8"),
  });
  await expect(page.getByTestId("menu-import-done")).toBeVisible();
  const session = page.getByTestId("batch-session");
  await expect(session.getByTestId("batch-rebuilt")).toBeVisible();
  await expect(session).not.toContainText("Olla exprés");

  await session.getByTestId("batch-open").click();
  await page.waitForURL("**/nutrition/menu/batch?**");
  const screen = page.getByTestId("batch-screen");
  await expect(screen).toBeVisible();
  const lanes = page.getByTestId("batch-lane");
  await expect(page.locator('[data-testid="batch-lane"][data-where="pressure_cooker"]')).toHaveCount(0);
  await expect(page.locator('[data-testid="batch-lane"][data-where="pot"]')).toHaveCount(1);
  expect(await lanes.count()).toBeGreaterThanOrEqual(2);
  // El guiso pasa a la olla con su tiempo multiplicado (convención) y se marca el cambio.
  await expect(page.getByTestId("batch-step").filter({ hasText: "Guisar las lentejas" })).toContainText("en lugar de Olla exprés");

  await page.getByTestId("batch-start").click();
  await expect(screen).toHaveAttribute("data-running", "true");
  const timer = page.getByTestId("batch-step-timer").first();
  await timer.click();
  await expect(timer).toHaveText(/^\d\d:\d\d$/);
  await page.getByTestId("batch-pause").click();
  await expect(screen).toHaveAttribute("data-running", "false");
});
