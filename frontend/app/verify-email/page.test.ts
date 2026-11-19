import { describe, expect, test } from "vitest";
import { resolveVerifyRedirect } from "./page";

describe("resolveVerifyRedirect (needs_password tras un doble registro sin verificar)", () => {
  test("no redirige cuando la verificación es normal", () => {
    expect(resolveVerifyRedirect({ detail: "Email verified" })).toBeNull();
  });

  test("no redirige si needs_password falta uid o token", () => {
    expect(resolveVerifyRedirect({ needs_password: true, uid: "u1" })).toBeNull();
    expect(resolveVerifyRedirect({ needs_password: true, token: "t1" })).toBeNull();
    expect(resolveVerifyRedirect({ uid: "u1", token: "t1" })).toBeNull();
  });

  test("redirige a /reset-password con uid, token y mode=create cuando needs_password viene completo", () => {
    const redirect = resolveVerifyRedirect({
      detail: "Email verified",
      needs_password: true,
      uid: "u1",
      token: "t1",
    });
    expect(redirect).toBe("/reset-password?uid=u1&token=t1&mode=create");
  });

  test("no rompe con datos inesperados", () => {
    expect(resolveVerifyRedirect(null)).toBeNull();
    expect(resolveVerifyRedirect(undefined)).toBeNull();
    expect(resolveVerifyRedirect("texto")).toBeNull();
    expect(resolveVerifyRedirect(42)).toBeNull();
  });
});
