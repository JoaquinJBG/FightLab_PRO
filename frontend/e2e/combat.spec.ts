import { expect, test, type Page } from "@playwright/test";
import { PASSWORD, READY_USERS } from "./users";

// Anexo de combate aplicado a la app (E.5), de punta a punta: BFF de Next + Django.
// El selector de idioma está apagado: la app va en español.

async function login(page: Page, email: string) {
  await page.goto("/login");
  await page.locator('input[type="email"]').fill(email);
  await page.locator('input[type="password"]').fill(PASSWORD);
  await page.locator('button[type="submit"]').click();
  await page.waitForURL("**/today");
}

async function safety(page: Page) {
  return page.evaluate(async () => (await fetch("/api/proxy/coach/safety")).json());
}

test("un golpe en la cabeza con síntomas pone no_contact hasta el alta del clínico", async ({ page }) => {
  await login(page, READY_USERS.combat);
  expect((await safety(page)).flags.no_contact).toBe(false);

  await page.goto("/training/mma");
  await page.getByTestId("head-report").click();
  await page.getByTestId("head-symptoms-yes").click();
  await page.getByTestId("head-red-flags-no").click();
  await page.getByTestId("head-send").click();

  const card = page.getByTestId("no-contact-card");
  await expect(card).toContainText("Contacto bloqueado");
  await expect(card.getByTestId("crt6-link")).toHaveAttribute("href", /^https:\/\/doi\.org\/10\.1136\/bjsports-2023-107021$/);
  await expect(card.getByTestId("combat-disclaimer")).toContainText("no consejo médico");

  const data = await safety(page);
  expect(data.flags.no_contact).toBe(true);
  const reason = data.reasons.find((r: { code: string }) => r.code === "head_blow_no_contact");
  expect(reason.rule_key).toBe("combat-sports/a-head-blow-with-symptoms-sets-no-contact-and-refers");
  expect(data.refer_gp).toBe(true);

  // Con el contacto bloqueado no se propone sparring
  await page.getByRole("button", { name: "Sparring" }).click();
  await expect(page.getByTestId("contact-block-note")).toBeVisible();

  // La Home enseña el motivo con su regla
  await page.goto("/dashboard");
  await expect(page.locator('[data-testid="safety-reason"][data-code="head_blow_no_contact"]')).toBeVisible();

  // Solo el alta confirmada lo quita
  await page.goto("/training/mma");
  await page.getByTestId("clear-confirm").check();
  await page.getByTestId("clear-contact").click();
  await expect(page.getByTestId("head-blow-card")).toBeVisible();
  expect((await safety(page)).flags.no_contact).toBe(false);
});

test("carga con menos de 28 días: sin ratio y con los días que faltan", async ({ page }) => {
  await login(page, READY_USERS.combat);
  await page.goto("/training/mma");
  await page.getByText("Guardar sesión").click();
  // La vista sube lo pendiente y luego pide las métricas al servidor
  const server = page.waitForResponse((r) => r.url().includes("/api/proxy/activities/metrics") && r.status() === 200);
  await page.goto("/training/load");
  await expect(page.getByTestId("load-days-left")).toContainText("Faltan 27 días de historial");
  await expect(page.getByTestId("load-comparison-card")).not.toContainText(/ACWR|zona/i);
  const metrics = await (await server).json();
  expect(metrics.acwr).toBeNull();
  expect(metrics.ratio_days_left).toBe(27);
});

test("pesaje: información de corte con sus reglas, sin protocolo", async ({ page }) => {
  await login(page, READY_USERS.combat);
  await page.goto("/nutrition/weigh-in");
  const card = page.getByTestId("cut-info");
  await expect(card).toContainText("información, no un protocolo");
  await expect(card.locator('[data-testid="evidence-chip"][data-variant="evidence"]')).toHaveCount(9);
});
