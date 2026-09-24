// @vitest-environment node
//
// Tests a nivel de ruta del proxy genérico del BFF.
import { describe, test, expect, vi, beforeEach } from "vitest";

const cookieStore = new Map<string, string>();

vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => (cookieStore.has(name) ? { value: cookieStore.get(name)! } : undefined),
    set: (name: string, value: string) => {
      cookieStore.set(name, value);
    },
    delete: (name: string) => {
      cookieStore.delete(name);
    },
  }),
}));

const djangoRequest = vi.fn();
const djangoFetch = vi.fn();
vi.mock("@/lib/api", () => ({ djangoRequest, djangoFetch }));

const { POST } = await import("./route");

function ctx(path: string[]) {
  return { params: Promise.resolve({ path }) };
}

beforeEach(() => {
  cookieStore.clear();
  djangoRequest.mockReset();
  djangoFetch.mockReset();
});

describe("POST /api/proxy/[...path] — validación de ruta", () => {
  test("una ruta con traversal disfrazado ('..' + TAB) se rechaza con 404, sin llegar a llamar a Django", async () => {
    const req = new Request("https://app.example.com/api/proxy/me/x", {
      method: "POST",
      headers: { "content-type": "application/json", origin: "https://app.example.com" },
      body: "{}",
    });
    const res = await POST(req, ctx(["me", "..\t", "auth", "login"]));

    expect(res.status).toBe(404);
    expect(djangoRequest).not.toHaveBeenCalled();
  });
});
