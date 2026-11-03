import { expect, test, type Page } from "@playwright/test";
import es from "../messages/es.json";
import { PASSWORD, READY_USERS } from "./users";

// Revisión semanal (fase 7) de punta a punta: BFF de Next + Django + motor del coach. La revisión
// la calcula el servidor; aquí se comprueba que cada número y cada propuesta llevan su regla, que
// los flags sacan lo que tienen que sacar y que aceptar genera un plan nuevo y cambia los objetivos.

async function login(page: Page, email: string) {
  await page.goto("/login");
  await page.locator('input[type="email"]').fill(email);
  await page.locator('input[type="password"]').fill(PASSWORD);
  await page.locator('button[type="submit"]').click();
  await page.waitForURL("**/dashboard");
}

async function runReview(page: Page, signs: string[] = []) {
  await page.goto("/training/review");
  await expect(page.getByTestId("review-form")).toBeVisible();
  for (const sign of signs) await page.locator(`[data-testid="review-sign"][data-sign="${sign}"]`).check();
  await page.getByRole("button", { name: es.weeklyReview.form.run }).click();
  await expect(page.getByTestId("weekly-review")).toBeVisible();
}

test("revisar la semana, aceptar la descarga y el cambio de calorías, y ver el plan nuevo", async ({ page }) => {
  await login(page, READY_USERS.review);
  await runReview(page, ["joint_aches"]);
  await expect(page.getByTestId("review-status")).toHaveText(es.weeklyReview.status.pending);

  // Peso y calorías del motor, con su regla.
  await expect(page.getByTestId("review-trend").getByTestId("evidence-chip").first()).toBeVisible();
  await expect(page.getByTestId("calories-tdee")).toContainText("kcal");
  // El press banca estancado cuenta como señal y, con las molestias, hay descarga.
  await expect(page.locator('[data-testid="review-lift"][data-exercise="Press banca"]')).toHaveAttribute("data-action", "stalled");
  await expect(page.getByTestId("recovery-status")).toContainText(es.weeklyReview.recovery.indicated);
  const proposals = page.getByTestId("review-proposal");
  await expect(proposals).toHaveCount(2);
  for (const kind of ["calories", "deload"]) {
    await expect(page.locator(`[data-testid="review-proposal"][data-kind="${kind}"]`).getByTestId("evidence-chip").first()).toBeVisible();
  }

  const before = await (await page.request.get("/api/proxy/coach/targets")).json();
  await page.getByTestId("review-accept").click();
  await expect(page.getByTestId("review-status")).toHaveText(es.weeklyReview.status.accepted);
  const after = await (await page.request.get("/api/proxy/coach/targets")).json();
  expect(after.recalibrated).not.toBeNull();
  expect(after.kcal).toBe(before.kcal - 200); // un escalón de `RECALIBRATE_STEP_KCAL`

  await page.getByTestId("review-plan-link").click();
  await page.waitForURL("**/training/plan");
  await expect(page.getByTestId("plan-deload")).toBeVisible();
  await expect(page.getByTestId("plan-status")).toHaveText(es.weeklyPlan.status.draft);
  const bench = page.locator('[data-testid="plan-item"][data-exercise="Press banca"]').first();
  await expect(bench).toHaveAttribute("data-action", "deload");
  await expect(bench).toContainText("60 kg");
});

test("con no_weight_targets la revisión no dice nada de peso ni de kcal", async ({ page }) => {
  await login(page, READY_USERS.reviewScoff);
  await runReview(page);
  await expect(page.getByText(es.weeklyReview.weight.disabled)).toBeVisible();
  await expect(page.getByTestId("review-calories")).toHaveCount(0);
  await expect(page.locator('[data-testid="review-proposal"][data-kind="calories"]')).toHaveCount(0);
  expect(await page.getByTestId("weekly-review").innerText()).not.toMatch(/kcal/);
});

test("con no_training no hay consejos de entrenamiento ni descarga", async ({ page }) => {
  await login(page, READY_USERS.noTraining);
  await runReview(page, ["joint_aches", "poor_sleep"]);
  await expect(page.getByTestId("recovery-status")).toContainText(es.weeklyReview.recovery.no_training);
  await expect(page.getByTestId("review-training")).toContainText(es.weeklyReview.training.blocked);
  await expect(page.locator('[data-testid="review-proposal"][data-kind="deload"]')).toHaveCount(0);
});

test("la evidencia antigua no llega al atleta", async ({ page }) => {
  await login(page, READY_USERS.plain);
  const state = await (await page.request.get("/api/proxy/coach/review")).json();
  expect(state).not.toHaveProperty("stale");
  expect((await page.request.get("/api/proxy/coach/knowledge/stale")).status()).toBe(403);
  await page.goto("/training/review");
  await expect(page.getByTestId("review-form")).toBeVisible();
  await expect(page.getByTestId("review-stale")).toHaveCount(0);
});
