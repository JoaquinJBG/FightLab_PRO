import { expect, test, type Page } from "@playwright/test";
import es from "../messages/es.json";
import { PASSWORD, READY_USERS } from "./users";

// F17 R de punta a punta (BFF de Next + Django): cargar un programa clásico como rutinas,
// editar una (serie de calentamiento, descanso), el borrador de `start` para el registro (con el
// aviso de la lesión que pausa la sentadilla) y «Mi rutina» como carpeta de rutinas del plan.

async function login(page: Page, email: string) {
  await page.goto("/login");
  await page.locator('input[type="email"]').fill(email);
  await page.locator('input[type="password"]').fill(PASSWORD);
  await page.locator('button[type="submit"]').click();
  await page.waitForURL("**/today");
}

test("programa → rutinas editables → borrador de start; y Mi rutina con las rutinas del plan", async ({ page }) => {
  await login(page, READY_USERS.routines);

  await page.goto("/training/routines");
  await expect(page.getByTestId("routines-empty")).toBeVisible();
  await page.getByTestId("programs-link").click();
  const card = page.locator('[data-testid="program-card"][data-slug="ppl-3"]');
  await expect(card.getByTestId("evidence-chip").first()).toHaveAttribute("data-variant", "convention");
  await card.getByTestId("program-load").click();
  await page.waitForURL("**/training/routines");

  const folder = page.getByTestId("routine-folder").first();
  await expect(folder).toContainText("Empuje-tirón-pierna, 3 días");
  await expect(folder.getByTestId("routine-card")).toHaveCount(3);

  // Editar «Pierna»: la sentadilla con una serie más y 3 min de descanso.
  await folder.locator('[data-testid="routine-card"]', { hasText: "Pierna" }).getByTestId("routine-edit").click();
  await page.waitForURL(/\/training\/routines\/\d+$/);
  const id = Number(page.url().split("/").pop());
  const squat = page.locator('[data-testid="routine-exercise"][data-exercise-key="cat:barbell-back-squat"]');
  await expect(squat.getByTestId("set-row")).toHaveCount(6); // 2 de calentamiento y 4 efectivas
  await squat.getByTestId("set-add").click();
  await squat.getByTestId("exercise-rest").selectOption("180");
  await page.getByTestId("routine-save").click();
  await expect(page.getByTestId("routine-start")).toHaveAttribute("href", `/training/gym/session?routine=${id}`);

  // El borrador que lee el registro (contrato de F17 con H).
  const start = await (await page.request.get(`/api/proxy/gym/routines/${id}/start`)).json();
  expect(start.routine_id).toBe(id);
  const first = start.exercises[0];
  expect(first.exercise_key).toBe("cat:barbell-back-squat");
  expect(first.rest_s).toBe(180);
  expect(first.sets).toHaveLength(7);
  expect(first.sets.map((s: { set_type: string }) => s.set_type).slice(0, 2)).toEqual(["warmup", "warmup"]);
  // La lesión sin evaluar pausa la sentadilla: el registro lo avisará.
  expect(start.safety.paused.map((p: { exercise_key: string }) => p.exercise_key)).toContain("cat:barbell-back-squat");

  // Mi rutina: el plan aplicado se convierte en rutinas del mismo modelo.
  await page.goto("/training/plan");
  await page.getByRole("button", { name: es.weeklyPlan.form.generate }).click();
  await expect(page.getByTestId("weekly-plan")).toBeVisible();
  await page.getByRole("button", { name: es.weeklyPlan.apply }).click();
  await expect(page.getByTestId("plan-status")).toHaveText(es.weeklyPlan.status.active);
  await page.goto("/training/my-routine");
  const planRoutines = page.getByTestId("plan-routines");
  await expect(planRoutines.getByTestId("routine-card")).toHaveCount(2);
  const startA = page.getByRole("link", { name: es.weeklyPlan.startSession.replace("{key}", "A") });
  await expect(startA).toHaveAttribute("href", /\/training\/gym\/session\?routine=\d+$/);
});
