import { describe, test, expect } from "vitest";
import { NextRequest } from "next/server";
import { proxy, config } from "../proxy";

describe("proxy: /ui exige sesión", () => {
  test("sin cookie de sesión, /ui redirige a /login", () => {
    const res = proxy(new NextRequest("http://localhost/ui"));
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toBe("http://localhost/login");
  });
  test("con sesión, /ui pasa", () => {
    const res = proxy(new NextRequest("http://localhost/ui", { headers: { cookie: "fl_refresh=x" } }));
    expect(res.headers.get("location")).toBeNull();
  });
  test("el matcher cubre /ui", () => {
    expect(config.matcher.some((m) => m.startsWith("/ui"))).toBe(true);
  });
});
