import { test, expect } from "./fixtures";

test("/ui sin sesión redirige a /login", async ({ page }) => {
  await page.goto("/ui");
  await expect(page).toHaveURL(/\/login/);
});

test("el viewport no bloquea el zoom", async ({ page }) => {
  await page.goto("/login");
  const content = await page.locator('meta[name="viewport"]').getAttribute("content");
  expect(content).not.toMatch(/maximum-scale|user-scalable/);
});

test("nutrición sin peso pide el peso en vez de mostrar objetivos", async ({ page, session }) => {
  void session;
  await page.goto("/nutrition");
  await expect(page.getByText("Pon tu peso para calcular")).toBeVisible();
  await expect(page.getByText(/\/ \d+ kcal/)).toHaveCount(0);
});

// Mi rutina vuelve con el plan semanal real del coach: ya no hay rutina de ejemplo ni coach inventado.
test("Mi rutina no enseña una rutina de ejemplo", async ({ page, session }) => {
  void session;
  await page.goto("/training");
  await expect(page.getByText("Gimnasio")).toBeVisible();
  await expect(page.getByText("Tu plan activo de la semana")).toBeVisible();
  await page.goto("/training/my-routine");
  await expect(page.getByText("Carlos Méndez")).toHaveCount(0);
  await expect(page.getByTestId("routine-plan-cta")).toBeVisible();
});
