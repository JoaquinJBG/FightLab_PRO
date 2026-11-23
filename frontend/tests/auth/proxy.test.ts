// @vitest-environment node
import { describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { readdirSync } from "node:fs";
import { join } from "node:path";
import { proxy, config } from "@/proxy";

const go = (path: string, cookie = false) =>
  proxy(new NextRequest(`http://localhost${path}`, cookie ? { headers: { cookie: "fl_refresh=x" } } : undefined));

describe("proxy: rutas protegidas", () => {
  it("/checkin sin sesión redirige a /login", () => {
    const res = go("/checkin");
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toContain("/login");
  });

  it("/checkin con sesión pasa", () => {
    expect(go("/checkin", true).headers.get("location")).toBeNull();
  });

  it("todas las carpetas del grupo (shell) están protegidas y en el matcher", () => {
    const dir = join(process.cwd(), "app", "(shell)");
    const routes = readdirSync(dir, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name);
    for (const r of routes) {
      expect(go(`/${r}`).headers.get("location"), `/${r}`).toContain("/login");
      expect(
        config.matcher.some((m) => m.startsWith(`/${r}`)),
        `matcher /${r}`,
      ).toBe(true);
    }
  });
});
