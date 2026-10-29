import { expect, test, type Page } from "@playwright/test";
import es from "../messages/es.json";
import { PASSWORD, READY_USERS } from "./users";

// Objetivos, pesaje y bloqueos de la fase 4 de punta a punta: BFF de Next + Django + motor.

async function login(page: Page, email: string) {
  await page.goto("/login");
  await page.locator('input[type="email"]').fill(email);
  await page.locator('input[type="password"]').fill(PASSWORD);
  await page.locator('button[type="submit"]').click();
  await page.waitForURL("**/dashboard");
}

test("perfil completo: objetivos del motor con chips, ecuación usada y sin cálculos en el cliente", async ({ page }) => {
  await login(page, READY_USERS.plain);
  const api = page.waitForResponse((r) => r.url().includes("/api/proxy/coach/targets") && r.status() === 200);
  await page.goto("/nutrition");
  const targets = await (await api).json();

  // El número de la pantalla es el de la API, que es el del motor
  await expect(page.getByTestId("kcal-today")).toContainText(`/ ${targets.kcal} kcal`);
  expect(targets.macros.protein_g).toBeGreaterThan(0);
  // trabaja con una ecuación de atletas (entrena con regularidad y no hay composición corporal)
  expect(targets.equation.code).toBe("ten_haaf");
  await expect(page.getByTestId("kcal-rule").getByTestId("evidence-chip")).toBeVisible();
  await expect(page.getByTestId("macros").getByTestId("evidence-chip")).toHaveCount(2);

  // "Cómo se calculan": la ecuación y su regla
  await page.getByTestId("targets-details").locator("summary").click();
  await expect(page.getByTestId("targets-equation")).toHaveAttribute("data-equation", "ten_haaf");
  await expect(page.getByTestId("targets-reason").first()).toBeVisible();

  // El chip abre la hoja con la regla en español y sus fuentes
  await page.getByTestId("kcal-rule").getByTestId("evidence-chip").click();
  await expect(page.getByTestId("evidence-sheet")).toBeVisible();
});

test("pesaje en la BD: se guarda en el servidor, sobrevive a recargar y refleja flp_weigh", async ({ page }) => {
  await login(page, READY_USERS.plain);
  await page.goto("/nutrition/weigh-in");
  await page.getByTestId("weigh-save").click();
  await expect(page.getByTestId("weigh-summary")).toBeVisible();
  // el pesaje es del servidor: ya no se guarda en localStorage desde esta pantalla
  await page.reload();
  await expect(page.getByTestId("weigh-summary")).toContainText("70");
  // el reflejo provisional para Biometría y Coach (fase I) lo escribe WeighSync
  await expect.poll(() => page.evaluate(() => localStorage.getItem("flp_weigh"))).toContain('"target":70');
  await page.goto("/nutrition");
  await expect(page.getByTestId("weigh-card")).toContainText("Objetivo 70 kg");
});

test("SCOFF positivo: Perder bloqueado y nada de pesaje en Nutrición, pesaje ni Home", async ({ page }) => {
  await login(page, READY_USERS.scoff);
  await expect(page.getByTestId("weight-card")).toHaveCount(0); // Home sin peso
  await expect(page.getByText(es.dashboard.weightReminder.title)).toHaveCount(0);

  await page.goto("/nutrition");
  await expect(page.getByTestId("goal-perder")).toBeDisabled();
  await expect(page.getByTestId("goal-ganar")).toBeDisabled();
  const blocked = page.getByTestId("deficit-blocked");
  await expect(blocked.locator('[data-code="eating_disorder_screen"]')).toBeVisible();
  await expect(blocked.getByTestId("safety-footer")).toHaveText(es.safety.deferralLine);
  await expect(page.getByTestId("weigh-card")).toHaveCount(0);
  // aun con "perder" en el perfil, el objetivo no baja del mantenimiento
  const targets = await page.evaluate(() => fetch("/api/proxy/coach/targets").then((r) => r.json()));
  expect(targets.kcal).toBeGreaterThanOrEqual(targets.maintenance_kcal);
  expect(targets.deficit_kcal).toBeLessThanOrEqual(0);

  await page.goto("/nutrition/weigh-in");
  await expect(page.getByTestId("weigh-blocked")).toBeVisible();
  await expect(page.getByTestId("weigh-save")).toHaveCount(0);
  // el servidor no devuelve esos datos, ni siquiera en el perfil
  const profile = await page.evaluate(() => fetch("/api/proxy/me/profile").then((r) => r.json()));
  expect([profile.goal_weight_kg, profile.goal_date, profile.weight_class, profile.weigh_in_at]).toEqual([null, null, null, null]);
  const refused = await page.evaluate(() =>
    fetch("/api/proxy/coach/weigh-in", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ goal_weight_kg: 65, weigh_in_at: "2030-01-01T09:00:00Z" }),
    }).then(async (r) => [r.status, (await r.json()).code]),
  );
  expect(refused).toEqual([403, "weight_targets_blocked"]);
});

test("sin equation_sex no hay objetivos de calorías y se puede elegir sin bloquear el resto", async ({ page }) => {
  await login(page, READY_USERS.noSex);
  await page.goto("/nutrition");
  await expect(page.getByTestId("equation-sex-prompt")).toContainText(es.nutrition.noSex.title);
  await expect(page.getByTestId("kcal-today")).not.toContainText("/");
  await expect(page.getByText(es.nutrition.water.title)).toBeVisible(); // el resto de la pantalla sigue
  await page.getByTestId("equation-sex-female").click();
  await expect(page.getByTestId("equation-sex-prompt")).toHaveCount(0);
  await expect(page.getByTestId("kcal-today")).toContainText("/");
});

test("no_training: la Home dice 'Sin entrenar hasta revisión médica' y las kcal usan el PAL de desk", async ({ page }) => {
  await login(page, READY_USERS.noTraining);
  await expect(page.getByTestId("state-no-training")).toContainText(es.dashboard.state.noTraining);
  await expect(page.getByTestId("zones-card")).toHaveCount(0); // sin zonas con no_training
  const targets = await page.evaluate(() => fetch("/api/proxy/coach/targets").then((r) => r.json()));
  expect(targets.equation.pal).toBe(1.45);
  expect(targets.reasons.some((r: { code: string }) => r.code === "no_training_desk_pal")).toBe(true);
});
