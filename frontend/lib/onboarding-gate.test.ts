import { describe, expect, test } from "vitest";
import { gateView } from "@/components/onboarding-gate";

const base = { isLoading: false, isError: false, incomplete: false, slow: false };
const dashboard = { ...base, pathname: "/dashboard" };

describe("gateView", () => {
  test("no bloquea /training/* mientras carga, tarda o falla el perfil", () => {
    for (const pathname of ["/training/gym/session", "/training/tools", "/training"]) {
      expect(gateView({ ...base, pathname, isLoading: true })).toBe("children");
      expect(gateView({ ...base, pathname, isLoading: true, slow: true })).toBe("children");
      expect(gateView({ ...base, pathname, isError: true })).toBe("children");
    }
  });

  test("fuera de /training: esqueleto al cargar, reintento si tarda ≥10 s o falla", () => {
    expect(gateView({ ...dashboard, isLoading: true })).toBe("skeleton");
    expect(gateView({ ...dashboard, isLoading: true, slow: true })).toBe("slow");
    expect(gateView({ ...dashboard, isError: true })).toBe("error");
    expect(gateView(dashboard)).toBe("children");
  });

  test("perfil incompleto fuera de /training: no pinta el shell mientras redirige", () => {
    expect(gateView({ ...dashboard, incomplete: true })).toBe("skeleton");
  });

  test("/trainingfoo no cuenta como /training", () => {
    expect(gateView({ ...base, pathname: "/trainingfoo", isLoading: true })).toBe("skeleton");
  });
});
