import { expect, test, type Page } from "@playwright/test";
import es from "../messages/es.json";
import { PASSWORD, READY_USERS } from "./users";

// Fase 9 de punta a punta: BFF de Next + Django + importadores del coach. Los CSV son inventados.
// Importar un export de Hevy y uno genérico, reimportar sin duplicar, el error de un archivo mal
// formado, "Última vez" desde el servidor y el aviso al registrar una sesión vigorosa.

async function login(page: Page, email: string) {
  await page.goto("/login");
  await page.locator('input[type="email"]').fill(email);
  await page.locator('input[type="password"]').fill(PASSWORD);
  await page.locator('button[type="submit"]').click();
  await page.waitForURL("**/today");
}

const day = (back: number) => new Date(Date.now() - back * 86400_000).toISOString().slice(0, 10);
const HEVY_MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const hevyDate = (back: number, hour: string) => {
  const d = new Date(Date.now() - back * 86400_000);
  return `${d.getUTCDate()} ${HEVY_MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}, ${hour}`;
};

const HEVY = [
  "title,start_time,end_time,description,exercise_title,superset_id,exercise_notes,set_index,set_type,weight_kg,reps,distance_km,duration_seconds,rpe",
  `Push A,"${hevyDate(6, "18:00")}","${hevyDate(6, "19:10")}",,Bench Press (Barbell),,,0,warmup,40,10,,,`,
  `Push A,"${hevyDate(6, "18:00")}","${hevyDate(6, "19:10")}",,Bench Press (Barbell),,"Slow, paused",1,normal,80,6,,,8`,
  `Push A,"${hevyDate(6, "18:00")}","${hevyDate(6, "19:10")}",,Pull Up,,,0,normal,,9,,,`,
  `Push A,"${hevyDate(6, "18:00")}","${hevyDate(6, "19:10")}",,Pull Up,,,1,normal,,,,,`,
].join("\n");
// "Press banca" es el nombre del gimnasio de la app: su "Última vez" tiene que salir de aquí.
const GENERIC = ["date,exercise,weight_kg,reps,session", `${day(3)},Press banca,82.5,5,Torso`, `${day(3)},Press banca,82.5,5,Torso`, `${day(3)},Press banca,85,3,Torso`].join("\n");

async function choose(page: Page, name: string, content: string) {
  await page.getByTestId("import-file").setInputFiles({ name, mimeType: "text/csv", buffer: Buffer.from(content, "utf-8") });
}

test("importar Hevy: revisar, importar y reimportar sin duplicar", async ({ page }) => {
  await login(page, READY_USERS.gymImport);
  await page.goto("/training/gym");
  await page.getByRole("link", { name: es.training.gym.importLink }).click();
  await page.waitForURL("**/training/gym/import");

  await choose(page, "hevy.csv", HEVY);
  await page.getByRole("button", { name: es.gymImport.check }).click();
  const summary = page.getByTestId("import-summary");
  await expect(summary).toHaveAttribute("data-dry-run", "true");
  await expect(summary).toContainText(es.gymImport.preview);
  await expect(page.getByTestId("import-sets")).toHaveText("3 series nuevas");
  // La serie de "Pull Up" sin nada es un resto de plantilla: aviso, no se importa.
  await expect(page.locator('[data-testid="import-warning"][data-code="template_rows"]')).toContainText("1 fila vacía");

  await page.getByRole("button", { name: es.gymImport.import, exact: true }).click();
  await expect(summary).toHaveAttribute("data-dry-run", "false");
  await expect(summary).toContainText(es.gymImport.done);
  await expect(page.getByTestId("import-sets")).toHaveText("3 series nuevas");

  // El mismo archivo otra vez: nada nuevo y las 3 series cuentan como duplicadas.
  await page.getByRole("button", { name: es.gymImport.import, exact: true }).click();
  await expect(page.getByTestId("import-nothing-new")).toBeVisible();
  await expect(page.getByTestId("import-duplicates")).toHaveText("3 ya estaban y no se duplican");

  // Las series están en el servidor y el motor las lee.
  const e1rm = await (await page.request.get("/api/proxy/coach/strength/e1rm")).json();
  expect(e1rm.exercises.map((e: { exercise: string }) => e.exercise)).toContain("Bench Press (Barbell)");
});

test("un CSV mal formado se explica en el idioma de la app", async ({ page }) => {
  await login(page, READY_USERS.gymImport);
  await page.goto("/training/gym/import");
  await choose(page, "mal.csv", "date,exercise,weight_kg,reps\n2026-09-10,Press banca,12,5,8\n");
  await page.getByRole("button", { name: es.gymImport.check }).click();
  const error = page.getByTestId("import-error");
  await expect(error).toHaveAttribute("data-code", "decimal_comma");
  await expect(error).toContainText("La línea 2 tiene más campos que la cabecera");
});

test("el CSV genérico alimenta la «Última vez» del gimnasio desde el servidor", async ({ page }) => {
  await login(page, READY_USERS.gymImport);
  await page.goto("/training/gym/import");
  await page.getByRole("button", { name: es.gymImport.formats.generic_csv }).click();
  await choose(page, "torso.csv", GENERIC);
  await page.getByRole("button", { name: es.gymImport.import, exact: true }).click();
  await expect(page.getByTestId("import-sets")).toHaveText("3 series nuevas");

  // El navegador no tiene ninguna sesión de gimnasio: lo que se ve sale de `SetLog` (3 series, la
  // de más carga, 85 kg × 3).
  await page.evaluate(() => localStorage.removeItem("flp_gym_sessions"));
  await page.goto("/training/gym/session?focus=Empuje");
  await expect(page.getByText("Última vez: 3×3 · 85 kg · PR 85 kg")).toBeVisible();
  await expect(page.getByTestId("gym-e1rm")).toContainText(es.weeklyPlan.conventionCoach);
});

test("registrar sparring duro con review_before_vigorous avisa con el motivo y deja guardar", async ({ page }) => {
  await login(page, READY_USERS.vigorous);
  await page.goto("/training/mma");
  await page.getByRole("button", { name: es.training.mma.workTypes.sparring, exact: true }).click();
  // RPE 6 (por defecto): sparring ligero, sin aviso. Una más: duro.
  await expect(page.getByTestId("vigorous-warning")).toHaveCount(0);
  await page.getByRole("button", { name: "+" }).nth(1).click();
  const warning = page.getByTestId("vigorous-warning");
  await expect(warning).toBeVisible();
  await expect(warning).toContainText(es.sessionCheck.title);
  await expect(warning).toContainText(es.weeklyPlan.blockedBy.review_before_vigorous);
  await expect(warning.locator('[data-testid="vigorous-reason"][data-code="parq_review_vigorous"]')).toBeVisible();
  await expect(warning.getByTestId("evidence-chip").first()).toBeVisible();

  await page.getByRole("button", { name: es.training.mma.log.save }).click();
  await expect(page.getByRole("button", { name: es.training.mma.log.saved })).toBeVisible();
});

test("sin flags, el mismo sparring no avisa", async ({ page }) => {
  await login(page, READY_USERS.gymImport);
  await page.goto("/training/mma");
  await page.getByRole("button", { name: es.training.mma.workTypes.sparring, exact: true }).click();
  await page.getByRole("button", { name: "+" }).nth(1).click();
  const check = await (await page.request.get("/api/proxy/coach/session-check?kind=MMA&work_type=Sparring&art=Boxeo&rpe=7")).json();
  expect(check.modalities[0].key).toBe("sparring_hard");
  expect(check.warn).toBe(false);
  await expect(page.getByTestId("vigorous-warning")).toHaveCount(0);
});
