import { afterEach, describe, expect, test, vi } from "vitest";
import { clientIpHeaders } from "./auth-forward";

function req(headers: Record<string, string> = {}) {
  return new Request("https://app.example.com/api/auth/login", { headers });
}

describe("clientIpHeaders", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  test("sin BFF_SHARED_SECRET, no manda ninguna cabecera (comportamiento actual)", () => {
    vi.stubEnv("BFF_SHARED_SECRET", "");
    expect(clientIpHeaders(req({ "x-real-ip": "203.0.113.9" }))).toEqual({});
  });

  test("con BFF_SHARED_SECRET, manda el secreto y x-real-ip", () => {
    vi.stubEnv("BFF_SHARED_SECRET", "top-secret");
    const headers = clientIpHeaders(req({ "x-real-ip": "203.0.113.9" }));
    expect(headers).toEqual({
      "X-Bff-Secret": "top-secret",
      "X-Bff-Client-Ip": "203.0.113.9",
    });
  });

  test("sin x-real-ip, cae a x-vercel-forwarded-for", () => {
    vi.stubEnv("BFF_SHARED_SECRET", "top-secret");
    const headers = clientIpHeaders(req({ "x-vercel-forwarded-for": "198.51.100.2" }));
    expect(headers["X-Bff-Client-Ip"]).toBe("198.51.100.2");
  });

  test("ignora x-forwarded-for aunque venga falsificado: manda x-real-ip", () => {
    vi.stubEnv("BFF_SHARED_SECRET", "top-secret");
    const headers = clientIpHeaders(
      req({ "x-forwarded-for": "6.6.6.6, 203.0.113.9", "x-real-ip": "203.0.113.9" }),
    );
    expect(headers["X-Bff-Client-Ip"]).toBe("203.0.113.9");
  });

  test("solo con x-forwarded-for no manda nada", () => {
    vi.stubEnv("BFF_SHARED_SECRET", "top-secret");
    expect(clientIpHeaders(req({ "x-forwarded-for": "6.6.6.6" }))).toEqual({});
  });

  test("con secreto pero sin ninguna IP disponible, no manda nada (nada que firmar)", () => {
    vi.stubEnv("BFF_SHARED_SECRET", "top-secret");
    expect(clientIpHeaders(req())).toEqual({});
  });
});
