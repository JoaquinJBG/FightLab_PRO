import { test as base, expect } from "@playwright/test";
import { loginAsTestUser } from "./fixtures";

// Perfil → «Qué entrenas»: apagar Gimnasio guarda al momento y el hub de Entreno deja de enseñarlo
// (solo navegación: la ruta sigue abierta por URL). El PATCH lo atiende el mock de fixtures.ts.

const test = base;
test.use({ viewport: { width: 375, height: 667 } });

test.beforeEach(async ({ page }) => {
  await loginAsTestUser(page);
});

test("apagar Gimnasio en Perfil lo quita del hub de Entreno; volver a encenderlo lo trae", async ({ page }) => {
  await page.goto("/training");
  for (const id of ["gym", "mma", "sports", "history", "week", "routines"]) await expect(page.getByTestId(`hub-${id}`)).toBeVisible();

  await page.goto("/profile");
  const gym = page.getByRole("switch", { name: "Gimnasio" });
  const combat = page.getByRole("switch", { name: /Entrenamiento de contacto/ });
  await expect(gym).toHaveAttribute("aria-checked", "true");
  await expect(combat).toHaveAttribute("aria-checked", "true");
  const patch = page.waitForRequest((r) => r.method() === "PATCH" && r.url().includes("/me/profile"));
  await gym.click();
  expect((await patch).postDataJSON()).toEqual({ show_gym: false });
  await expect(gym).toHaveAttribute("aria-checked", "false");

  // Pestaña Entreno desde la barra (navegación del cliente, el perfil sigue en caché)
  await page.getByTestId("tab-bar").getByRole("link", { name: "Entreno" }).click();
  await expect(page.getByTestId("hub-mma")).toBeVisible();
  await expect(page.getByTestId("hub-sports")).toBeVisible();
  for (const id of ["gym", "routines"]) await expect(page.getByTestId(`hub-${id}`)).toHaveCount(0);

  // La ruta sigue abierta por URL
  await page.goto("/training/gym");
  await expect(page).toHaveURL(/\/training\/gym$/);

  // Y se puede volver a encender
  await page.goto("/profile");
  await expect(page.getByRole("switch", { name: "Gimnasio" })).toHaveAttribute("aria-checked", "false");
  await page.getByRole("switch", { name: "Gimnasio" }).click();
  await expect(page.getByRole("switch", { name: "Gimnasio" })).toHaveAttribute("aria-checked", "true");
  await page.getByTestId("tab-bar").getByRole("link", { name: "Entreno" }).click();
  await expect(page.getByTestId("hub-gym")).toBeVisible();
});
