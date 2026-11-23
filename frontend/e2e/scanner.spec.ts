import { expect, test, type Page } from "@playwright/test";
import { PASSWORD, READY_USERS } from "./users";

// Escáner de código de barras de punta a punta: BFF de Next + Django. El backend corre SIN
// `COACH_OFF_CONTACT`, así que Open Food Facts no se llama nunca. La cámara es un lienzo y
// `BarcodeDetector` es falso: "lee" el código que se inyecta. El producto de cadena (EAN
// 2000000000053) lo siembra global-setup.ts. Todo INVENTADO.

const CHAIN_EAN = "2000000000053";
const NEW_EAN = "8400000000048";

async function login(page: Page, email: string) {
  await page.goto("/login");
  await page.locator('input[type="email"]').fill(email);
  await page.locator('input[type="password"]').fill(PASSWORD);
  await page.locator('button[type="submit"]').click();
  await page.waitForURL("**/today");
}

async function fakeCamera(page: Page) {
  await page.addInitScript(() => {
    const w = window as unknown as { __scanCode: string; BarcodeDetector: unknown };
    w.__scanCode = "";
    navigator.mediaDevices.getUserMedia = async () => {
      const canvas = document.createElement("canvas");
      canvas.width = 320;
      canvas.height = 240;
      const ctx = canvas.getContext("2d");
      setInterval(() => { ctx?.fillRect(0, 0, 320, 240); }, 100);
      return canvas.captureStream(10);
    };
    w.BarcodeDetector = class {
      static async getSupportedFormats() { return ["ean_13", "ean_8", "upc_a", "upc_e"]; }
      async detect() { return w.__scanCode ? [{ rawValue: w.__scanCode, format: "ean_13" }] : []; }
    };
  });
}

async function scan(page: Page, code: string) {
  await page.getByTestId("scan-open").click();
  await expect(page.getByTestId("scanner-engine")).toBeVisible();
  await page.evaluate((c) => { (window as unknown as { __scanCode: string }).__scanCode = c; }, code);
  await expect(page.getByTestId("scanner")).toBeHidden();
}

test("escáner: catálogo de cadena por EAN, no encontrado → crear a mano, y otra vez encontrado", async ({ page }) => {
  await fakeCamera(page);
  await login(page, READY_USERS.scanner);

  // 1. El producto de la cadena, con la valoración del motor, por envases.
  await page.goto("/nutrition/add?meal=Comida");
  await scan(page, CHAIN_EAN);
  const result = page.getByTestId("scan-result");
  await expect(result).toHaveAttribute("data-source", "chain");
  await expect(page.getByTestId("scan-name")).toContainText("Pechuga escaneada inventada");
  await expect(page.getByTestId("scan-source")).toContainText("De tu catálogo de Mercadona · Bandeja 400 g");
  await expect(page.getByTestId("rating-badge")).toHaveAttribute("data-rating", "bueno");
  await page.getByTestId("scan-unit-pack").click();
  await expect(page.getByTestId("scan-grams")).toHaveText("400 g");
  await expect(page.getByTestId("scan-macros")).toHaveText("440 kcal · P 92 · C 0 · G 6");
  await page.getByTestId("scan-add").click();
  await page.waitForURL("**/nutrition");

  // 2. Un código que nadie tiene: OFF no está configurado; se crea a mano con ese código.
  await page.goto("/nutrition/add?meal=Cena");
  await page.getByTestId("scan-open").click();
  await page.getByTestId("scanner-manual").fill(NEW_EAN);
  await page.getByTestId("scanner-manual-go").click();
  await expect(page.getByTestId("scan-not-found")).toHaveAttribute("data-off", "off_not_configured");
  await page.getByTestId("scan-create").click();
  await page.getByTestId("manual-name").fill("Tortilla escaneada inventada");
  await page.getByTestId("manual-kcal").fill("190");
  await page.getByTestId("manual-protein_g").fill("7,5");
  await page.getByTestId("manual-carbs_g").fill("12");
  await page.getByTestId("manual-fat_g").fill("12,5");
  await page.getByTestId("manual-save").click();
  await expect(result).toHaveAttribute("data-source", "manual");
  await page.getByTestId("scan-amount").fill("150");
  await expect(page.getByTestId("scan-macros")).toHaveText("285 kcal · P 11 · C 18 · G 19");
  await page.getByTestId("scan-add").click();
  await page.waitForURL("**/nutrition");

  // 3. Otra sesión de la página: el código creado a mano ya se encuentra en el servidor.
  await page.goto("/nutrition/add");
  await scan(page, NEW_EAN);
  await expect(result).toHaveAttribute("data-source", "manual");
  await expect(page.getByTestId("scan-name")).toContainText("Tortilla escaneada inventada");

  // 4. Y en la búsqueda de productos del menú sale como «Creado por ti».
  await page.goto("/nutrition/menu");
  await expect(page.getByTestId("catalogue-product").filter({ hasText: "Tortilla escaneada inventada" })).toContainText("Creado por ti");
});
