import type { Page } from "@playwright/test";
import { test, expect } from "./fixtures";
import { fakeGym } from "./routines-fake";

// F17 R con la API mockeada: Entreno → Rutinas, cargar un programa, editar una rutina (serie de
// calentamiento, superserie, ejercicio nuevo con el selector) y empezar el entreno, sin scroll
// horizontal en los tres anchos de móvil. `fakeGym` responde a /gym/* en memoria.

async function noHorizontalScroll(page: Page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
}

test("rutinas: cargar un programa, editarla y empezar el entreno", async ({ page, session }) => {
  void session;
  const state = await fakeGym(page);

  await page.goto("/training");
  await page.getByRole("link", { name: /Rutinas/ }).first().click();
  await page.waitForURL("**/training/routines");
  await expect(page.getByTestId("routines-empty")).toBeVisible();
  await noHorizontalScroll(page);

  await page.getByTestId("programs-link").click();
  await page.waitForURL("**/training/routines/programs");
  const card = page.getByTestId("program-card");
  await expect(card.getByTestId("evidence-chip").first()).toHaveAttribute("data-variant", "convention");
  await noHorizontalScroll(page);
  await card.getByTestId("program-load").click();
  await page.waitForURL("**/training/routines");

  const folder = page.locator('[data-testid="routine-folder"]').first();
  await expect(folder).toContainText("Cuerpo completo, 3 días");
  const routine = folder.getByTestId("routine-card").first();
  await expect(routine).toContainText("Sentadilla, Press banca");
  await expect(routine.getByTestId("routine-start")).toHaveAttribute("href", /\/training\/gym\/session\?routine=\d+$/);
  await noHorizontalScroll(page);

  // Editar: superserie, una serie más y un ejercicio del selector.
  await routine.getByTestId("routine-edit").click();
  await page.waitForURL(/\/training\/routines\/\d+$/);
  const blocks = page.getByTestId("routine-exercise");
  await expect(blocks).toHaveCount(2);
  await blocks.first().getByTestId("superset-link").click();
  await expect(page.getByTestId("superset-label")).toHaveCount(2);
  await blocks.nth(1).getByTestId("set-add").click();
  await expect(blocks.nth(1).getByTestId("set-row")).toHaveCount(3);
  await page.getByTestId("exercise-add").click();
  await page.getByText("Face pull").first().click();
  await page.getByRole("button", { name: "Añadir (1)" }).click();
  await expect(blocks).toHaveCount(3);
  await noHorizontalScroll(page);

  await page.getByTestId("routine-save").click();
  await expect(page.getByTestId("routine-start")).toBeVisible();
  const saved = state.routines[0];
  expect(saved.exercises.map((e) => e.superset)).toEqual([0, 0, null]);
  expect(saved.exercises[1].sets).toHaveLength(3);
  expect(saved.exercises[2].exercise_key).toBe("cat:face-pull");
  await expect(page.getByTestId("routine-start")).toHaveAttribute("href", `/training/gym/session?routine=${saved.id}`);
});
