import { test, expect, loginAsTestUser } from "./fixtures";
import type { Page } from "@playwright/test";

// Biblioteca de ejercicios (F17) con /api/proxy mockeado: la lista, la ficha con los fotogramas
// del repo (frontend/public/exercise-media) y una sin imagen.

const img = (n: number) => ({
  url: `/exercise-media/barbell-bench-press-${n}.svg`, source: "everkinetic", author: "Everkinetic",
  license: "CC BY-SA 4.0", license_url: "https://creativecommons.org/licenses/by-sa/4.0/",
  source_url: "https://github.com/everkinetic/data", modified: "SVG minificado",
});
const base = {
  aliases: [], secondary_muscles: [], category: "strength", images: [], instructions: [], instructions_lang: null,
  text_credit: null, notes: "", source: "fightlab", attribution: null, custom: false,
};
const BENCH = {
  ...base, key: "cat:barbell-bench-press", name: "Press banca", aliases: ["Bench press (barbell)"],
  primary_muscles: ["chest"], secondary_muscles: ["triceps"], equipment: ["barbell", "bench"],
  images: [img(1), img(2)], instructions: ["Túmbate en el banco.", "Baja la barra al pecho.", "Empuja."],
  instructions_lang: "es", source: "everkinetic",
};
const SHADOW = {
  ...base, key: "cat:shadow-boxing", name: "Sombra", primary_muscles: ["full_body"], equipment: ["bodyweight"],
  category: "combat", instructions: ["Guardia alta."], instructions_lang: "es", text_credit: { source: "fightlab" },
};
const MANY = Array.from({ length: 40 }, (_, i) => ({
  ...base, key: `cat:filler-${i}`, name: `Ejercicio ${String(i).padStart(2, "0")} con un nombre bastante largo para el ancho`,
  primary_muscles: ["quads"], equipment: ["machine"],
}));

async function mockExercises(page: Page) {
  await page.route("**/api/proxy/gym/exercises**", async (route) => {
    const path = new URL(route.request().url()).pathname.replace(/^\/api\/proxy\//, "");
    const body =
      path === "gym/exercises" ? [BENCH, SHADOW, ...MANY]
        : path === "gym/exercises/cat/barbell-bench-press" ? BENCH
          : path === "gym/exercises/cat/shadow-boxing" ? SHADOW
            : null;
    await route.fulfill({
      status: body ? 200 : 404,
      contentType: "application/json",
      body: JSON.stringify(body ?? { detail: "Not found." }),
    });
  });
}

const hOverflow = (page: Page) =>
  page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

test("la biblioteca cabe en el móvil y busca sin acentos", async ({ page }) => {
  await loginAsTestUser(page);
  await mockExercises(page);
  await page.goto("/training/exercises");
  await expect(page.getByTestId("exercise-library").locator("li")).toHaveCount(42);
  expect(await hOverflow(page)).toBeLessThanOrEqual(0);
  await page.getByLabel("Buscar en la biblioteca de ejercicios").fill("BENCH");
  await expect(page.getByTestId("exercise-library").locator("li")).toHaveCount(1);
  await expect(page.getByTestId("exercise-thumb-image").first()).toBeVisible();
});

test("ficha: fotogramas del repo, pasos y créditos; sin imagen, icono y aviso", async ({ page }) => {
  await loginAsTestUser(page);
  await mockExercises(page);
  await page.goto("/training/exercises/cat/barbell-bench-press");
  const frame = page.locator("article img").first();
  await expect(frame).toBeVisible();
  await expect
    .poll(() => frame.evaluate((el: HTMLImageElement) => el.naturalWidth), { timeout: 15_000 })
    .toBeGreaterThan(0);
  await expect(page.getByText("Cómo se hace")).toBeVisible();
  await expect(page.getByRole("link", { name: /Everkinetic/ }).first()).toBeVisible();
  expect(await hOverflow(page)).toBeLessThanOrEqual(0);

  await page.goto("/training/exercises/cat/shadow-boxing");
  await expect(page.getByText("Sin imagen con licencia abierta todavía.")).toBeVisible();
  await expect(page.getByText("Texto: FightLab · CC BY 4.0")).toBeVisible();
});

test("una ficha que no existe lo dice", async ({ page }) => {
  await loginAsTestUser(page);
  await mockExercises(page);
  await page.goto("/training/exercises/cat/nope");
  await expect(page.getByText("Este ejercicio no existe o ya no está.")).toBeVisible();
});
