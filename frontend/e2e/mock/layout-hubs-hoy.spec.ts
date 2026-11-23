import { test, expect } from "./fixtures";

// Las portadas de Hoy, Progreso y Perfil caben sin scroll vertical en 375 × 667 (con la barra de
// pestañas), con datos realistas (docs/ux/estructura-app.md, regla 1). Datos inventados.
test.use({ viewport: { width: 375, height: 667 }, reducedMotion: "reduce" });

const day = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString();
const iso = new Date().toISOString().slice(0, 10);

const WEEK = {
  start: iso, minutes: 60, equivalent: 80, goal: 150, mma_minutes: 0, mma_convention: null,
  rule_key: "cardio-health/weekly-baseline-dose", grade: "strong",
  vigorous_rule_key: "cardio-health/0-10-effort-scale-and-talk-test-anchors", vigorous_grade: "moderate",
};
const TODAY = {
  date: iso, today: iso, weekday: "mon",
  plan: {
    id: 3, week_start: iso, type: "gym",
    entries: [{ kind: "gym", time: "18:00", session: "A", exercises: ["Sentadilla", "Press banca", "Remo con barra", "Press militar", "Peso muerto rumano", "Plancha"] }],
  },
  day_type: "gym", day_type_set: false, trained: null, mobility: null, weight_kg: 78.4, weight_blocked: false,
  menu: {
    id: 7, start_date: iso,
    meals: [
      { meal: "breakfast", free: false, tupper: false, dishes: ["Avena con plátano"], prep: [], eve: [], mark: { state: "done", change: null } },
      { meal: "lunch", free: false, tupper: true, dishes: ["Pollo con arroz y verduras"], prep: [], eve: ["Sacar el pollo"], mark: null },
    ],
  },
  next_meal: { all_done: false, meal: "lunch", free: false, dishes: ["Pollo con arroz y verduras"] },
  cardio: {
    sessions: [{ id: 11, type: "walk", title: "walk", minutes: 40, vigorous: false, equivalent: 40, deletable: true }],
    week: WEEK,
    types: [{ key: "walk", vigorous: false }, { key: "run", vigorous: true }, { key: "hiit", vigorous: true }, { key: "other", vigorous: false }],
  },
  tonight: { date: iso, rule_key: "batch-cooking/defrost-in-the-fridge-the-night-before", tasks: [{ kind: "meal", meal: "lunch", text: "Remojar las lentejas" }] },
};
const LOGS = Array.from({ length: 8 }, (_, i) => ({
  id: i + 1, weight_kg: String(78.4 + i * 0.1), body_fat_pct: "14.0", resting_heart_rate: 52 + (i % 3), sleep_quality_score: null, hrv_ms: 68 - (i % 4),
  waist_cm: null, hip_cm: null, chest_cm: null, arm_cm: null, thigh_cm: null, neck_cm: null, timestamp: day(i + 1), source: "MANUAL",
}));
const WEIGH_IN = {
  blocked: false, deficit_blocked: false, reasons: [], goal_weight_kg: 75, goal_date: null, weigh_in_at: null,
  weight_class: null, days_left: null, current_kg: 78.4, to_go_kg: 3.4,
};
const TREND = {
  blocked: false, status: "ok", rate_kg_week: -0.5, rate_pct_week: -0.6, weight_kg: 78.4, points: 9, days: 20, start: null, end: null,
  can_recalibrate: false, min_points: 7, min_days: 14, rule_key: "nutrition/read-the-scale-with-weekly-averages", grade: "moderate", reasons: [],
};
const ZONES = {
  method: "hrmax",
  zones: [
    { name: "light", rpe: [9, 11], talk_test: "x", bpm: [120, 132] },
    { name: "moderate", rpe: [12, 13], talk_test: "x", bpm: [133, 159] },
    { name: "vigorous", rpe: [14, 17], talk_test: "x", bpm: [160, 199] },
  ],
  hr_max: 187, hr_max_source: "tanaka", hr_rest: null, hr_rest_date: null,
  rules: [{ key: "cardio-health/acsm-intensity-bands", grade: "moderate", title: "ACSM" }], reasons: [],
};
const METRICS = {
  week_au: 420, daily7: [60, 0, 90, 70, 0, 120, 80], acwr: 1.08, week_vs_avg_pct: 8, ratio_days_left: 0, gaps: false,
  monotonia: 1.2, tension: 500, sin_variacion: false, history_days: 28, band: null,
};
const CHECKIN = {
  date: iso, checkin: null, weight_blocked: false, weekly_questions: [],
  readiness: {
    status: "no_data", drops_today: [], days_with_drop: 0, hrv_drop: false, rule_key: "recovery-habits/simple-readiness-monitoring",
    grade: "moderate", hrv_rule_key: "recovery-habits/hrv-is-optional", hrv_grade: "emerging",
  },
};

const ROUTES: Record<string, unknown> = {
  "coach/today": TODAY,
  "me/biometrics": LOGS,
  "coach/weigh-in": WEIGH_IN,
  "coach/trend": TREND,
  "coach/zones": ZONES,
  "coach/checkin": CHECKIN,
  "activities/metrics": METRICS,
};

test.beforeEach(async ({ page, session }) => {
  void session;
  // Se registra después de la sesión: manda sobre los datos vacíos de fixtures.ts
  await page.route("**/api/proxy/**", (route) => {
    const path = new URL(route.request().url()).pathname.replace(/^\/api\/proxy\//, "");
    if (!(path in ROUTES)) return route.fallback();
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(ROUTES[path]) });
  });
});

async function noScroll(page: import("@playwright/test").Page) {
  const m = await page.evaluate(() => ({
    scroll: document.scrollingElement!.scrollHeight,
    inner: window.innerHeight,
  }));
  expect(m.scroll, `scrollHeight ${m.scroll} vs ${m.inner}`).toBeLessThanOrEqual(m.inner + 1);
}

test("Hoy cabe en 375×667 sin scroll", async ({ page }) => {
  await page.goto("/today");
  await expect(page.getByTestId("next-meal")).toContainText("Pollo con arroz");
  await expect(page.getByTestId("today-tonight")).toBeVisible();
  await expect(page.getByTestId("quick-weight")).toContainText("78,4");
  await expect(page.getByTestId("tab-bar")).toBeVisible();
  await noScroll(page);
});

test("Progreso cabe en 375×667 sin scroll", async ({ page }) => {
  await page.goto("/dashboard");
  await expect(page.getByTestId("weight-card")).toContainText("78,4");
  await expect(page.getByTestId("zones-tile")).toBeVisible();
  await expect(page.getByTestId("load-summary")).toBeVisible();
  await noScroll(page);
});

test("Perfil cabe en 375×667 sin scroll", async ({ page }) => {
  await page.goto("/profile");
  await expect(page.getByTestId("import-hub-link")).toBeVisible();
  await expect(page.getByRole("button", { name: "Cerrar sesión" })).toBeVisible();
  await noScroll(page);
});

test("el panel de peso de Hoy es un diálogo accesible y /today#weight lo abre", async ({ page }) => {
  await page.goto("/today");
  await page.getByTestId("quick-weight").click();
  const dialog = page.getByRole("dialog", { name: "Peso" });
  await expect(dialog).toBeVisible();
  await expect(page.getByTestId("weight-input")).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await page.goto("/today#weight");
  await expect(page.getByRole("dialog", { name: "Peso" })).toBeVisible();
});

test("la barra marca Progreso en /dashboard y Hoy en /profile", async ({ page }) => {
  await page.goto("/dashboard");
  await expect(page.getByTestId("tab-bar").getByRole("link", { name: "Progreso" })).toHaveAttribute("aria-current", "page");
  await page.goto("/profile");
  await expect(page.getByTestId("tab-bar").getByRole("link", { name: "Hoy" })).toHaveAttribute("aria-current", "page");
});
