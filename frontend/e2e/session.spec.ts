import { test, expect } from "./fixtures";

test("un 401 del proxy lleva una sola vez a /login?reason=expired", async ({ page, session }) => {
  void session;
  let logoutCalls = 0;
  await page.route("**/api/proxy/**", (route) =>
    route.fulfill({ status: 401, contentType: "application/json", body: JSON.stringify({ detail: "expired" }) }),
  );
  await page.route("**/api/auth/logout", (route) => {
    logoutCalls++;
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      headers: { "set-cookie": "fl_refresh=; Max-Age=0; Path=/" },
      body: "{}",
    });
  });

  await page.goto("/dashboard");
  await expect(page).toHaveURL(/\/login\?reason=expired/);
  await expect(page.getByText("Sesión caducada")).toBeVisible();
  expect(logoutCalls).toBe(1);
});

test("con el perfil tardando 30 s, /training/gym/session se puede usar de inmediato", async ({ page, session }) => {
  void session;
  await page.route("**/api/proxy/me/profile", async (route) => {
    await new Promise((r) => setTimeout(r, 30_000));
    await route.abort();
  });
  await page.goto("/training/gym/session");
  await expect(page.getByText("Cargando…")).toBeHidden();
  await expect(page.locator("main")).toBeVisible();
  await expect(page.getByRole("button", { name: "Reintentar" })).toBeHidden();
});

test("fuera de /training, un perfil que falla muestra reintento (no 'Cargando…' eterno)", async ({ page, session }) => {
  void session;
  await page.route("**/api/proxy/me/profile", (route) => route.fulfill({ status: 500, body: "{}" }));
  await page.goto("/dashboard");
  await expect(page.getByRole("button", { name: "Reintentar" })).toBeVisible();
});
