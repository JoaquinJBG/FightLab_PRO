import { test, expect, loginAsTestUser } from "./fixtures";
import type { Page } from "@playwright/test";

type Ex = { name: string; sets: { kg: string; reps: string; done: boolean }[] };

const live = (exercises: Ex[]) => ({
  flp_gym_live: { startedAt: Date.now() - 20 * 60_000, focus: null, exercises, savedAt: Date.now() },
});

const hOverflow = (page: Page) =>
  page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

async function open(page: Page, exercises: Ex[]) {
  await loginAsTestUser(page, live(exercises));
  await page.goto("/training/gym/session");
  await expect(page.getByLabel("Peso, serie 1").first()).toBeVisible();
}

const savedSessions = (page: Page) =>
  page.evaluate(() => JSON.parse(localStorage.getItem("flp_gym_sessions") ?? "[]"));

test("la fila de serie cabe en la tarjeta y los objetivos táctiles son ≥ 44 px", async ({ page }) => {
  await open(page, [
    { name: "Press banca", sets: [{ kg: "100", reps: "10", done: false }, { kg: "", reps: "", done: true }] },
  ]);
  expect(await hOverflow(page)).toBeLessThanOrEqual(0);

  const card = page.locator(".glass", { hasText: "Press banca" }).first();
  const cardBox = (await card.boundingBox())!;
  const done = page.getByRole("button", { name: "Serie 1 hecha" });
  const doneBox = (await done.boundingBox())!;
  // borde interior de la tarjeta = borde - padding (p-4 = 16 px)
  expect(doneBox.x + doneBox.width).toBeLessThanOrEqual(cardBox.x + cardBox.width - 16 + 0.5);

  // los botones del descanso (+30s / Saltar) solo existen tras marcar una serie
  await done.click();
  await expect(page.getByRole("button", { name: "Saltar" })).toBeVisible();

  const targets = [
    page.getByLabel("Peso, serie 1"),
    page.getByLabel("Repeticiones, serie 1"),
    done,
    page.getByRole("button", { name: "Quitar Press banca" }),
    page.getByRole("link", { name: "← Gimnasio" }),
    page.getByRole("button", { name: "60s" }),
    page.getByRole("button", { name: "+30s" }),
    page.getByRole("button", { name: "Saltar" }),
    page.getByRole("button", { name: "+ Serie" }),
  ];
  for (const t of targets) {
    const b = (await t.boundingBox())!;
    expect(b.width, await t.innerText().catch(() => "")).toBeGreaterThanOrEqual(43.5);
    expect(b.height).toBeGreaterThanOrEqual(43.5);
  }
});

test("✓ expone aria-pressed y los inputs tienen etiqueta", async ({ page }) => {
  await open(page, [{ name: "Dominadas", sets: [{ kg: "", reps: "", done: false }, { kg: "", reps: "", done: false }] }]);
  const done = page.getByRole("button", { name: "Serie 2 hecha" });
  await expect(done).toHaveAttribute("aria-pressed", "false");
  await done.click();
  await expect(done).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByLabel("Peso, serie 2")).toBeVisible();
  await expect(page.getByLabel("Repeticiones, serie 2")).toBeVisible();
});

test("kg en blanco con ✓ se guarda como 0 kg y las series sin ✓ no se guardan", async ({ page }) => {
  await open(page, [
    { name: "Fondos", sets: [{ kg: "", reps: "12", done: true }, { kg: "20", reps: "8", done: false }] },
  ]);
  await page.getByRole("button", { name: "Terminar entreno" }).click();
  const dialog = page.getByRole("alertdialog");
  await expect(dialog).toContainText("1 serie(s) con datos sin marcar");
  await dialog.getByRole("button", { name: "Terminar igualmente" }).click();

  await expect(page.getByText("kg totales")).toBeVisible();
  await expect(page.getByText("serie", { exact: true })).toBeVisible();
  const help = (await page.getByRole("button", { name: "Qué es RPE" }).boundingBox())!;
  expect(help.width).toBeGreaterThanOrEqual(43.5);
  expect(help.height).toBeGreaterThanOrEqual(43.5);
  await expect(page.getByRole("button", { name: "7", exact: true })).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("button", { name: "Guardar" }).click();
  await page.waitForURL("**/training/gym");

  const [s] = await savedSessions(page);
  expect(s.exercises).toEqual([{ name: "Fondos", sets: [{ kg: 0, reps: 12 }] }]);
  expect(s.volume).toBe(0);
  expect(s.rpe).toBe(7);
  expect(s.load).not.toBeNull();
});

test("quitar un ejercicio se puede deshacer y descartar pide confirmación", async ({ page }) => {
  await open(page, [
    { name: "Press banca", sets: [{ kg: "80", reps: "8", done: true }, { kg: "80", reps: "8", done: false }] },
    { name: "Remo con barra", sets: [{ kg: "60", reps: "10", done: true }] },
  ]);
  await page.getByRole("button", { name: "Quitar Press banca" }).click();
  await expect(page.getByText("Press banca", { exact: true })).toBeHidden();
  await page.getByRole("button", { name: "Deshacer" }).click();
  await expect(page.getByText("Press banca", { exact: true })).toBeVisible();
  await expect(page.getByLabel("Peso, serie 2").first()).toHaveValue("80");

  await page.getByRole("button", { name: "Terminar entreno" }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Terminar igualmente" }).click();
  await page.getByRole("button", { name: "Descartar entreno" }).click();
  await expect(page).toHaveURL(/\/training\/gym\/session/);
  await page.getByRole("alertdialog").getByRole("button", { name: "Cancelar" }).click();
  await expect(page.getByRole("button", { name: "Descartar entreno" })).toBeVisible();
});

test("la sesión a medias se reanuda tras recargar", async ({ page }) => {
  await open(page, [{ name: "Sentadilla", sets: [{ kg: "", reps: "", done: false }] }]);
  await page.getByLabel("Peso, serie 1").fill("120");
  await page.getByLabel("Repeticiones, serie 1").fill("5");
  await page.getByRole("button", { name: "Serie 1 hecha" }).click();
  await page.reload();
  await expect(page.getByLabel("Peso, serie 1")).toHaveValue("120");
  await expect(page.getByRole("button", { name: "Serie 1 hecha" })).toHaveAttribute("aria-pressed", "true");
});

test("30 ejercicios × 8 series: detalle completo en local y ≤ 8 KB al servidor", async ({ page }) => {
  const exercises: Ex[] = Array.from({ length: 30 }, (_, i) => ({
    name: `Ejercicio personalizado con un nombre bastante largo para la prueba ${i + 1}`,
    sets: Array.from({ length: 8 }, (_, j) => ({ kg: `${102 + j}.5`, reps: String(12 + j), done: true })),
  }));
  await loginAsTestUser(page, live(exercises));
  await page.route("**/api/proxy/activities/sync", (route) => {
    const body = route.request().postDataJSON() as { items: { client_id: string }[] };
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ results: body.items.map((i) => ({ client_id: i.client_id, status: "created" })) }),
    });
  });
  await page.goto("/training/gym/session");
  await expect(page.getByLabel("Peso, serie 1").first()).toBeVisible();

  const sync = page.waitForRequest("**/api/proxy/activities/sync");
  await page.getByRole("button", { name: "Terminar entreno" }).click();
  await expect(page.getByRole("button", { name: "Guardar" })).toBeVisible();
  await expect(page.getByRole("status").filter({ hasText: "Desglose solo en este dispositivo" })).toBeHidden();
  await page.getByRole("button", { name: "Guardar" }).click();
  const req = await sync;
  const detail = (req.postDataJSON() as { items: { detail: Record<string, unknown> }[] }).items[0].detail;
  expect(JSON.stringify(detail).length).toBeLessThanOrEqual(8000);
  expect((detail.ex as unknown[]).length).toBe(30);

  await page.waitForURL("**/training/gym");
  const [s] = await savedSessions(page);
  expect(s.exercises).toHaveLength(30);
  expect(s.exercises[0].sets).toHaveLength(8);
});

const names = (page: Page) => page.locator(".glass .t-title").allInnerTexts();

test("quitar dos ejercicios seguidos: Deshacer recupera ambos, en orden", async ({ page }) => {
  await open(page, [
    { name: "Press banca", sets: [{ kg: "80", reps: "8", done: true }] },
    { name: "Remo con barra", sets: [{ kg: "60", reps: "10", done: true }] },
  ]);
  await page.getByRole("button", { name: "Quitar Press banca" }).click();
  await page.getByRole("button", { name: "Quitar Remo con barra" }).click();
  await expect(page.getByRole("status")).toContainText("Remo con barra (+1)");
  await page.getByRole("button", { name: "Deshacer" }).click();
  await page.getByRole("button", { name: "Deshacer" }).click();
  expect(await names(page)).toEqual(["Press banca", "Remo con barra"]);
});

test("doble toque en la misma posición no pierde ejercicios", async ({ page }) => {
  await open(page, [
    { name: "Press banca", sets: [{ kg: "80", reps: "8", done: true }] },
    { name: "Remo con barra", sets: [{ kg: "60", reps: "10", done: true }] },
  ]);
  const x = (await page.getByRole("button", { name: "Quitar Press banca" }).boundingBox())!;
  await page.touchscreen.tap(x.x + x.width / 2, x.y + x.height / 2);
  await page.touchscreen.tap(x.x + x.width / 2, x.y + x.height / 2);
  const undo = page.getByRole("button", { name: "Deshacer" });
  while (await undo.count()) await undo.click();
  expect(await names(page)).toEqual(["Press banca", "Remo con barra"]);
});

test("deshacer con el ejercicio ya re-añadido une las series", async ({ page }) => {
  await open(page, [{ name: "Press banca", sets: [{ kg: "80", reps: "8", done: true }, { kg: "85", reps: "6", done: true }] }]);
  await page.getByRole("button", { name: "Quitar Press banca" }).click();
  await page.getByRole("button", { name: "+ Añadir ejercicio" }).click();
  await page.getByRole("button", { name: /^Press banca/ }).click();
  await page.getByRole("button", { name: "Deshacer" }).click();
  await expect(page.getByLabel("Peso, serie 1")).toHaveValue("80");
  await expect(page.getByLabel("Peso, serie 2")).toHaveValue("85");
});

test("el aviso de deshacer no tapa ninguna fila tocable", async ({ page }) => {
  await open(page, [
    { name: "Press banca", sets: [{ kg: "80", reps: "8", done: true }] },
    { name: "Remo con barra", sets: [{ kg: "60", reps: "10", done: true }] },
    { name: "Sentadilla", sets: [{ kg: "100", reps: "5", done: false }] },
  ]);
  await page.getByRole("button", { name: "Quitar Press banca" }).click();
  const bar = (await page.getByRole("status").boundingBox())!;
  const undo = (await page.getByRole("button", { name: "Deshacer" }).boundingBox())!;
  expect(undo.height).toBeGreaterThanOrEqual(43.5);
  for (const label of ["Peso, serie 1", "Serie 1 hecha"]) {
    for (const el of await page.getByLabel(label).all()) {
      const b = (await el.boundingBox())!;
      expect(b.y >= bar.y + bar.height - 0.5 || b.y + b.height <= bar.y + 0.5).toBe(true);
    }
  }
});

test("singular en el resumen: '1 serie'", async ({ page }) => {
  await open(page, [{ name: "Dominadas", sets: [{ kg: "", reps: "8", done: true }] }]);
  await page.getByRole("button", { name: "Terminar entreno" }).click();
  await expect(page.getByText("1 serie", { exact: true })).toBeVisible();
  await expect(page.getByText("serie", { exact: true })).toBeVisible();
});

test("sin 'Primera vez' mientras el historial del servidor carga", async ({ page }) => {
  await loginAsTestUser(page, live([{ name: "Press banca", sets: [{ kg: "", reps: "", done: false }] }]));
  await page.route("**/api/proxy/activities?kind=GYM*", async (route) => {
    await new Promise((r) => setTimeout(r, 1500));
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify([{
        id: 1, client_id: "srv-1", kind: "GYM", title: "Gimnasio", started_at: "2026-10-01T10:00:00Z",
        duration_sec: 3600, rpe: 7, kcal: null, note: "", load_au: 420, source: "app", created_at: "2026-10-01T11:00:00Z",
        detail: { focus: null, volume_kg: 640, exercises: [{ name: "Press banca", sets: [{ kg: 80, reps: 8 }] }] },
      }]),
    });
  });
  await page.goto("/training/gym/session");
  await expect(page.getByLabel("Peso, serie 1")).toBeVisible();
  await expect(page.getByText("Primera vez")).toBeHidden();
  await expect(page.getByText("Última vez: 1×8 · 80 kg")).toBeVisible();
});
