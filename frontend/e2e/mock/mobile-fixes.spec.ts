import { test, expect } from "./fixtures";

// Arreglos de la prueba en el móvil real del 9 de noviembre (sesión B): el mismo ancho que el
// Honor plegado (353×681 CSS).
test.use({ viewport: { width: 353, height: 681 } });

test("F4: el chat del coach ocupa la pantalla y con el teclado se ve la última respuesta", async ({ page, session }) => {
  void session;
  await page.goto("/coach");
  const chat = page.getByTestId("coach-chat");
  const log = page.getByTestId("coach-chat-log");
  await expect(chat).toBeVisible();
  // Ya no es una caja de 137 px: en la página la conversación tiene sitio para varias burbujas
  expect((await log.boundingBox())!.height).toBeGreaterThan(200);

  await page.getByPlaceholder("Pregunta a tu coach…").tap();
  await expect(chat).toHaveAttribute("data-expanded", "true");
  const full = (await chat.boundingBox())!;
  expect(full.y).toBeLessThanOrEqual(1);
  expect(full.height).toBeGreaterThan(660);
  // Con el foco en el campo la barra de navegación no sube encima del teclado
  await expect(page.getByTestId("tab-bar")).toBeHidden();

  // Teclado abierto: la zona visible baja a 330 px (como en el móvil)
  await page.setViewportSize({ width: 353, height: 330 });
  await page.getByPlaceholder("Pregunta a tu coach…").fill("¿Cómo voy?");
  await page.getByRole("button", { name: "Enviar" }).click();
  const reply = log.locator("> div").last();
  await expect(reply).not.toContainText("El coach está escribiendo");
  await expect(reply).toBeInViewport({ ratio: 0.3 });
  const small = (await chat.boundingBox())!;
  expect(small.y + small.height).toBeLessThanOrEqual(331);
  await expect(page.getByPlaceholder("Pregunta a tu coach…")).toBeInViewport();

  // Se cierra y vuelve la página con su barra
  await page.setViewportSize({ width: 353, height: 681 });
  await page.getByRole("button", { name: "Cerrar chat" }).click();
  await expect(chat).toHaveAttribute("data-expanded", "false");
  await expect(page.getByTestId("tab-bar")).toBeVisible();
});
