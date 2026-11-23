import { expect, test, type Page } from "@playwright/test";
import es from "../messages/es.json";
import { PASSWORD, READY_USERS } from "./users";

// Biblioteca de ejercicios (F17) de punta a punta: BFF de Next + Django + catálogo fijado y medios
// del repo. Al ancho del móvil del usuario (353×681).
test.use({ viewport: { width: 353, height: 681 } });

async function login(page: Page, email: string) {
  await page.goto("/login");
  await page.locator('input[type="email"]').fill(email);
  await page.locator('input[type="password"]').fill(PASSWORD);
  await page.locator('button[type="submit"]').click();
  await page.waitForURL("**/today");
}

const hOverflow = (page: Page) =>
  page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

test("biblioteca: buscar, ficha con imagen y créditos, y CRUD de un ejercicio propio", async ({ page }) => {
  await login(page, READY_USERS.exercises);
  await page.goto("/training");
  await page.getByRole("link", { name: new RegExp(es.training.index.cards.exercises.title) }).click();
  await expect(page.getByRole("heading", { name: es.exercises.library.title })).toBeVisible();
  const list = page.getByTestId("exercise-library");
  await expect(list.locator("li").nth(99)).toBeAttached(); // más de 100 ejercicios
  expect(await hOverflow(page)).toBeLessThanOrEqual(0);

  // Búsqueda sin acentos y en inglés
  await page.getByLabel(es.exercises.picker.searchAria).fill("jalon");
  await expect(list.locator("li").first()).toContainText("Jalón al pecho");
  await page.getByLabel(es.exercises.picker.searchAria).fill("bench press");
  await expect(list.locator("li").first()).toContainText("Press banca");

  // Ficha: los dos fotogramas de everkinetic se cargan del propio origen, con su crédito
  await list.locator("li").first().click();
  await page.waitForURL("**/training/exercises/cat/barbell-bench-press");
  const img = page.locator("article img").first();
  await expect(img).toBeVisible();
  await expect
    .poll(() => img.evaluate((el: HTMLImageElement) => el.naturalWidth), { timeout: 15_000 })
    .toBeGreaterThan(0);
  await expect(page.getByText(es.exercises.detail.steps)).toBeVisible();
  await expect(page.getByRole("link", { name: /Everkinetic/ }).first()).toHaveAttribute("href", "https://github.com/everkinetic/data");
  expect(await hOverflow(page)).toBeLessThanOrEqual(0);

  // Un ejercicio sin imagen abierta: icono genérico y aviso
  await page.goto("/training/exercises/cat/shadow-boxing");
  await expect(page.getByText(es.exercises.detail.noImage)).toBeVisible();

  // Crear un ejercicio propio
  await page.goto("/training/exercises");
  await page.getByRole("button", { name: `+ ${es.exercises.picker.create}` }).click();
  await page.getByLabel(es.exercises.form.name).fill("Remo Meadows E2E");
  await page.getByLabel(es.exercises.form.primary).selectOption("upper_back");
  await page.getByRole("button", { name: es.exercises.muscles.biceps }).click();
  await page.getByLabel(es.exercises.form.equipment).selectOption("barbell");
  await page.getByLabel(es.exercises.form.notes).fill("Barra en la esquina");
  await page.getByRole("button", { name: es.exercises.form.createOnly, exact: true }).click();
  await page.waitForURL(/\/training\/exercises\/custom\/\d+$/);
  await expect(page.getByText(es.exercises.detail.custom)).toBeVisible();
  await expect(page.getByText("Barra en la esquina")).toBeVisible();

  // Editarlo
  await page.getByRole("button", { name: es.exercises.detail.edit }).click();
  await page.getByLabel(es.exercises.form.name).fill("Remo Meadows E2E editado");
  await page.getByRole("button", { name: es.exercises.form.save }).click();
  await expect(page.getByRole("heading", { name: "Remo Meadows E2E editado" })).toBeVisible();

  // Sale en la lista y en la búsqueda
  await page.goto("/training/exercises");
  await page.getByLabel(es.exercises.picker.searchAria).fill("meadows");
  await expect(list.locator("li")).toHaveCount(1);
  await list.locator("li").first().click();

  // Borrarlo
  await page.getByRole("button", { name: es.exercises.detail.delete }).click();
  await page.getByRole("button", { name: es.exercises.detail.deleteYes }).click();
  await page.waitForURL("**/training/exercises");
  await page.getByLabel(es.exercises.picker.searchAria).fill("meadows");
  await expect(page.getByText(es.exercises.picker.noResults)).toBeVisible();
});

test("créditos: Perfil → Créditos → ejercicios lista autor y licencia de las imágenes", async ({ page }) => {
  await login(page, READY_USERS.exercises);
  await page.goto("/profile/credits");
  await page.getByRole("link", { name: es.credits.exercises.link }).click();
  await page.waitForURL("**/profile/credits/exercises");
  const credits = page.getByTestId("exercise-credits");
  await expect(credits.locator("li").nth(50)).toBeAttached();
  await expect(credits).toContainText("CC BY-SA 4.0");
  await expect(credits).toContainText("Everkinetic");
  expect(await hOverflow(page)).toBeLessThanOrEqual(0);
});
