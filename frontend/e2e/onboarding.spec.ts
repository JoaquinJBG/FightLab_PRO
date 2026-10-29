import { expect, test, type Page } from "@playwright/test";
import es from "../messages/es.json";
import en from "../messages/en.json";
import { PASSWORD, USERS } from "./users";

// Onboarding con cribado de punta a punta (Task 3.6): BFF de Next + Django + motor.

async function login(page: Page, email: string) {
  await page.goto("/login");
  await page.locator('input[type="email"]').fill(email);
  await page.locator('input[type="password"]').fill(PASSWORD);
  await page.locator('button[type="submit"]').click();
  // Sin cribado, la puerta del shell manda al onboarding.
  await page.waitForURL("**/onboarding");
}

async function next(page: Page) {
  await page.getByTestId("onboarding-next").click();
}

async function answerScoff(page: Page, yes: string[]) {
  for (const item of ["sick", "control", "fat", "dominate", "weightLoss"]) {
    await page.getByTestId(`scoff-${item}`).getByTestId(yes.includes(item) ? "yes" : "no").click();
  }
}

async function basics(page: Page, gender: "FEMALE" | "MALE", year = "1990") {
  await page.getByLabel(/^(Día|Day)$/).fill("01");
  await page.getByLabel(/^(Mes|Month)$/).fill("05");
  await page.getByLabel(/^(Año|Year)$/).fill(year);
  await page.getByTestId("height-input").fill("172");
  await page.getByTestId(`gender-${gender}`).click();
  await next(page);
}

test("SCOFF positivo: ve el bloqueo del déficit y la línea de derivación (es)", async ({ page }) => {
  await login(page, USERS.scoffPositive);
  await page.getByTestId("onboarding-start").click();

  // 1 · idioma y región
  await page.getByTestId("lang-es").click();
  await page.getByTestId("region-es").click();
  await next(page);

  // 2 · SCOFF antes del peso: dos síes claros, sin señal de alarma
  await expect(page.getByTestId("onboarding-step-scoff")).toBeVisible();
  await expect(page.getByTestId("weight-input")).toHaveCount(0);
  await answerScoff(page, ["fat", "dominate"]);
  await next(page);
  const outcome = page.getByTestId("scoff-outcome");
  await expect(outcome).toContainText(es.onboarding.scoff.positive);
  await expect(outcome.getByTestId("safety-reason")).toHaveAttribute("data-code", "eating_disorder_screen");
  await expect(outcome.getByTestId("safety-footer")).toHaveText(es.safety.deferralLine);
  await next(page);

  // 3 · datos básicos y peso aproximado opcional (sin pedir que se pese)
  await basics(page, "FEMALE");
  await expect(page.getByText(es.onboarding.basics.weightGentle)).toBeVisible();
  await page.getByTestId("onboarding-skip").click();

  // 4 · PAR-Q+: el oficial se abre fuera, nunca incrustado
  const link = page.getByTestId("parq-official-link");
  await expect(link).toHaveAttribute("href", /^https:\/\/eparmedx\.com\//);
  await expect(link).toHaveAttribute("target", "_blank");
  await expect(page.locator("iframe, embed, object")).toHaveCount(0);
  await page.getByTestId("parq-any-yes").getByTestId("no").click();
  await next(page);

  // 5 · síntomas cardiacos
  await page.getByTestId("cardiac-none").click();
  // 6 · medicación y salud
  await next(page);
  // 7 · ciclo
  await page.getByTestId("menstrual-normal").click();
  await next(page);
  // 8 · objetivo: aunque pida perder grasa, el motor no deja déficit
  await page.getByTestId("goals-fat_loss").click();
  await next(page);

  // Punto de partida
  const banner = page.getByTestId("safety-banner");
  await expect(banner.locator('[data-code="eating_disorder_screen"]')).toBeVisible();
  await expect(banner.getByTestId("safety-footer")).toHaveText(es.safety.deferralLine);
  await page.getByTestId("onboarding-finish").click();
  await page.waitForURL("**/dashboard");
  await expect(page.getByTestId("safety-banner").getByTestId("safety-footer")).toHaveText(es.safety.deferralLine);

  // Nutrición: "Perder" bloqueado, con el motivo y la línea de derivación
  await page.goto("/nutrition");
  await expect(page.getByTestId("goal-perder")).toBeDisabled();
  const blocked = page.getByTestId("deficit-blocked");
  await expect(blocked.locator('[data-code="eating_disorder_screen"]')).toBeVisible();
  await expect(blocked.getByTestId("safety-footer")).toHaveText(es.safety.deferralLine);
});

test("onboarding completo en inglés, con el PAR-Q+ sin contestar (en)", async ({ page }) => {
  await login(page, USERS.english);
  await page.getByTestId("onboarding-start").click();

  await page.getByTestId("lang-en").click();
  await page.getByTestId("region-other").click();
  await page.getByRole("button", { name: "911" }).click();
  await next(page);

  // La UI pasa al inglés (cookie flp_lang que fija el BFF al guardar el perfil)
  await expect(page.getByText(en.onboarding.scoff.question)).toBeVisible();
  await answerScoff(page, []);
  await next(page);
  await expect(page.getByTestId("scoff-outcome")).toContainText(en.onboarding.scoff.clear);
  await expect(page.getByTestId("safety-disclaimer")).toHaveText(en.safety.disclaimer);
  await next(page);

  await basics(page, "MALE");
  await expect(page.getByText(en.onboarding.basics.weightHint)).toBeVisible();
  await page.getByTestId("weight-input").fill("80");
  await next(page);

  await expect(page.getByText(en.onboarding.parq.anyYes)).toBeVisible();
  await page.getByTestId("parq-any-yes").getByTestId("unsure").click();
  await expect(page.getByText(en.onboarding.parq.unsureNote)).toBeVisible();
  await next(page);

  await page.getByTestId("cardiac-unsure").click();
  await expect(page.getByText(en.onboarding.cardiac.unsureAgain)).toBeVisible();
  await page.getByTestId("cardiac-none").click();

  await page.getByTestId("token-beta_blocker").click();
  await next(page);

  await page.getByTestId("goals-muscle_gain").click();
  await page.getByTestId("experiences-novice").click();
  await page.getByTestId("activities-desk_training").click();
  await next(page);

  const banner = page.getByTestId("safety-banner");
  await expect(banner.locator('[data-code="beta_blocker_rpe"]')).toContainText("prescribe by RPE and the talk test");
  await expect(banner).toContainText(en.safety.parqPending);
  await expect(banner.getByTestId("safety-footer")).toHaveText(en.safety.disclaimer);
  await page.getByTestId("onboarding-finish").click();
  await page.waitForURL("**/dashboard");
  await expect(page.getByTestId("safety-banner")).toContainText(en.safety.parqPending);
});

test("síntoma cardiaco ahora: pantalla de parada con el número de emergencias", async ({ page }) => {
  await login(page, USERS.cardiac);
  await page.getByTestId("onboarding-start").click();
  await page.getByTestId("lang-es").click();
  await page.getByTestId("region-es").click();
  await next(page);
  await answerScoff(page, []);
  await next(page);
  await next(page);
  await basics(page, "MALE", "1975");
  await page.getByTestId("onboarding-skip").click();

  // 51 años: aunque todo sea NO, pregunta por la revisión del trabajo vigoroso
  await page.getByTestId("parq-any-yes").getByTestId("no").click();
  await expect(page.getByTestId("parq-vigorous")).toBeVisible();
  await page.getByTestId("parq-vigorous").getByTestId("no").click();
  await next(page);

  await page.getByTestId("cardiac-some").click();
  await page.getByTestId("now-yes").click();
  const stop = page.getByTestId("cardiac-stop");
  await expect(stop).toContainText(es.onboarding.cardiac.stopTitle);
  await expect(stop.getByTestId("emergency-call")).toHaveAttribute("href", "tel:112");
  await expect(stop.getByTestId("safety-disclaimer")).toHaveText(es.safety.deferralLine);

  await page.getByText(es.onboarding.cardiac.exit).click();
  await page.waitForURL("**/dashboard");
  const banner = page.getByTestId("safety-banner");
  await expect(banner.locator('[data-code="cardiac_symptoms"]')).toBeVisible();
  await expect(banner.getByText("Emergencias: 112")).toBeVisible();
});
