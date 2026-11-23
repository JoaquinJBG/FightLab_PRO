import { expect, test, type Page } from "@playwright/test";
import es from "../messages/es.json";
import { coachYaml, madridDay, schema1 } from "./menu-f12-files";
import { PASSWORD, READY_USERS } from "./users";

// Fase 12 de punta a punta (Next + Django + motor): importar un menú JSON schema 1, reimportarlo
// con el mismo id conservando lo tachado, ver las tareas de la víspera en Hoy e importar un YAML
// del coach. Menús inventados.

async function login(page: Page, email: string) {
  await page.goto("/login");
  await page.locator('input[type="email"]').fill(email);
  await page.locator('input[type="password"]').fill(PASSWORD);
  await page.locator('button[type="submit"]').click();
  await page.waitForURL("**/today");
}

const file = (name: string, body: string) => ({ name, mimeType: "application/json", buffer: Buffer.from(body, "utf-8") });

test("importar un menú, tachar, reimportarlo sin perder lo tachado y ver la víspera en Hoy", async ({ page }) => {
  await login(page, READY_USERS.menuImport);
  await page.goto("/nutrition/menu");
  await page.getByTestId("menu-import-input").setInputFiles(file("menu.json", JSON.stringify(schema1("e2e-menu"))));
  await expect(page.getByTestId("menu-import-done")).toHaveAttribute("data-replaced", "false");
  await expect(page.getByTestId("menu-header")).toHaveAttribute("data-source", "json");
  await expect(page.getByTestId("menu-day")).toHaveCount(5);
  // Lunes y martes de la nevera; desde el tercer día, del congelador.
  const storage = page.getByTestId("meal-storage");
  await expect(storage.nth(0)).toHaveAttribute("data-where", "fridge");
  await expect(storage.nth(2)).toHaveAttribute("data-where", "freezer");

  const list = page.getByTestId("shopping-list");
  await expect(list.getByTestId("shopping-section")).toHaveCount(3);
  const lentils = list.locator('[data-testid="shopping-item"][data-key="lentejas, cocidas"]');
  await expect(lentils).toContainText("bote de lentejas cocidas 400 g");
  await lentils.getByRole("checkbox").check();
  await expect(list.getByTestId("shopping-progress")).toHaveText("1 de 3");

  // Mismo id, con otra cantidad: sustituye y conserva lo tachado.
  const changed = schema1("e2e-menu", { title: "Menú E2E corregido" });
  (changed.shopping as { items: { grams: number }[] }).items[0].grams = 1500;
  await page.getByTestId("menu-import-input").setInputFiles(file("menu.json", JSON.stringify(changed)));
  await expect(page.getByTestId("menu-import-done")).toHaveAttribute("data-replaced", "true");
  await expect(page.getByTestId("menu-header")).toContainText("Menú E2E corregido");
  await expect(page.locator('[data-testid="shopping-item"][data-key="lentejas, cocidas"]')).toHaveAttribute("data-checked", "true");

  // Hoy: esta noche, lo de la sesión de batch de hoy no; lo de mañana (remojar) sí.
  await page.goto("/today");
  const tonight = page.getByTestId("today-tonight");
  await expect(tonight).toContainText("Remojar las lentejas");

  // Un YAML del coach entra como otro menú.
  await page.goto("/nutrition/menu");
  await page.getByTestId("menu-import-input").setInputFiles({ name: `${madridDay(10)}.yaml`, mimeType: "application/x-yaml", buffer: Buffer.from(coachYaml(), "utf-8") });
  await expect(page.getByTestId("menu-import-done")).toBeVisible();
  await expect(page.getByTestId("menu-header")).toHaveAttribute("data-source", "yaml");
  await expect(page.getByTestId("shopping-list")).toHaveAttribute("data-source", "engine");
  await expect(page.getByTestId("menu-picker")).toBeVisible();

  // Un archivo que no es un menú se rechaza con su explicación.
  await page.getByTestId("menu-import-input").setInputFiles(file("roto.json", '{"schema": 2}'));
  await expect(page.getByTestId("menu-import").getByRole("alert")).toHaveText(es.menu.import.errors.import_invalid);
});
