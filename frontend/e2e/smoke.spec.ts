import { test, expect } from "./fixtures";

test("login renders without horizontal scroll", async ({ page }) => {
  await page.goto("/login");
  await expect(page.locator("body")).toBeVisible();
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
});

test("authenticated shell loads with mocked API", async ({ page, session }) => {
  void session;
  await page.goto("/dashboard");
  await expect(page).toHaveURL(/\/dashboard/);
  await expect(page.getByText("Cargando…")).toBeHidden();
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
});
