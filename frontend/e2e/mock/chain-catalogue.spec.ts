import { test, expect } from "./fixtures";

// Fase 13 con la API mockeada: Perfil → Importar → Catálogo de la cadena se revisa, se importa, se
// lista y se borra sin scroll horizontal en los tres anchos de móvil. Productos INVENTADOS.

const RULE = "food-products/rate-packaged-products-with-nutri-score-and-uk-traffic-lights";
const preview = {
  dry_run: true, format: "scored", chain: "Mercadona", rows: 4, new: 3, updated: 0, unchanged: 0, discarded_total: 1,
  discarded: [{ code: "no_key", field: "", count: 1, lines: [5] }],
  ratings: { bueno: 1, regular: 0, evitar: 1, "sin datos": 0, "no aplica": 1 },
  review: 0,
  differences: { count: 1, examples: [{ line: 3, name: "Galleta inventada", file: "bueno", engine: "evitar" }] },
  notices: [],
  rule_key: RULE,
  rule_grades: { [RULE]: "moderate" },
};
const item = {
  id: 1, chain: "Mercadona", chain_ref: "90001", ean: null, name: "Pechuga inventada de ave", brand: "Marca Prueba",
  category: "Aves", pack: "Bandeja 500 g", price_per_kg: 8, equivalent_of: "pechuga de pollo, cruda", per: "100 g",
  kcal: 110, protein_g: 23, carbs_g: 0, fat_g: 1.5, nutriscore: "A", rating: "bueno", check: "ok", reasons: [],
  file_rating: "bueno", rule_key: RULE,
};
const listing = (products: unknown[]) => ({
  total: products.length, chains: products.length ? ["Mercadona"] : [], ratings: products.length ? { bueno: 1 } : {},
  review: 0, matched: products.length, products,
  thresholds: [
    { key: "food.sugars.high", value: 22.5, unit: "g/100 g", source: "fsa_2016" },
    { key: "food.saturates.high", value: 5, unit: "g/100 g", source: "fsa_2016" },
    { key: "food.salt.high", value: 1.5, unit: "g/100 g", source: "fsa_2016" },
  ],
  rule_key: RULE, energy_rule_key: "food-products/flag-labels-whose-energy-does-not-match-the-macros", rule_grades: {},
});

test("catálogo de la cadena: revisar, importar, listar y borrar", async ({ page, session }) => {
  void session;
  let saved: unknown[] = [];
  const calls: { dryRun: boolean; chain: string }[] = [];
  await page.route("**/api/proxy/coach/chain-products/import", async (route) => {
    const body = route.request().postData() ?? "";
    const dryRun = body.includes('name="dry_run"');
    const chain = /name="chain"\r\n\r\n([^\r]+)/.exec(body)?.[1] ?? "";
    calls.push({ dryRun, chain });
    if (!dryRun) saved = [item];
    const result = dryRun ? preview : { ...preview, dry_run: false };
    await route.fulfill({ status: dryRun ? 200 : 201, contentType: "application/json", body: JSON.stringify(result) });
  });
  await page.route("**/api/proxy/coach/chain-products?*", async (route) => {
    if (route.request().method() === "DELETE") {
      const deleted = saved.length;
      saved = [];
      await route.fulfill({ contentType: "application/json", body: JSON.stringify({ deleted }) });
      return;
    }
    await route.fulfill({ contentType: "application/json", body: JSON.stringify(listing(saved)) });
  });
  await page.route("**/api/proxy/coach/chain-products", async (route) => {
    const deleted = saved.length;
    saved = [];
    await route.fulfill({ contentType: "application/json", body: JSON.stringify({ deleted }) });
  });

  await page.goto("/profile");
  await page.getByTestId("history-import-link").click();
  await page.waitForURL("**/profile/import");
  await page.getByTestId("catalogue-import-link").click();
  await page.waitForURL("**/profile/import/catalogue");
  await expect(page.getByTestId("catalogue-empty")).toBeVisible();

  await page.getByTestId("catalogue-file").setInputFiles({
    name: "catalogo-prueba.csv",
    mimeType: "text/csv",
    buffer: Buffer.from("mercadona_id,nombre,kcal,valoracion\n90001,Pechuga inventada de ave,110,bueno\n", "utf-8"),
  });
  await page.getByTestId("catalogue-check").click();
  await expect(page.getByTestId("catalogue-summary")).toHaveAttribute("data-dry-run", "true");
  await expect(page.getByTestId("catalogue-new")).toHaveText("3 productos nuevos");
  await expect(page.getByTestId("catalogue-discarded")).toContainText("1 fila sin id de la tienda ni EAN");
  await expect(page.getByTestId("catalogue-difference")).toHaveText("Galleta inventada: el archivo dice Bueno, FightLab dice Evitar");

  await page.getByTestId("catalogue-import").click();
  await expect(page.getByTestId("catalogue-summary")).toHaveAttribute("data-dry-run", "false");
  await expect(page.getByTestId("catalogue-item")).toHaveCount(1);
  await expect(page.getByTestId("catalogue-item")).toContainText("Equivale a: pechuga de pollo, cruda");
  await expect(page.getByTestId("rating-badge").first()).toHaveAttribute("data-rating", "bueno");
  expect(calls).toEqual([{ dryRun: true, chain: "Mercadona" }, { dryRun: false, chain: "Mercadona" }]);

  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);

  await page.getByTestId("catalogue-delete").click();
  await page.getByTestId("catalogue-delete-yes").click();
  await expect(page.getByTestId("catalogue-empty")).toBeVisible();
});
