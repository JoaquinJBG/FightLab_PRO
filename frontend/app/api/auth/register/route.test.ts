// @vitest-environment node
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

vi.mock("@/lib/api", () => ({ djangoFetch: vi.fn() }));

import { djangoFetch } from "@/lib/api";
import { POST } from "./route";

function req(opts: { origin?: string; contentType?: string } = {}) {
  const headers = new Headers();
  headers.set("origin", opts.origin ?? "https://app.example.com");
  headers.set("content-type", opts.contentType ?? "application/json");
  return new Request("https://app.example.com/api/auth/register", {
    method: "POST",
    headers,
    body: JSON.stringify({ email: "a@b.com", password: "secret123" }),
  });
}

describe("POST /api/auth/register", () => {
  beforeEach(() => {
    vi.mocked(djangoFetch).mockReset().mockResolvedValue({ status: 201, data: {} });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  test("responde 403 si el Origin no es el propio", async () => {
    const res = await POST(req({ origin: "https://evil.example" }));
    expect(res.status).toBe(403);
    expect(djangoFetch).not.toHaveBeenCalled();
  });

  test("responde 415 si el Content-Type no es application/json", async () => {
    const res = await POST(req({ contentType: "text/plain" }));
    expect(res.status).toBe(415);
    expect(djangoFetch).not.toHaveBeenCalled();
  });

  test("un cuerpo JSON inválido da 400, nunca 500", async () => {
    const headers = new Headers({ origin: "https://app.example.com", "content-type": "application/json" });
    const badReq = new Request("https://app.example.com/api/auth/register", {
      method: "POST",
      headers,
      body: "no-json",
    });
    const res = await POST(badReq);
    expect(res.status).toBe(400);
  });

  test("reenvía clientIpHeaders a Django", async () => {
    vi.stubEnv("BFF_SHARED_SECRET", "top-secret");
    const r = req();
    r.headers.set("x-forwarded-for", "203.0.113.9");

    await POST(r);

    expect(djangoFetch).toHaveBeenCalledWith(
      "/auth/register",
      expect.objectContaining({
        headers: { "X-Bff-Secret": "top-secret", "X-Bff-Client-Ip": "203.0.113.9" },
      }),
    );
  });
});
