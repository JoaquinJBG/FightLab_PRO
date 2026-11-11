import { test, expect, loginAsTestUser } from "./fixtures";
import type { Page, Route } from "@playwright/test";

// F17 (rama H) con /api/proxy simulado: empezar desde una rutina (contrato de `start`), registrar
// con tipos, RPE, superserie y discos, los fallos F2 y F18, y el historial del servidor (F1).

const json = (route: Route, body: unknown, status = 200) =>
  route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });

const START = {
  routine_id: 5,
  title: "Torso A",
  exercises: [
    { exercise_key: "cat:barbell-bench-press", name: "Press banca", notes: "Pausa 1 s", rest_s: 120, superset: null,
      sets: [{ set_type: "warmup", reps: 10, reps_max: null, weight_kg: 40, rpe: null, rir: null },
             { set_type: "normal", reps: 6, reps_max: 8, weight_kg: 80, rpe: 8, rir: null }] },
    { exercise_key: "cat:barbell-row", name: "Remo con barra", notes: "", rest_s: 90, superset: 1,
      sets: [{ set_type: "normal", reps: 8, reps_max: null, weight_kg: 60, rpe: null, rir: null }] },
    { exercise_key: "cat:face-pull", name: "Face pull", notes: "", rest_s: 60, superset: 1,
      sets: [{ set_type: "normal", reps: 15, reps_max: null, weight_kg: 20, rpe: null, rir: null }] },
  ],
  safety: { blocked: false, paused: [], reasons: [] },
};

async function gymServer(page: Page, opts: { reject?: boolean } = {}) {
  const posted: unknown[] = [];
  await page.route("**/api/proxy/gym/**", (route) => {
    const url = route.request().url();
    if (url.includes("/gym/routines/5/start")) return json(route, START);
    if (url.includes("/gym/routines/5")) return json(route, { id: 5 });
    if (url.includes("/gym/records")) return json(route, { records: {}, convention: "coach" });
    if (url.includes("/gym/exercises")) return json(route, []);
    return json(route, { detail: "not mocked" }, 404);
  });
  await page.route("**/api/proxy/activities", (route) => {
    if (route.request().method() !== "POST") return route.fallback();
    const body = route.request().postDataJSON() as { client_id: string };
    posted.push(body);
    return opts.reject
      ? json(route, { client_id: body.client_id, status: "invalid", errors: { sets: [{ weight_kg: ["Asegúrese de que este valor es menor o igual a 1000."] }] } }, 400)
      : json(route, { client_id: body.client_id, status: "created", id: 77 }, 201);
  });
  return posted;
}

const hOverflow = (page: Page) =>
  page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

test.describe("móvil del usuario (353×681)", () => {
  test.use({ viewport: { width: 353, height: 681 } });

  test("empezar desde una rutina, superserie y guardar con lo que se envía", async ({ page }) => {
    await loginAsTestUser(page);
    const posted = await gymServer(page);
    await page.goto("/training/gym/session?routine=5");
    await expect(page.getByRole("heading", { name: "Torso A" })).toBeVisible();
    await expect(page.getByLabel("Peso, serie 2").first()).toHaveValue("80");
    expect(await hOverflow(page)).toBeLessThanOrEqual(0);
    await page.screenshot({ path: "test-results/f17-routine-start.png" });

    // tipo de serie: normal → calentamiento
    await expect(page.getByTestId("set-type").nth(0)).toHaveText("C");
    await page.getByRole("button", { name: "Serie 2 hecha" }).first().click();
    await page.getByRole("button", { name: "Saltar" }).click();
    // superserie: del remo se pasa al face pull sin descanso; tras el face pull, descanso
    await page.getByRole("button", { name: "Serie 1 hecha" }).nth(1).click();
    await expect(page.getByTestId("rest-bar")).toBeHidden();
    await expect(page.getByText("Siguiente de la superserie: Face pull →")).toBeVisible();
    await page.getByRole("button", { name: "Serie 1 hecha" }).nth(2).click();
    await expect(page.getByTestId("rest-bar")).toBeVisible();

    await page.getByRole("button", { name: "Terminar entreno" }).click();
    await page.getByRole("alertdialog").getByRole("button", { name: "Terminar igualmente" }).click();
    await expect(page.getByTestId("summary-sets")).toHaveText("3");
    await page.getByText("Actualizar la rutina «Torso A» con lo hecho hoy").click();
    await page.screenshot({ path: "test-results/f17-summary.png" });
    await page.getByRole("button", { name: "Guardar" }).click();
    await page.waitForURL(/\/training\/gym\?saved=1/);
    const sets = (posted[0] as { sets: { exercise_key?: string; superset?: number }[] }).sets;
    expect(sets).toHaveLength(3);
    expect(sets.map((s) => s.exercise_key)).toEqual(["cat:barbell-bench-press", "cat:barbell-row", "cat:face-pull"]);
    expect(sets[1].superset).toBe(1);
  });

  test("F18: la barra del descanso no tapa «Terminar entreno»", async ({ page }) => {
    await loginAsTestUser(page);
    await gymServer(page);
    await page.goto("/training/gym/session?routine=5");
    await page.getByRole("button", { name: "Serie 2 hecha" }).first().click();
    const bar = page.getByTestId("rest-bar");
    await expect(bar).toBeVisible();
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    const finish = (await page.getByRole("button", { name: "Terminar entreno" }).boundingBox())!;
    const chip = (await bar.locator(".glass").boundingBox())!;
    expect(finish.y + finish.height).toBeLessThanOrEqual(chip.y + 0.5);
    await page.screenshot({ path: "test-results/f18-rest-bar.png" });
    await page.getByRole("button", { name: "Terminar entreno" }).click();
    await expect(page.getByRole("alertdialog")).toBeVisible();
  });

  test("F2: un solo separador, aviso de lo imposible y el 400 del servidor con su motivo", async ({ page }) => {
    await loginAsTestUser(page);
    await gymServer(page, { reject: true });
    await page.goto("/training/gym/session?routine=5");
    const kg = page.getByLabel("Peso, serie 2").first();
    await kg.click();
    await page.keyboard.type("9295,.");
    await expect(kg).toHaveValue("9295,");
    await expect(page.getByRole("alert").first()).toContainText("Más de 1000 kg no es posible");
    await expect(page.getByRole("button", { name: "Serie 2 hecha" }).first()).toBeDisabled();
    await page.screenshot({ path: "test-results/f2-weight.png" });
    await kg.fill("92,5");
    await page.getByRole("button", { name: "Serie 2 hecha" }).first().click();
    await page.getByRole("button", { name: "Terminar entreno" }).click();
    await page.getByRole("alertdialog").getByRole("button", { name: "Terminar igualmente" }).click();
    await expect(page.getByTestId("summary-volume")).toHaveText("555");
    await page.getByRole("button", { name: "Guardar" }).click();
    await expect(page.getByTestId("save-error")).toContainText("menor o igual a 1000");
    await expect(page).toHaveURL(/\/training\/gym\/session/);
  });

  test("calculadora de discos", async ({ page }) => {
    await loginAsTestUser(page);
    await gymServer(page);
    await page.goto("/training/gym/session?routine=5");
    await page.getByRole("button", { name: "Opciones de Press banca" }).click();
    await page.getByRole("button", { name: "Discos" }).click();
    const dialog = page.getByRole("dialog", { name: "Calculadora de discos" });
    await expect(dialog.getByTestId("plates-result")).toContainText("En cada lado");
    await dialog.getByLabel("Peso total (kg)").fill("100");
    await expect(dialog.getByTestId("plates-result")).toContainText("25 + 15");
    expect(await hOverflow(page)).toBeLessThanOrEqual(0);
    await page.screenshot({ path: "test-results/f17-plates.png" });
  });

  test("F1: el historial y el calendario salen del servidor", async ({ page }) => {
    await loginAsTestUser(page);
    const today = new Date();
    const month = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}`;
    const day = `${month}-${String(today.getDate()).padStart(2, "0")}`;
    await page.route("**/api/proxy/activities/calendar*", (route) => json(route, { month, days: { [day]: { GYM: 1, MMA: 1 } } }));
    await page.route("**/api/proxy/activities?kind=GYM*", (route) => json(route, Array.from({ length: 4 }, (_, i) => ({
      id: 10 + i, client_id: `srv-${i}`, kind: "GYM", title: `Sesión ${i + 1}`, started_at: new Date(Date.now() - (i + 1) * 86400_000).toISOString(),
      duration_sec: 3600, rpe: 7, kcal: null, note: "", detail: {}, load_au: 420, source: "MANUAL", created_at: "",
      summary: { exercises: 3, sets: 9, volume_kg: 4200 },
    }))));
    await page.goto("/training/gym");
    await expect(page.getByTestId("gym-history").getByRole("link")).toHaveCount(4);
    await expect(page.getByTestId("training-calendar")).toContainText("1 día entrenado");
    expect(await hOverflow(page)).toBeLessThanOrEqual(0);
    await page.screenshot({ path: "test-results/f1-gym-history.png", fullPage: true });
  });
});
