import { expect, test, type Page } from "@playwright/test";
import es from "../messages/es.json";
import { PASSWORD, READY_USERS } from "./users";

// Fase 10 de punta a punta: BFF de Next + Django. Importar el historial de ParteDiario (copia JSON
// y CSV semanal) y del coach (checkins.csv y una revisión), con un día que ya estaba en FightLab.
// Todos los datos son inventados.

async function login(page: Page, email: string) {
  await page.goto("/login");
  await page.locator('input[type="email"]').fill(email);
  await page.locator('input[type="password"]').fill(PASSWORD);
  await page.locator('button[type="submit"]').click();
  await page.waitForURL("**/today");
}

const day = (back: number) => new Date(Date.now() - back * 86400_000).toISOString().slice(0, 10);

const BACKUP = JSON.stringify({
  kind: "parte-diario-copia",
  format: 1,
  days: [
    { date: day(6), weight_kg: 74.2, sleep_h: 7.5, intake_kcal: 2300, trained: true, mobility: true, quad: "MOLESTIA_LEVE", energy: 4, notes: "Inventado", day_type: "GIMNASIO" },
    { date: day(5), weight_kg: 74.0, sleep_h: 8, energy: 3 },
    // Ya hay un check-in ese día con 5 h de sueño: conflicto.
    { date: day(4), sleep_h: 7, energy: 4 },
  ],
  meal_checks: [
    { date: day(6), meal: "DESAYUNO", state: "HECHO" },
    { date: day(6), meal: "CENA", state: "CAMBIADA", change: "Tortilla" },
  ],
  cardio_sessions: [
    { date: day(6), type: "PASEO", minutes: 25 },
    { date: day(5), type: "TROTE", minutes: 20 },
  ],
  menus: [{ id: "m1", title: "Semana inventada", start: day(13), end: day(7), imported_at: 1, json: "{}" }],
  shopping_checks: [],
  ticket_photos: [],
});

const WEEKLY = [
  "date,weight_kg,sleep_h,waist_cm,intake_kcal,trained,cardio_type,cardio_min,mobility,quad,energy,notes,tipo_dia,fc_reposo,cardio_sesiones",
  `${day(9)},74.6,6.5,88,2200,false,,,,bien,3,"Viaje, poco sueño",descanso,56,`,
  `${day(8)},999,7,,,true,,,,,4,,gimnasio,,Trote:15`,
].join("\n");

const CHECKINS = ["date,weight_kg,waist_cm,intake_kcal,sleep_hours,notes", `${day(12)},75.0,88.5,2100.0,7.0,`].join("\n");
const REVIEW = "tdee_kcal: 2600\ntarget_kcal: 2300\nin_deficit: true\n\n- Semana inventada para la prueba.\n";

async function choose(page: Page) {
  await page.getByTestId("history-files").setInputFiles([
    { name: "parte-diario-copia.json", mimeType: "application/json", buffer: Buffer.from(BACKUP, "utf-8") },
    { name: "parte-diario_semana.csv", mimeType: "text/csv", buffer: Buffer.from(WEEKLY, "utf-8") },
    { name: "checkins.csv", mimeType: "text/csv", buffer: Buffer.from(CHECKINS, "utf-8") },
    { name: `${day(7)}.md`, mimeType: "text/markdown", buffer: Buffer.from(REVIEW, "utf-8") },
  ]);
}

test("importar el historial: revisar, conservar lo de FightLab, importar y reimportar sin duplicar", async ({ page }) => {
  await login(page, READY_USERS.history);
  await page.goto("/profile");
  await page.getByRole("link", { name: es.historyImport.profileLink }).click();
  await page.waitForURL("**/profile/import");

  await choose(page);
  await expect(page.getByTestId("history-chosen")).toHaveText("4 archivos elegidos");
  await page.getByRole("button", { name: es.historyImport.check }).click();

  const summary = page.getByTestId("history-summary");
  await expect(summary).toHaveAttribute("data-dry-run", "true");
  await expect(page.getByTestId("history-file")).toHaveCount(4);
  await expect(page.getByTestId("history-days-new")).toHaveText("5 días nuevos");
  await expect(page.getByTestId("history-days-conflict")).toHaveText("1 día en conflicto");
  await expect(page.getByTestId("history-reviews-new")).toHaveText("1 revisión del coach nueva");
  // El peso imposible se descarta con su motivo; los menús se dejan para la fase 12.
  await expect(page.locator('[data-testid="history-discarded"][data-field="weight_kg"]')).toContainText("peso: 1 valor fuera de rango");
  await expect(page.locator('[data-testid="history-notice"][data-code="menus_later"]')).toBeVisible();
  // Nada se ha guardado aún.
  const before = await (await page.request.get(`/api/proxy/coach/checkin?date=${day(6)}`)).json();
  expect(before.checkin).toBeNull();

  const conflict = page.getByTestId("history-conflict");
  await expect(conflict).toHaveAttribute("data-date", day(4));
  await expect(conflict).toContainText("sueño");
  await expect(page.getByTestId("history-mode-keep")).toBeChecked();
  await page.getByTestId("history-import").click();
  await expect(summary).toHaveAttribute("data-dry-run", "false");
  await expect(summary).toContainText(es.historyImport.done);

  // Lo importado está en el check-in, con el cuádriceps como molestia de piernas y una nota.
  const imported = await (await page.request.get(`/api/proxy/coach/checkin?date=${day(6)}`)).json();
  expect(imported.checkin.weight_kg).toBe(74.2);
  expect(imported.checkin.sleep_hours).toBe(7.5);
  expect(imported.checkin.soreness_zones).toEqual(["legs"]);
  expect(imported.checkin.notes).toBe("Inventado; Cuádriceps izquierdo: molestia leve");
  // Conservar: el sueño de FightLab se queda; la energía, que faltaba, se rellena.
  const kept = await (await page.request.get(`/api/proxy/coach/checkin?date=${day(4)}`)).json();
  expect(kept.checkin.sleep_hours).toBe(5);
  expect(kept.checkin.energy).toBe(4);
  const fromCoach = await (await page.request.get(`/api/proxy/coach/checkin?date=${day(12)}`)).json();
  expect(fromCoach.checkin.waist_cm).toBe(88.5);

  // La revisión del coach sale aparte en la pantalla de revisión.
  await page.goto("/training/review");
  await expect(page.getByTestId("imported-review")).toHaveCount(1);
  await expect(page.getByTestId("imported-review")).toContainText("TDEE: 2600 kcal");

  // Otra vez lo mismo: no hay nada nuevo y no se duplica el cardio.
  await page.goto("/profile/import");
  await choose(page);
  await page.getByRole("button", { name: es.historyImport.check }).click();
  await expect(page.getByTestId("history-days-conflict")).toHaveText("1 día en conflicto");
  await expect(page.getByTestId("history-days-unchanged")).toHaveText("5 días ya estaban igual");
  await expect(page.getByTestId("history-reviews-unchanged")).toHaveText("1 revisión ya estaba");
});

test("con SCOFF positivo no se importan peso, cintura ni kcal, y se explica", async ({ page }) => {
  await login(page, READY_USERS.historyScoff);
  await page.goto("/profile/import");
  await choose(page);
  await page.getByRole("button", { name: es.historyImport.check }).click();
  await expect(page.getByTestId("history-blocked")).toContainText("no guarda peso, cintura ni kcal");
  await page.getByTestId("history-import").click();
  await expect(page.getByTestId("history-summary")).toHaveAttribute("data-dry-run", "false");
  const row = await (await page.request.get(`/api/proxy/coach/checkin?date=${day(6)}`)).json();
  expect(row.weight_blocked).toBe(true);
  expect(row.checkin.weight_kg).toBeNull();
  expect(row.checkin.intake_kcal).toBeNull();
  expect(row.checkin.sleep_hours).toBe(7.5);
});
