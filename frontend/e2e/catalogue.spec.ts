import { expect, test, type Page } from "@playwright/test";
import { PASSWORD, READY_USERS } from "./users";

// Fase 13 de punta a punta: BFF de Next + Django. Importar el catálogo de cadena desde un CSV,
// revisar antes de guardar, ver la valoración de FightLab y la diferencia con la del archivo,
// juntar la tabla de la app (equivale_a), reimportar sin duplicar, buscar sustitutos y borrarlo.
// Todos los productos son INVENTADOS: nunca se usan los archivos reales del usuario.

async function login(page: Page, email: string) {
  await page.goto("/login");
  await page.locator('input[type="email"]').fill(email);
  await page.locator('input[type="password"]').fill(PASSWORD);
  await page.locator('button[type="submit"]').click();
  await page.waitForURL("**/today");
}

const HEADER =
  "mercadona_id,ean,nombre,marca,categoria,formato,precio_kilo,kcal,protein_g,carbs_g,fat_g,saturadas_g,sugars_g," +
  "salt_g,fibre_g,nutriscore,nova,bebida,azucar,saturadas,sal,grasa,valoracion,motivo,valores_coherentes,en_tabla_app,fuente";
const SCORED = "﻿" + [
  HEADER,
  "90001,2000000000011,Pechuga inventada de ave,Marca Prueba,Aves,Bandeja 500 g,8.00,110,23,0,1.5,0.4,0,0.2,0,A,1,,,,,,bueno,,sí,,",
  // El archivo dice bueno; con 25 g de azúcar, FightLab dice evitar.
  "90002,2000000000028,Galleta inventada,Marca Prueba,Galletas,Paquete 200 g,4.50,450,7,70,15,3,25,0.5,3,B,4,,,,,,bueno,,sí,,",
  "90003,,Cerveza inventada,Marca Prueba,Cerveza lata,Lata 33 cl,1.50,42,0.4,3,0,0,0,0,0,,,sí,,,,,no aplica,,sí,,",
  ",,Sin clave inventada,,,,,100,1,1,1,,,,,,,,,,,,bueno,,,,",
].join("\n");
const TABLE = [
  "name_es,nombre_mercadona,equivale_a,ean,mercadona_id,kcal,protein_g,carbs_g,fat_g,fibre_g,fuente,valoracion",
  'pechuga inventada,Pechuga inventada de ave,"pechuga de pollo, cruda",2000000000011,90001,,,,,,,',
].join("\n");

async function upload(page: Page, name: string, text: string) {
  await page.getByTestId("catalogue-file").setInputFiles({ name, mimeType: "text/csv", buffer: Buffer.from(text, "utf-8") });
  await page.getByTestId("catalogue-check").click();
  await expect(page.getByTestId("catalogue-summary")).toHaveAttribute("data-dry-run", "true");
}

test("catálogo de la cadena: revisar, importar, juntar, reimportar, sustitutos y borrar", async ({ page }) => {
  await login(page, READY_USERS.catalogue);
  await page.goto("/profile/import");
  await page.getByTestId("catalogue-import-link").click();
  await page.waitForURL("**/profile/import/catalogue");
  await expect(page.getByTestId("catalogue-empty")).toBeVisible();

  // Vista previa: no guarda nada.
  await upload(page, "catalogo-prueba.csv", SCORED);
  await expect(page.getByTestId("catalogue-new")).toHaveText("3 productos nuevos");
  await expect(page.getByTestId("catalogue-discarded")).toHaveText("1 fila sin id de la tienda ni EAN (líneas 5)");
  await expect(page.getByTestId("catalogue-difference")).toHaveText("Galleta inventada: el archivo dice Bueno, FightLab dice Evitar");
  await expect(page.getByTestId("catalogue-empty")).toBeVisible();

  await page.getByTestId("catalogue-import").click();
  await expect(page.getByTestId("catalogue-summary")).toHaveAttribute("data-dry-run", "false");
  await expect(page.getByTestId("catalogue-total")).toHaveText("3 productos de Mercadona");
  const cookie = page.getByTestId("catalogue-item").filter({ hasText: "Galleta inventada" });
  await expect(cookie.getByTestId("rating-badge")).toHaveAttribute("data-rating", "evitar");

  // La tabla de la app se junta con lo importado (el producto 90001 gana su equivalente).
  await upload(page, "tabla-app-prueba.csv", TABLE);
  await expect(page.getByTestId("catalogue-updated")).toHaveText("1 producto se actualiza");
  await page.getByTestId("catalogue-import").click();
  await expect(page.getByTestId("catalogue-item").filter({ hasText: "Pechuga inventada" }))
    .toContainText("Equivale a: pechuga de pollo, cruda");

  // Reimportar el mismo archivo no duplica nada.
  await upload(page, "catalogo-prueba.csv", SCORED);
  await expect(page.getByTestId("catalogue-new")).toHaveText("0 productos nuevos");
  await expect(page.getByTestId("catalogue-unchanged")).toHaveText("3 productos ya estaban igual");

  // Sustitutos con las mismas kcal, con el motor real.
  await page.getByTestId("substitutes-food").fill("pechuga de pollo, cruda");
  await page.getByTestId("substitutes-grams").fill("150");
  await page.getByRole("button", { name: "Buscar", exact: true }).click();
  await expect(page.getByTestId("substitutes-result")).toContainText("Para 150 g de pechuga de pollo, cruda (180 kcal)");
  await expect(page.getByTestId("substitute").first()).toBeVisible();

  // Borrar todo.
  await page.getByTestId("catalogue-delete").click();
  await page.getByTestId("catalogue-delete-yes").click();
  await expect(page.getByTestId("catalogue-empty")).toBeVisible();
});
