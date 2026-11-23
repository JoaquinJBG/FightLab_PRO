import { test as base, expect, type Page } from "@playwright/test";
import { loginAsTestUser } from "./fixtures";

// Estructura de la app (docs/ux/estructura-app.md, regla 1): las portadas de Entreno y Nutrición
// caben en 375 × 667 sin scroll vertical, con la barra de pestañas y datos realistas (inventados).

const test = base;
test.use({ viewport: { width: 375, height: 667 } });

const json = (body: unknown) => ({ status: 200, contentType: "application/json", body: JSON.stringify(body) });

const TODAY = {
  date: "2026-11-23", today: "2026-11-23", weekday: "mon",
  plan: {
    id: 7, week_start: "2026-11-23", type: "gym",
    entries: [
      { kind: "gym", session: "A", time: "18:30", exercises: ["Sentadilla", "Press banca", "Remo con barra", "Press militar"] },
      { kind: "cardio", minutes: 30 },
    ],
  },
  day_type: "gym", day_type_set: false, trained: null, mobility: null, weight_kg: null, weight_blocked: false,
  menu: null, next_meal: null,
  cardio: {
    sessions: [],
    week: { start: "2026-11-23", minutes: 0, equivalent: 0, goal: 150, mma_minutes: 0, mma_convention: null, rule_key: "x", grade: null, vigorous_rule_key: "y", vigorous_grade: null },
    types: [],
  },
};

const RULE = (key: string, title: string, grade = "moderate") => ({ key, title, grade });
const TARGETS = {
  blocked: null, goal: "maintenance", kcal: 2600, maintenance_kcal: 2600, deficit_kcal: 0, in_deficit: false, deficit_blocked: false, clamped: false,
  macros: { protein_g: 112, fat_g: 72.22, fat_min_g: 57.8, carbs_g: 372.5, fibre_g: 25, protein_g_per_kg: 1.6 },
  equation: { code: "ten_haaf", rmr_kcal: 1881.2, ffm_kg: null, pal: 1.675, activity_level: "desk_training", rule_key: "nutrition/trained-clients-cunningham-or-ten-haaf" },
  rules: {
    kcal: [RULE("nutrition/trained-clients-cunningham-or-ten-haaf", "Trained clients")],
    protein_g: [RULE("nutrition/daily-protein-target-for-people-who-lift", "Protein")],
    fat_g: [RULE("nutrition/minimum-dietary-fat", "Fat")],
    fibre_g: [RULE("nutrition/dietary-fibre", "Fibre", "strong")],
  },
  reasons: [],
  weight: { kg: 70, date: "2026-11-20", stale_days: 3 },
  engine: { sha: "69e5537", knowledge_checked_on: "2026-11-01" },
};
const WEIGH_IN = {
  blocked: false, deficit_blocked: false, reasons: [], goal_weight_kg: 68.5, goal_date: null, weigh_in_at: null,
  weight_class: null, days_left: 14, current_kg: 70, to_go_kg: 1.5,
};

async function setup(page: Page) {
  await loginAsTestUser(page);
  // Un día con comidas apuntadas y agua, como un uso real
  await page.addInitScript(() => {
    const d = new Date();
    const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    localStorage.setItem(`flp_nutri_${iso}`, JSON.stringify([
      { id: "a1", meal: "Desayuno", name: "Avena con yogur", grams: 250, kcal: 410, p: 18, c: 60, f: 9 },
      { id: "a2", meal: "Desayuno", name: "Plátano", grams: 120, kcal: 107, p: 1, c: 27, f: 0 },
      { id: "a3", meal: "Comida", name: "Arroz con pollo", grams: 400, kcal: 720, p: 45, c: 90, f: 18 },
      { id: "a4", meal: "Snack", name: "Yogur griego", grams: 170, kcal: 150, p: 15, c: 6, f: 7 },
    ]));
  });
  await page.route("**/api/proxy/coach/today*", (route) => route.fulfill(json(TODAY)));
  await page.route("**/api/proxy/coach/targets*", (route) => route.fulfill(json(TARGETS)));
  await page.route("**/api/proxy/coach/weigh-in*", (route) => route.fulfill(json(WEIGH_IN)));
}

const noVerticalScroll = (page: Page) =>
  page.evaluate(() => ({ scroll: document.scrollingElement!.scrollHeight, inner: window.innerHeight }));

test("Entreno: la portada cabe en 375×667 sin scroll", async ({ page }) => {
  await setup(page);
  await page.goto("/training");
  await expect(page.getByTestId("hub-today-start")).toHaveAttribute("href", "/training/gym/session?plan=A");
  await expect(page.getByTestId("hub-routines")).toBeVisible();
  const { scroll, inner } = await noVerticalScroll(page);
  expect(scroll).toBeLessThanOrEqual(inner + 1);
});

test("Nutrición: la portada cabe en 375×667 sin scroll", async ({ page }) => {
  await setup(page);
  await page.goto("/nutrition");
  await expect(page.getByTestId("kcal-today")).toContainText("/ 2600 kcal");
  await expect(page.getByTestId("weigh-card")).toContainText("Objetivo 68,5 kg");
  const { scroll, inner } = await noVerticalScroll(page);
  expect(scroll).toBeLessThanOrEqual(inner + 1);
});
