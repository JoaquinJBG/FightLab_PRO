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
  const profileResponse = page.waitForResponse((r) => r.url().includes("/api/proxy/me/profile"));
  await page.goto("/dashboard");
  const res = await profileResponse;
  expect(res.status()).toBe(200);
  expect(res.headers()["x-e2e-mock"]).toBe("1");
  await expect(page).toHaveURL(/\/dashboard/);
  await expect(page.getByText("Cargando…")).toBeHidden();
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
});
