import { test, expect } from "./fixtures";

// Fase 10 con la API mockeada: Perfil → Importar historial se revisa, enseña el conflicto y se
// importa sin scroll horizontal en los tres anchos de móvil. Datos inventados.

const preview = {
  dry_run: true,
  on_conflict: "keep",
  files: [{ name: "parte-diario-copia.json", kind: "parte_diario_json", days: 3, reviews: 0, error: null }],
  days: { total: 3, new: 2, filled: 0, conflict: 1, unchanged: 0, written: 2 },
  conflicts: [{ date: "2026-10-20", fields: ["weight_kg", "sleep_hours"] }],
  range: { first: "2026-10-19", last: "2026-10-21" },
  items: { checkins: 2, weights: 2, waists: 0, resting_hr: 0, meals: 4, cardio: 1, day_logs: 2, heart: 0 },
  reviews: { total: 0, new: 0, conflict: 0, unchanged: 0, kept_app: 0, written: 0 },
  sets: [],
  discarded: [{ code: "out_of_range", field: "weight_kg", count: 1, examples: ["2026-10-21"] }],
  weight_blocked: { active: false, count: 0, fields: [] },
  notices: [{ code: "menus_later", count: 1 }],
};

test("importar el historial: revisar, elegir qué hacer con el conflicto e importar", async ({ page, session }) => {
  void session;
  const calls: { dryRun: boolean; mode: string }[] = [];
  await page.route("**/api/proxy/coach/import/history", async (route) => {
    const body = route.request().postData() ?? "";
    const dryRun = body.includes('name="dry_run"');
    const mode = /name="on_conflict"\r\n\r\n(\w+)/.exec(body)?.[1] ?? "";
    calls.push({ dryRun, mode });
    const result = dryRun ? preview : { ...preview, dry_run: false, on_conflict: mode, days: { ...preview.days, written: 3 } };
    await route.fulfill({ status: dryRun ? 200 : 201, contentType: "application/json", body: JSON.stringify(result) });
  });

  await page.goto("/profile");
  await page.getByTestId("history-import-link").click();
  await page.waitForURL("**/profile/import");
  await page.getByTestId("history-files").setInputFiles({
    name: "parte-diario-copia.json",
    mimeType: "application/json",
    buffer: Buffer.from('{"kind":"parte-diario-copia","format":1,"days":[]}', "utf-8"),
  });
  await page.getByRole("button", { name: "Revisar archivos" }).click();

  await expect(page.getByTestId("history-summary")).toHaveAttribute("data-dry-run", "true");
  await expect(page.getByTestId("history-days-new")).toHaveText("2 días nuevos");
  await expect(page.getByTestId("history-conflict")).toContainText("peso, sueño");
  await expect(page.getByTestId("history-discarded")).toContainText("peso: 1 valor fuera de rango");

  await page.getByTestId("history-mode-replace").check();
  await page.getByTestId("history-import").click();
  await expect(page.getByTestId("history-summary")).toHaveAttribute("data-dry-run", "false");
  await expect(page.getByTestId("history-written")).toHaveText("3 días guardados");
  expect(calls).toEqual([{ dryRun: true, mode: "keep" }, { dryRun: false, mode: "replace" }]);

  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
});
