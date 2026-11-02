import { expect, test, type Page } from "@playwright/test";
import es from "../messages/es.json";
import { PASSWORD, READY_USERS } from "./users";

// Check-in diario y tendencia (fase 5) de punta a punta: BFF de Next + Django + motor del coach.

async function login(page: Page, email: string) {
  await page.goto("/login");
  await page.locator('input[type="email"]').fill(email);
  await page.locator('input[type="password"]').fill(PASSWORD);
  await page.locator('button[type="submit"]').click();
  await page.waitForURL("**/dashboard");
}

const safety = async (page: Page) => (await page.request.get("/api/proxy/coach/safety")).json();

test("un síntoma cardiaco en el check-in activa no_training en la siguiente llamada a safety", async ({ page }) => {
  await login(page, READY_USERS.checkinCardiac);
  expect((await safety(page)).flags.no_training).toBe(false);

  await page.goto("/checkin");
  await page.getByTestId("sign-cardiac").check();
  await page.getByRole("button", { name: es.checkin.submit }).click();

  // aviso con su regla y a quién acudir, no la pantalla de urgencia (no es dolor en reposo)
  const alert = page.getByTestId("checkin-alert");
  await expect(alert).toHaveAttribute("data-code", "cardiac_stop");
  await expect(alert.getByTestId("evidence-chip")).toBeVisible();
  await expect(page.getByTestId("urgent-screen")).toHaveCount(0);
  await expect(page.getByTestId("checkin-deferral")).toBeVisible();

  const after = await safety(page);
  expect(after.flags.no_training).toBe(true);
  expect(after.refer_gp).toBe(true);

  // y la Home deja de sugerir entrenar
  await page.goto("/dashboard");
  await expect(page.getByTestId("state-no-training")).toBeVisible();
});

test("dolor en el pecho en reposo: pantalla de urgencia ahora con el número de emergencias", async ({ page }) => {
  await login(page, READY_USERS.checkinEmergency);
  await page.goto("/checkin");
  await page.getByTestId("sign-cardiac").check();
  await page.getByTestId("sign-cardiac-emergency").check();
  await page.getByRole("button", { name: es.checkin.submit }).click();
  await expect(page.getByTestId("urgent-screen")).toBeVisible();
  await expect(page.getByTestId("urgent-alert")).toHaveAttribute("data-code", "cardiac_emergency");
  await expect(page.getByTestId("urgent-call")).toHaveAttribute("href", "tel:112"); // región es
  await expect(page.getByTestId("checkin-result")).toHaveCount(0);
});

test("con menos de 7 pesajes en 14 días la tendencia dice insuficiente, en el check-in, en Biometría y en la Home", async ({ page }) => {
  await login(page, READY_USERS.checkin);
  await page.goto("/checkin");
  await page.getByTestId("weight").fill("71.5");
  await page.getByTestId("sleep-hours").fill("7");
  await page.getByTestId("score-energy").getByRole("button", { name: /4/ }).click();
  await page.getByRole("button", { name: es.checkin.submit }).click();

  const trend = page.getByTestId("checkin-result").getByTestId("trend-insufficient");
  await expect(trend).toBeVisible();
  await expect(trend).toContainText("7");
  await expect(page.getByTestId("checkin-result").getByTestId("trend-ok")).toHaveCount(0);

  // el peso del check-in es un pesaje más: lo ve el motor
  const body = await (await page.request.get("/api/proxy/coach/trend")).json();
  expect(body.status).toBe("insufficient_data");
  expect(body.points).toBe(1); // el pesaje inicial (hoy) y el del check-in caen el mismo día

  await page.goto("/biometrics");
  await expect(page.getByTestId("trend-insufficient")).toBeVisible();
  await page.goto("/dashboard");
  await expect(page.getByTestId("weight-card").getByTestId("trend-insufficient")).toBeVisible();
  // la Home sabe que ya hay check-in hoy
  await expect(page.getByTestId("checkin-card")).toContainText(es.checkin.homeCard.done);
});

test("un segundo check-in el mismo día completa el primero y no duplica el pesaje", async ({ page }) => {
  await login(page, READY_USERS.checkin);
  await page.goto("/checkin");
  await expect(page.getByTestId("checkin-already")).toBeVisible();
  await page.getByTestId("notes").fill("agujetas en las piernas");
  await page.getByRole("button", { name: es.checkin.submit }).click();
  await expect(page.getByTestId("checkin-result")).toBeVisible();
  const state = await (await page.request.get("/api/proxy/coach/checkin")).json();
  expect(state.checkin.weight_kg).toBe(71.5);
  expect(state.checkin.sleep_hours).toBe(7);
  expect(state.checkin.notes).toBe("agujetas en las piernas");
});

test("SCOFF positivo: el check-in no pide peso, cintura ni kcal, y Biometría no muestra nada de peso", async ({ page }) => {
  await login(page, READY_USERS.scoff);
  await page.goto("/checkin");
  await expect(page.getByTestId("checkin-blocked")).toBeVisible();
  await expect(page.getByTestId("weight")).toHaveCount(0);
  await expect(page.getByTestId("waist")).toHaveCount(0);
  await expect(page.getByTestId("intake")).toHaveCount(0);
  await page.getByTestId("sleep-hours").fill("6");
  await page.getByRole("button", { name: es.checkin.submit }).click();
  await expect(page.getByTestId("checkin-result")).toBeVisible();

  // el servidor tampoco lo acepta
  const refused = await page.request.post("/api/proxy/coach/checkin", { data: { weight_kg: 70 } });
  expect(refused.status()).toBe(403);
  expect((await refused.json()).code).toBe("weight_targets_blocked");
  const direct = await page.request.post("/api/proxy/me/biometrics", { data: { weight_kg: "70.0" } });
  expect(direct.status()).toBe(403);

  await page.goto("/biometrics");
  await expect(page.getByTestId("weight-blocked")).toBeVisible();
  await expect(page.locator("svg[role=img]")).toHaveCount(0);
  const logs = await (await page.request.get("/api/proxy/me/biometrics")).json();
  expect(logs.every((l: { weight_kg: string | null }) => l.weight_kg === null)).toBe(true);
  await page.goto("/biometrics/new");
  await expect(page.getByTestId("body-blocked")).toBeVisible();
});

test("la grasa corporal con método fiable (DXA) pasa a usar Cunningham (U04)", async ({ page }) => {
  await login(page, READY_USERS.checkinFat);
  const before = await (await page.request.get("/api/proxy/coach/targets")).json();
  expect(before.equation.code).toBe("ten_haaf");

  await page.goto("/biometrics/new");
  await page.getByRole("button", { name: es.biometrics.new.advancedToggle }).click();
  await page.locator('input[type="number"]').nth(1).fill("14"); // % grasa (peso, % grasa, FC, HRV)
  await page.getByTestId("body-fat-method-select").selectOption("dxa");
  await page.getByRole("button", { name: es.biometrics.new.save, exact: true }).click();
  await page.waitForURL("**/biometrics");

  const after = await (await page.request.get("/api/proxy/coach/targets")).json();
  expect(after.equation.code).toBe("cunningham");
});
