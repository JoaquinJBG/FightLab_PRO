// @vitest-environment node
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

vi.mock("@/lib/api", () => ({ djangoFetch: vi.fn() }));

import { djangoFetch } from "@/lib/api";
import { POST } from "./route";

function req(opts: { origin?: string; contentType?: string } = {}) {
  const headers = new Headers();
  headers.set("origin", opts.origin ?? "https://app.example.com");
  headers.set("content-type", opts.contentType ?? "application/json");
  return new Request("https://app.example.com/api/auth/verify-email", {
    method: "POST",
    headers,
    body: JSON.stringify({ token: "tok" }),
  });
}

describe("POST /api/auth/verify-email", () => {
  beforeEach(() => {
    vi.mocked(djangoFetch).mockReset().mockResolvedValue({ status: 200, data: { detail: "Email verified" } });
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

  test("reenvía clientIpHeaders a Django (antes era uno de los huecos citados en el bug)", async () => {
    vi.stubEnv("BFF_SHARED_SECRET", "top-secret");
    const r = req();
    r.headers.set("x-forwarded-for", "203.0.113.9");

    const res = await POST(r);

    expect(res.status).toBe(200);
    expect(djangoFetch).toHaveBeenCalledWith(
      "/auth/verify-email",
      expect.objectContaining({
        headers: { "X-Bff-Secret": "top-secret", "X-Bff-Client-Ip": "203.0.113.9" },
      }),
    );
  });
});
