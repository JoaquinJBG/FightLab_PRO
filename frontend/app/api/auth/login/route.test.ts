// @vitest-environment node
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

vi.mock("@/lib/api", () => ({ djangoFetch: vi.fn() }));
vi.mock("@/lib/cookies", () => ({ setAuthCookies: vi.fn() }));

import { djangoFetch } from "@/lib/api";
import { setAuthCookies } from "@/lib/cookies";
import { POST } from "./route";

function req(opts: { origin?: string; contentType?: string; body?: unknown } = {}) {
  const headers = new Headers();
  headers.set("origin", opts.origin ?? "https://app.example.com");
  headers.set("content-type", opts.contentType ?? "application/json");
  return new Request("https://app.example.com/api/auth/login", {
    method: "POST",
    headers,
    body: JSON.stringify(opts.body ?? { email: "a@b.com", password: "secret123" }),
  });
}

describe("POST /api/auth/login", () => {
  beforeEach(() => {
    vi.mocked(djangoFetch).mockReset();
    vi.mocked(setAuthCookies).mockReset();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  test("responde 403 si el Origin no es el propio (bug: login aceptaba cualquier Origin)", async () => {
    const res = await POST(req({ origin: "https://evil.example" }));
    expect(res.status).toBe(403);
    expect(djangoFetch).not.toHaveBeenCalled();
  });

  test("responde 415 si el Content-Type no es application/json", async () => {
    const res = await POST(req({ contentType: "text/plain" }));
    expect(res.status).toBe(415);
    expect(djangoFetch).not.toHaveBeenCalled();
  });

  test("un cuerpo que no es JSON válido da 400, nunca 500", async () => {
    const headers = new Headers({ origin: "https://app.example.com", "content-type": "application/json" });
    const badReq = new Request("https://app.example.com/api/auth/login", {
      method: "POST",
      headers,
      body: "{esto no es json",
    });
    const res = await POST(badReq);
    expect(res.status).toBe(400);
    expect(djangoFetch).not.toHaveBeenCalled();
  });

  test("reenvía clientIpHeaders en vez de la IP cruda", async () => {
    vi.mocked(djangoFetch).mockResolvedValue({ status: 200, data: { access: "acc", refresh: "ref" } });
    vi.stubEnv("BFF_SHARED_SECRET", "top-secret");
    const r = req();
    r.headers.set("x-forwarded-for", "203.0.113.9");

    const res = await POST(r);

    expect(res.status).toBe(200);
    expect(djangoFetch).toHaveBeenCalledWith(
      "/auth/login",
      expect.objectContaining({
        headers: { "X-Bff-Secret": "top-secret", "X-Bff-Client-Ip": "203.0.113.9" },
      }),
    );
    expect(setAuthCookies).toHaveBeenCalledWith("acc", "ref");
  });

  test("sin BFF_SHARED_SECRET no manda cabeceras de IP (comportamiento actual)", async () => {
    vi.mocked(djangoFetch).mockResolvedValue({ status: 401, data: { detail: "no" } });
    vi.stubEnv("BFF_SHARED_SECRET", "");

    await POST(req());

    expect(djangoFetch).toHaveBeenCalledWith("/auth/login", expect.objectContaining({ headers: {} }));
  });
});
