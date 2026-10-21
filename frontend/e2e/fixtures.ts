import { test as base, expect, type Page } from "@playwright/test";

export const TEST_UID = "e2e-user";

const PROFILE = {
  date_of_birth: "1995-04-02",
  gender: "male",
  height_cm: 180,
  dominant_stance: "orthodox",
  preferred_units: "metric",
  timezone: "Europe/Madrid",
};

const ME = { id: 1, email: "e2e@example.test", role: "athlete", is_email_verified: true };

type Seed = Record<string, unknown>;

/** Sesión falsa: cookie `fl_refresh` (la exige proxy.ts), localStorage sembrado
    y /api/proxy/* mockeado. `extraState` se serializa a `flp_*`. */
export async function loginAsTestUser(page: Page, extraState: Seed = {}) {
  await page.context().addCookies([
    { name: "fl_refresh", value: "e2e", url: "http://localhost:3100" },
    { name: "fl_access", value: "e2e", url: "http://localhost:3100" },
  ]);

  await page.addInitScript(
    ([uid, state]) => {
      if (sessionStorage.getItem("__e2e_seeded")) return;
      sessionStorage.setItem("__e2e_seeded", "1");
      localStorage.setItem("flp_owner_uid", uid as string);
      for (const [k, v] of Object.entries(state as Seed)) {
        localStorage.setItem(k, typeof v === "string" ? v : JSON.stringify(v));
      }
    },
    [TEST_UID, extraState] as const,
  );

  await page.route("**/api/proxy/**", async (route) => {
    const { pathname } = new URL(route.request().url());
    const path = pathname.replace(/^\/api\/proxy\//, "");
    const json = (body: unknown, status = 200) =>
      route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });

    if (path.startsWith("health")) return json({ status: "ok" });
    if (path.startsWith("me/profile")) return json(PROFILE);
    if (path.startsWith("me/biometrics")) return json([]);
    if (path.startsWith("me/state")) return json({});
    if (path.startsWith("activities")) return json([]);
    if (path.startsWith("me")) return json(ME);
    return json({ detail: "not mocked in e2e" }, 404);
  });
}

export const test = base.extend<{ session: void }>({
  session: [
    async ({ page }, use) => {
      await loginAsTestUser(page);
      await use();
    },
    { auto: false },
  ],
});

export { expect };
