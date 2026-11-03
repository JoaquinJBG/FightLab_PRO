import { expect, test, type Page } from "@playwright/test";
import es from "../messages/es.json";
import { PASSWORD, READY_USERS } from "./users";

// Plan de la semana (fase 6) de punta a punta: BFF de Next + Django + motor del coach. El plan
// lo genera el servidor por reglas; aquí se comprueba que cada línea lleva su regla, que los
// flags sacan lo que tienen que sacar y que "Aplicar" lo lleva a Mi rutina.

async function login(page: Page, email: string) {
  await page.goto("/login");
  await page.locator('input[type="email"]').fill(email);
  await page.locator('input[type="password"]').fill(PASSWORD);
  await page.locator('button[type="submit"]').click();
  await page.waitForURL("**/dashboard");
}

async function build(page: Page) {
  await page.goto("/training/plan");
  await expect(page.getByTestId("plan-form")).toBeVisible();
  await page.getByRole("button", { name: es.weeklyPlan.form.generate }).click();
  await expect(page.getByTestId("weekly-plan")).toBeVisible();
}

test("preparar el plan, cada línea con su regla, y aplicarlo a Mi rutina", async ({ page }) => {
  await login(page, READY_USERS.plan);
  await build(page);
  await expect(page.getByTestId("plan-status")).toHaveText(es.weeklyPlan.status.draft);

  // El MMA registrado ocupa su día y el gimnasio no lo pisa.
  const mmaDay = page.getByTestId("plan-entry-mma");
  await expect(mmaDay).toHaveCount(1);
  await expect(page.getByTestId("plan-entry-gym")).toHaveCount(2);

  // El press banca sale con la carga del motor (60 kg, misma carga y más repeticiones).
  const bench = page.locator('[data-testid="plan-item"][data-exercise="Press banca"]').first();
  await expect(bench).toHaveAttribute("data-action", "add_reps");
  await expect(bench).toContainText("60 kg");
  // Cada ejercicio lleva su chip de evidencia.
  const items = page.getByTestId("plan-item");
  const n = await items.count();
  expect(n).toBe(6);
  for (let i = 0; i < n; i++) await expect(items.nth(i).getByTestId("evidence-chip").first()).toBeVisible();

  // Las series duras de la semana, con el press banca contando para el pecho.
  await expect(page.getByTestId("strength-sets")).toContainText(es.weeklyPlan.muscles.chest);

  await page.getByRole("button", { name: es.weeklyPlan.apply }).click();
  await expect(page.getByTestId("plan-status")).toHaveText(es.weeklyPlan.status.active);

  await page.goto("/training/my-routine");
  await expect(page.getByTestId("routine-active-plan")).toBeVisible();
  const start = page.getByRole("link", { name: es.weeklyPlan.startSession.replace("{key}", "A") });
  await expect(start).toHaveAttribute("href", "/training/gym/session?plan=A");
});

test("con un SÍ en el PAR-Q+ el plan no tiene trabajo vigoroso ni SIT/REHIT", async ({ page }) => {
  await login(page, READY_USERS.planParq);
  await build(page);
  const offered = await page.getByTestId("modality-allowed").evaluateAll((els) => els.map((e) => e.getAttribute("data-key")));
  for (const key of ["sparring_hard", "competition", "hiit", "sprints", "jump_rope", "sit", "rehit"]) {
    expect(offered).not.toContain(key);
  }
  const excluded = page.locator('[data-testid="modality-excluded"][data-key="hiit"]');
  await expect(excluded).toContainText(es.weeklyPlan.blockedBy.review_before_vigorous);
  await expect(page.locator('[data-testid="modality-excluded"][data-key="sit"]').first()).toContainText(
    es.weeklyPlan.blockedBy.no_all_out_sprints,
  );
  await expect(page.getByTestId("plan-safety").getByTestId("plan-reason").first()).toBeVisible();
});

test("con no_training no se prepara plan", async ({ page }) => {
  await login(page, READY_USERS.noTraining);
  await page.goto("/training/plan");
  await expect(page.getByTestId("plan-blocked")).toBeVisible();
  await expect(page.getByTestId("plan-form")).toHaveCount(0);
  const resp = await page.request.post("/api/proxy/coach/plan", { data: {} });
  expect(resp.status()).toBe(409);
  expect((await resp.json()).code).toBe("no_training");
});
