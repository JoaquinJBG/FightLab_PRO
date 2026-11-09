import { expect, test, type Page } from "@playwright/test";
import { PASSWORD, READY_USERS } from "./users";

// F17 H de punta a punta (BFF de Next + Django): importar de Hevy con rutinas por título,
// historial, calendario y detalle del servidor, empezar desde la rutina importada, guardar y
// editar, y récords y progreso. El CSV es inventado, con la cabecera real de Hevy.

async function login(page: Page, email: string) {
  await page.goto("/login");
  await page.locator('input[type="email"]').fill(email);
  await page.locator('input[type="password"]').fill(PASSWORD);
  await page.locator('button[type="submit"]').click();
  await page.waitForURL("**/today");
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const hevyDate = (back: number, hour: string) => {
  const d = new Date(Date.now() - back * 86400_000);
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}, ${hour}`;
};
const row = (back: number, rest: string) => `Torso H,"${hevyDate(back, "18:00")}","${hevyDate(back, "19:00")}",${rest}`;
const HEVY = [
  "title,start_time,end_time,description,exercise_title,superset_id,exercise_notes,set_index,set_type,weight_kg,reps,distance_km,duration_seconds,rpe",
  row(9, "Old,Bench Press (Barbell),,,0,normal,75,8,,,"),
  row(4, "Felt strong,Bench Press (Barbell),,Pause 1 s,0,warmup,40,10,,,"),
  row(4, "Felt strong,Bench Press (Barbell),,Pause 1 s,1,normal,80,6,,,8"),
  row(4, "Felt strong,Bench Press (Barbell),,Pause 1 s,2,dropset,60,10,,,"),
  row(4, "Felt strong,Lateral Raise (Dumbbell),0,,0,normal,10,15,,,"),
  row(4, "Felt strong,Zottman Wobble Curl,0,Mine,0,failure,12,12,,,"),
].join("\n");

test.use({ viewport: { width: 353, height: 681 } });

test("Hevy completo → rutina → entreno desde la rutina → historial, detalle y récords", async ({ page }) => {
  await login(page, READY_USERS.gymLog);

  // Importar: todas las series y una rutina por título
  await page.goto("/training/gym/import");
  await page.getByTestId("import-file").setInputFiles({ name: "workout_data.csv", mimeType: "text/csv", buffer: Buffer.from(HEVY, "utf-8") });
  await page.getByRole("button", { name: "Importar", exact: true }).click();
  await expect(page.getByTestId("import-sets")).toHaveText("6 series nuevas");
  await expect(page.getByTestId("import-routines")).toContainText("1 rutina nueva");
  // Reimportar no duplica
  await page.getByRole("button", { name: "Importar", exact: true }).click();
  await expect(page.getByTestId("import-routines")).toContainText("1 ya estaba");

  // Historial del servidor con el resumen; el detalle con notas y tipos
  await page.goto("/training/gym");
  const history = page.getByTestId("gym-history");
  await expect(history.getByRole("link")).toHaveCount(2);
  await history.getByRole("link").first().click();
  await page.waitForURL(/\/training\/gym\/history\/\d+$/);
  await expect(page.getByText("Felt strong")).toBeVisible();
  await expect(page.getByText("Pause 1 s")).toBeVisible();
  await expect(page.getByTestId("detail-sets")).toHaveText("5");

  // La rutina importada, y empezar desde ella
  await page.goto("/training/routines");
  const card = page.locator('[data-testid="routine-card"]', { hasText: "Torso H" });
  await expect(card).toBeVisible();
  await card.getByTestId("routine-start").click();
  await page.waitForURL(/\/training\/gym\/session\?routine=\d+/);
  await expect(page.getByRole("heading", { name: "Torso H" })).toBeVisible();
  await expect(page.getByLabel("Peso, serie 2").first()).toHaveValue("80");
  await page.getByLabel("Peso, serie 2").first().fill("82,5");
  await page.getByRole("button", { name: "Serie 2 hecha" }).first().click();
  await expect(page.getByTestId("record-toast")).toContainText("Nuevo récord");
  await page.getByRole("button", { name: "Saltar" }).click();
  await page.getByRole("button", { name: "Terminar entreno" }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Terminar igualmente" }).click();
  await expect(page.getByTestId("summary-sets")).toHaveText("1");
  await page.getByText(/Actualizar la rutina «Torso H»/).click();
  await page.getByRole("button", { name: "Guardar" }).click();
  await page.waitForURL(/\/training\/gym\?saved=1/);

  // Lo guardado está en el servidor: historial (3) y calendario de hoy
  await expect(page.getByTestId("gym-history").getByRole("link")).toHaveCount(3);
  await expect(page.getByTestId("training-calendar")).not.toContainText("Ningún día entrenado");

  // Editar el entreno de hoy y borrarlo
  await page.getByTestId("gym-history").getByRole("link").first().click();
  await page.getByRole("button", { name: "Editar" }).click();
  await page.getByLabel("Peso, serie 1").first().fill("85");
  await page.getByRole("button", { name: "Guardar" }).click();
  await expect(page.getByText("85 kg × 6")).toBeVisible();

  // Récords y progreso
  await page.goto("/training/gym/records");
  const bench = page.getByTestId("records-list").getByRole("link", { name: /Bench Press|Press banca/ }).first();
  await expect(bench).toContainText("Peso 85 kg");
  await bench.click();
  await expect(page.getByTestId("progress-chart")).toBeVisible();

  // La rutina se actualizó con lo hecho (82,5 kg)
  await page.goto("/training/routines");
  await page.locator('[data-testid="routine-card"]', { hasText: "Torso H" }).getByTestId("routine-edit").click();
  await page.waitForURL(/\/training\/routines\/\d+$/);
  await expect.poll(async () => (await page.locator("input").evaluateAll((els) => els.map((e) => (e as HTMLInputElement).value)))
    .some((v) => v === "82.5" || v === "82,5")).toBe(true);
});
