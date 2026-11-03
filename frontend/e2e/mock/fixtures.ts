import { test as base, expect, type Page } from "@playwright/test";

export const TEST_UID = "1"; // = ME.id: claimDeviceOwner purga si el dueño no coincide

const PROFILE = {
  date_of_birth: "1995-04-02",
  gender: "male",
  height_cm: 180,
  dominant_stance: "orthodox",
  preferred_units: "metric",
  timezone: "Europe/Madrid",
  // Perfil ampliado del coach, con el onboarding hecho
  equation_sex: null, goal: "maintenance", experience: "intermediate", activity_level: "desk_training",
  language: "es", region: "es", emergency_number: null, medications: [], medications_other: [],
  conditions: [], conditions_other: [], disciplines: [], training_frequency: null, goal_weight_kg: null,
  goal_date: null, weight_class: null, weigh_in_at: null,
};

// Respuestas del coach con el cribado contestado y sin bloqueos. Sin pesos en la biometría
// (`me/biometrics` vacío), los objetivos dan el 409 del motor que pide el peso.
const SCREENING = {
  values: {
    scoff_yes_count: 0, scoff_positive: false, parq_any_yes: false, parq_followup_yes: null,
    vigorous_reviewed: null, cardiac_symptoms: false, menstrual: null, bp_systolic: null, bp_diastolic: null,
  },
  parq_url: "https://eparmedx.com/", parq_native_form: false,
};
const SAFETY = {
  screened: true, flags: {}, reasons: [], paused_exercises: {}, refer_gp: false, deferral_line: null,
  disclaimer: "Esto es orientación general de un entrenador automatizado, no consejo médico.",
  emergency_number: "112", parq_pending: false, weight: null, crt6_url: null,
};
const WEIGH_IN = {
  blocked: false, deficit_blocked: false, reasons: [], goal_weight_kg: null, goal_date: null,
  weigh_in_at: null, weight_class: null, days_left: null, current_kg: null, to_go_kg: null,
};

const ME = { id: 1, email: "e2e@example.test", role: "athlete", is_email_verified: true };

type Seed = Record<string, unknown>;

/** Sesión falsa: cookie `fl_refresh` (la exige proxy.ts), localStorage sembrado
    y /api/proxy/* mockeado. `extraState` se serializa a `flp_*`. */
export async function loginAsTestUser(page: Page, extraState: Seed = {}) {
  await page.context().addCookies([
    { name: "fl_refresh", value: "e2e", url: "http://localhost:3100" },
    { name: "fl_access", value: "e2e", url: "http://localhost:3100" },
  ]);

  await page.addInitScript(
    ([uid, state]) => {
      if (sessionStorage.getItem("__e2e_seeded")) return;
      sessionStorage.setItem("__e2e_seeded", "1");
      localStorage.setItem("flp_owner_uid", uid as string);
      for (const [k, v] of Object.entries(state as Seed)) {
        localStorage.setItem(k, typeof v === "string" ? v : JSON.stringify(v));
      }
    },
    [TEST_UID, extraState] as const,
  );

  await page.route("**/api/proxy/**", async (route) => {
    const { pathname } = new URL(route.request().url());
    const path = pathname.replace(/^\/api\/proxy\//, "");
    const json = (body: unknown, status = 200) =>
      route.fulfill({
        status,
        contentType: "application/json",
        headers: { "x-e2e-mock": "1" },
        body: JSON.stringify(body),
      });

    if (path.startsWith("health")) return json({ status: "ok" });
    if (path.startsWith("me/profile")) return json(PROFILE);
    if (path.startsWith("coach/screening")) return json(SCREENING);
    if (path.startsWith("coach/safety")) return json(SAFETY);
    if (path.startsWith("coach/weigh-in")) return json(WEIGH_IN);
    if (path.startsWith("coach/targets")) return json({ code: "profile_incomplete", field: "weight_kg" }, 409);
    if (path.startsWith("me/biometrics")) return json([]);
    if (path.startsWith("me/state")) return json({});
    if (path.startsWith("activities")) return json([]);
    if (path.startsWith("me")) return json(ME);
    return json({ detail: "not mocked in e2e" }, 404);
  });
}

export const test = base.extend<{ session: void }>({
  session: [
    async ({ page }, use) => {
      await loginAsTestUser(page);
      await use();
    },
    { auto: false },
  ],
});

export { expect };
