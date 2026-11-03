import { expect, test, type Page } from "@playwright/test";
import es from "../messages/es.json";
import { PASSWORD, READY_USERS } from "./users";

// "Hoy" (fase 11) de punta a punta: BFF de Next + Django. El usuario tiene un plan activo con la
// sesión A hoy y un menú de hoy con desayuno y comida (global-setup.ts, datos inventados). El
// build corre sin NEXT_PUBLIC_VAPID_PUBLIC_KEY: los avisos tienen que salir apagados y explicados.

async function login(page: Page, email: string) {
  await page.goto("/login");
  await page.locator('input[type="email"]').fill(email);
  await page.locator('input[type="password"]').fill(PASSWORD);
  await page.locator('button[type="submit"]').click();
  await page.waitForURL("**/today");
}

test("Hoy es la pantalla de inicio: plan, comidas, parte rápido, peso y cardio se guardan", async ({ page }) => {
  await login(page, READY_USERS.today);
  await expect(page.getByRole("heading", { name: es.today.title, exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: es.nav.today })).toHaveAttribute("aria-current", "page");

  // Plan del día y próxima comida.
  await expect(page.getByTestId("day-plan")).toContainText("Gimnasio, sesión A");
  await expect(page.getByTestId("day-plan")).toContainText("Sentadilla · Press banca");
  await expect(page.getByTestId("next-meal")).toContainText("Desayuno: Avena con yogur");
  await expect(page.getByTestId("day-type-gym")).toHaveAttribute("aria-checked", "true");

  // Comidas: el desayuno hecho pasa la próxima a la comida; la comida, cambiada por otra cosa.
  await page.getByTestId("meal-breakfast-done").click();
  await expect(page.getByTestId("next-meal")).toContainText("Comida: Arroz con pollo");
  await page.getByTestId("meal-lunch-changed").click();
  await page.getByTestId("meal-lunch-change").fill("Pizza y ensalada");
  await page.getByTestId("meal-lunch-change").press("Enter");
  await expect(page.getByTestId("meal-lunch")).toContainText("En su lugar: Pizza y ensalada");
  await expect(page.getByTestId("next-meal")).toContainText(es.today.next.allDone);

  // Parte rápido: movilidad hecha y el día cambiado a descanso.
  await page.getByTestId("toggle-mobility").click();
  await expect(page.getByTestId("toggle-mobility")).toHaveAttribute("aria-pressed", "true");
  await page.getByTestId("day-type-rest").click();
  await expect(page.getByText(es.today.dayType.changed)).toBeVisible();

  // Peso con coma decimal.
  await page.getByTestId("weight-input").fill("80,4");
  await page.getByTestId("weight").getByRole("button", { name: es.today.weight.save }).click();
  await expect(page.getByTestId("weight-saved")).toHaveText("Guardado: 80,4 kg");

  // Cardio: 20 min de trote (vigoroso) cuentan 40 hacia los 150 de la semana.
  await page.getByTestId("cardio-type-run").click();
  await page.getByTestId("cardio-minutes").fill("20");
  await page.getByTestId("cardio-save").click();
  await expect(page.getByTestId("cardio-session")).toHaveCount(1);
  await expect(page.getByTestId("cardio-week")).toHaveText("Esta semana: 40 de 150 min");

  // Todo está en el servidor: al recargar sigue igual.
  await page.reload();
  await expect(page.getByTestId("toggle-mobility")).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByTestId("day-type-rest")).toHaveAttribute("aria-checked", "true");
  await expect(page.getByTestId("meal-breakfast-done")).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByTestId("weight-saved")).toHaveText("Guardado: 80,4 kg");
  await expect(page.getByTestId("cardio-week")).toHaveText("Esta semana: 40 de 150 min");

  // El peso de Hoy es el del check-in de F5.
  const checkin = await (await page.request.get("/api/proxy/coach/checkin")).json();
  expect(checkin.checkin.weight_kg).toBe(80.4);

  // Volver a lo del plan y borrar el cardio apuntado.
  await page.getByRole("button", { name: es.today.dayType.reset }).click();
  await expect(page.getByTestId("day-type-gym")).toHaveAttribute("aria-checked", "true");
  await page.getByRole("button", { name: "Borrar Trote, 20 min" }).click();
  await expect(page.getByTestId("cardio-session")).toHaveCount(0);
});

test("el resumen sigue en /dashboard y los accesos directos llevan a Hoy", async ({ page }) => {
  await login(page, READY_USERS.today);
  await page.getByRole("link", { name: es.today.summaryAria }).click();
  await page.waitForURL("**/dashboard");
  await expect(page.getByRole("link", { name: es.nav.today })).toHaveAttribute("aria-current", "page");

  const manifest = await (await page.request.get("/manifest.webmanifest")).json();
  expect(manifest.start_url).toBe("/today");
  expect(manifest.shortcuts.map((s: { name: string; url: string }) => [s.name, s.url])).toEqual([
    [es.today.shortcuts.today, "/today"],
    [es.today.shortcuts.weigh, "/today#weight"],
    [es.today.shortcuts.nextMeal, "/today#next-meal"],
  ]);
  for (const s of manifest.shortcuts as { icons: { src: string }[] }[]) {
    expect((await page.request.get(s.icons[0].src)).status()).toBe(200);
  }

  await page.goto("/today#weight");
  await expect(page.getByTestId("weight")).toBeInViewport();
});

test("Perfil → Avisos: sin claves VAPID, apagados y explicado", async ({ page }) => {
  await login(page, READY_USERS.today);
  await page.goto("/profile");
  await page.getByTestId("reminders-link").click();
  await page.waitForURL("**/profile/reminders");
  await expect(page.getByTestId("reminders-off")).toContainText(es.reminders.off.title);
  await expect(page.getByTestId("pref-eve")).toBeChecked();
  await page.getByTestId("pref-weigh").click();
  await expect(page.getByTestId("pref-weigh")).toBeChecked();
  await page.waitForLoadState("networkidle");
  await page.reload();
  await expect(page.getByTestId("pref-weigh")).toBeChecked();
  await expect(page.getByText(es.reminders.support.ios)).toBeVisible();
});
