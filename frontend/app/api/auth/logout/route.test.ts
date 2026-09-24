// @vitest-environment node
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

vi.mock("@/lib/api", () => ({ djangoFetch: vi.fn() }));
vi.mock("@/lib/cookies", () => ({
  getAccess: vi.fn(),
  getRefresh: vi.fn(),
  clearAuthCookies: vi.fn(),
}));

import { djangoFetch } from "@/lib/api";
import { getAccess, getRefresh, clearAuthCookies } from "@/lib/cookies";
import { POST } from "./route";

function req(opts: { origin?: string } = {}) {
  const headers = new Headers();
  headers.set("origin", opts.origin ?? "https://app.example.com");
  return new Request("https://app.example.com/api/auth/logout", { method: "POST", headers });
}

describe("POST /api/auth/logout", () => {
  beforeEach(() => {
    vi.mocked(djangoFetch).mockReset().mockResolvedValue({ status: 200, data: {} });
    vi.mocked(getAccess).mockReset().mockResolvedValue("access-tok");
    vi.mocked(getRefresh).mockReset().mockResolvedValue("refresh-tok");
    vi.mocked(clearAuthCookies).mockReset();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  test("responde 403 si el Origin no es el propio, sin llamar a Django ni limpiar cookies (bug: logout CSRF)", async () => {
    const res = await POST(req({ origin: "https://evil.example" }));
    expect(res.status).toBe(403);
    expect(djangoFetch).not.toHaveBeenCalled();
    expect(clearAuthCookies).not.toHaveBeenCalled();
  });

  test("permite un Content-Type distinto de JSON, porque logout no espera body", async () => {
    const r = req();
    r.headers.set("content-type", "text/plain");
    const res = await POST(r);
    expect(res.status).toBe(200);
    expect(clearAuthCookies).toHaveBeenCalled();
  });

  test("reenvía clientIpHeaders también en el logout (antes era uno de los huecos del bug)", async () => {
    vi.stubEnv("BFF_SHARED_SECRET", "top-secret");
    const r = req();
    r.headers.set("x-forwarded-for", "203.0.113.9");

    await POST(r);

    expect(djangoFetch).toHaveBeenCalledWith(
      "/auth/logout",
      expect.objectContaining({
        headers: { "X-Bff-Secret": "top-secret", "X-Bff-Client-Ip": "203.0.113.9" },
      }),
    );
  });

  test("sin refresh token no llama a Django, pero igualmente limpia cookies y responde ok", async () => {
    vi.mocked(getRefresh).mockResolvedValue(null);
    const res = await POST(req());
    expect(res.status).toBe(200);
    expect(djangoFetch).not.toHaveBeenCalled();
    expect(clearAuthCookies).toHaveBeenCalled();
  });
});
