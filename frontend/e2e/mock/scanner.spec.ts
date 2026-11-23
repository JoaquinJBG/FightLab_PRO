import { test, expect } from "./fixtures";
import type { Page } from "@playwright/test";

// Escáner de código de barras con /api/proxy mockeado (sin Open Food Facts de verdad). La cámara
// es un lienzo (`canvas.captureStream`) y `BarcodeDetector` es falso: "lee" el código que se
// inyecta en `window.__scanCode`. Productos y códigos INVENTADOS.

const OFF_EAN = "8400000000017";
const NEW_EAN = "8400000000024";
const RULE = "food-products/rate-packaged-products-with-nutri-score-and-uk-traffic-lights";
const OFF_FOUND = {
  source: "off",
  attribution: { source: "Open Food Facts (unverified)", licence: "ODbL", url: "https://world.openfoodfacts.org/" },
  product: {
    barcode: OFF_EAN, name: "Yogur inventado", brand: "Marca Prueba", chain: null, pack: null, pack_g: null,
    serving_g: 125, per: "100 g", kcal: 60, protein_g: 4, carbs_g: 5, fat_g: 2.4, fibre_g: 0, missing: [],
    url: `https://world.openfoodfacts.org/product/${OFF_EAN}`, unverified: true,
    rating: { rating: "bueno", check: "ok", nutriscore: "A", rule_key: RULE },
  },
};

/** Cámara de mentira y lector de mentira con el código de `window.__scanCode`. */
async function fakeCamera(page: Page, { torch = true } = {}) {
  await page.addInitScript((hasTorch) => {
    const w = window as unknown as { __scanCode: string; __torch: boolean[]; BarcodeDetector: unknown };
    w.__scanCode = "";
    w.__torch = [];
    navigator.mediaDevices.getUserMedia = async () => {
      const canvas = document.createElement("canvas");
      canvas.width = 320;
      canvas.height = 240;
      const ctx = canvas.getContext("2d");
      setInterval(() => { ctx?.fillRect(0, 0, 320, 240); }, 100);
      const stream = canvas.captureStream(10);
      const track = stream.getVideoTracks()[0];
      track.getCapabilities = () => ({ torch: hasTorch }) as MediaTrackCapabilities;
      track.applyConstraints = async (c?: MediaTrackConstraints) => {
        const set = (c?.advanced?.[0] ?? {}) as { torch?: boolean };
        w.__torch.push(!!set.torch);
      };
      return stream;
    };
    w.BarcodeDetector = class {
      static async getSupportedFormats() { return ["ean_13", "ean_8", "upc_a", "upc_e"]; }
      async detect() { return w.__scanCode ? [{ rawValue: w.__scanCode, format: "ean_13" }] : []; }
    };
  }, torch);
}

const inject = (page: Page, code: string) => page.evaluate((c) => { (window as unknown as { __scanCode: string }).__scanCode = c; }, code);

test("Nutrición: escanear, raciones, añadir; el mismo código no se pregunta dos veces", async ({ page, session }) => {
  void session;
  await fakeCamera(page);
  const lookups: string[] = [];
  await page.route("**/api/proxy/coach/barcode/*", async (route) => {
    lookups.push(new URL(route.request().url()).pathname);
    await route.fulfill({ contentType: "application/json", body: JSON.stringify(OFF_FOUND) });
  });
  await page.goto("/nutrition/add?meal=Comida");
  await page.getByTestId("scan-open").click();
  await expect(page.getByTestId("scanner")).toBeVisible();
  await expect(page.getByTestId("scanner-engine")).toHaveAttribute("data-engine", "native");
  await page.getByTestId("scanner-torch").click();
  expect(await page.evaluate(() => (window as unknown as { __torch: boolean[] }).__torch)).toEqual([true]);
  await inject(page, OFF_EAN);
  await expect(page.getByTestId("scanner")).toBeHidden();
  const result = page.getByTestId("scan-result");
  await expect(result).toHaveAttribute("data-state", "found");
  await expect(page.getByTestId("scan-name")).toContainText("Yogur inventado");
  await expect(page.getByTestId("rating-badge")).toHaveAttribute("data-rating", "bueno");
  await expect(page.getByTestId("scan-unit-serving")).toHaveAttribute("aria-pressed", "true");
  await page.getByTestId("scan-amount").fill("2");
  await expect(page.getByTestId("scan-grams")).toHaveText("250 g");
  await expect(page.getByTestId("scan-macros")).toHaveText("150 kcal · P 10 · C 13 · G 6");

  // Otra vez el mismo código: sale de la caché, sin otra llamada.
  await page.getByTestId("scan-again").click();
  await inject(page, OFF_EAN);
  await expect(result).toHaveAttribute("data-state", "found");
  expect(lookups).toEqual([`/api/proxy/coach/barcode/${OFF_EAN}`]);
  await page.getByTestId("scan-amount").fill("2");

  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);

  await page.getByTestId("scan-add").click();
  await page.waitForURL("**/nutrition");
  const items = await page.evaluate(() => {
    const key = Object.keys(localStorage).find((k) => k.startsWith("flp_nutri_"));
    return key ? JSON.parse(localStorage.getItem(key) ?? "[]") : [];
  });
  expect(items[0]).toMatchObject({ meal: "Comida", name: "Yogur inventado", grams: 250, kcal: 150 });
});

test("Nutrición: código a mano que nadie tiene → crear el alimento → añadir", async ({ page, session }) => {
  void session;
  await fakeCamera(page, { torch: false });
  let created = false;
  await page.route(`**/api/proxy/coach/barcode/${NEW_EAN}`, async (route) => {
    if (route.request().method() === "POST") {
      const body = route.request().postDataJSON();
      created = true;
      await route.fulfill({
        status: 201, contentType: "application/json",
        body: JSON.stringify({ source: "manual", warnings: [], product: {
          ...OFF_FOUND.product, barcode: NEW_EAN, name: body.name, brand: null, serving_g: null, url: null,
          unverified: false, kcal: body.kcal, protein_g: body.protein_g, carbs_g: body.carbs_g, fat_g: body.fat_g,
          rating: { rating: "sin datos", check: "", nutriscore: null, rule_key: RULE },
        } }),
      });
      return;
    }
    await route.fulfill({ status: 404, contentType: "application/json", body: JSON.stringify({ code: "not_found", barcode: NEW_EAN, off: null }) });
  });
  await page.goto("/nutrition/add?meal=Cena");
  await page.getByTestId("scan-open").click();
  await expect(page.getByTestId("scanner-torch")).toHaveCount(0);
  await page.getByTestId("scanner-manual").fill(NEW_EAN);
  await page.getByTestId("scanner-manual-go").click();
  await expect(page.getByTestId("scan-not-found")).toHaveAttribute("data-off", "none");
  await page.getByTestId("scan-create").click();
  await page.getByTestId("manual-name").fill("Empanada casera inventada");
  await page.getByTestId("manual-kcal").fill("280");
  await page.getByTestId("manual-protein_g").fill("9,5");
  await page.getByTestId("manual-carbs_g").fill("30");
  await page.getByTestId("manual-fat_g").fill("14");
  await page.getByTestId("manual-save").click();
  await expect(page.getByTestId("scan-result")).toHaveAttribute("data-source", "manual");
  expect(created).toBe(true);
  await page.getByTestId("scan-add").click();
  await page.waitForURL("**/nutrition");
});

test("permiso de cámara denegado: mensaje claro", async ({ page, session }) => {
  void session;
  await page.addInitScript(() => {
    navigator.mediaDevices.getUserMedia = async () => {
      throw new DOMException("denied", "NotAllowedError");
    };
  });
  await page.goto("/nutrition/add");
  await page.getByTestId("scan-open").click();
  await expect(page.getByTestId("scanner-error")).toHaveAttribute("data-kind", "denied");
  await expect(page.getByTestId("scanner-manual")).toBeVisible();
  await page.getByTestId("scanner-close").click();
  await expect(page.getByTestId("scanner")).toBeHidden();
});

test.describe("móvil del usuario (353×681)", () => {
  test.use({ viewport: { width: 353, height: 681 } });

  test("escáner, alimento a mano y menú caben sin scroll horizontal", async ({ page, session }, info) => {
    test.skip(info.project.name !== "mobile-360", "una vez basta");
    void session;
    await fakeCamera(page);
    await page.route("**/api/proxy/coach/barcode/*", (route) =>
      route.fulfill({ status: 404, contentType: "application/json", body: JSON.stringify({ code: "not_found", barcode: NEW_EAN, off: "off_not_configured" }) }));
    const noOverflow = async () => {
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(overflow).toBeLessThanOrEqual(0);
    };
    await page.goto("/nutrition/add");
    await page.getByTestId("scan-open").click();
    await expect(page.getByTestId("scanner-torch")).toBeVisible();
    await page.screenshot({ path: info.outputPath("1-escaner.png") });
    await noOverflow();
    await page.getByTestId("scanner-manual").fill(NEW_EAN);
    await page.getByTestId("scanner-manual-go").click();
    await page.getByTestId("scan-create").click();
    await expect(page.getByTestId("manual-form")).toBeVisible();
    await page.screenshot({ path: info.outputPath("2-a-mano.png"), fullPage: true });
    await noOverflow();
  });
});
