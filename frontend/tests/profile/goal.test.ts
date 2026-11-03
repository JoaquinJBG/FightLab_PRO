import { describe, expect, it } from "vitest";
import { coachToLegacyGoal, goalToMigrate, legacyToCoachGoal } from "@/lib/goal";

describe("migración de flp_nutri_goal", () => {
  it("traduce los valores antiguos a los del coach", () => {
    expect(legacyToCoachGoal("perder")).toBe("fat_loss");
    expect(legacyToCoachGoal("mantener")).toBe("maintenance");
    expect(legacyToCoachGoal("ganar")).toBe("muscle_gain");
    expect(legacyToCoachGoal("otro")).toBeNull();
    expect(legacyToCoachGoal(null)).toBeNull();
  });

  it("solo migra si el perfil aún no tiene objetivo", () => {
    expect(goalToMigrate(null, "perder")).toBe("fat_loss");
    expect(goalToMigrate("muscle_gain", "perder")).toBeNull();
    expect(goalToMigrate(null, null)).toBeNull();
  });

  it("Nutrición sigue leyendo perder/mantener/ganar hasta la fase 4", () => {
    expect(coachToLegacyGoal("fat_loss")).toBe("perder");
    expect(coachToLegacyGoal("muscle_gain")).toBe("ganar");
    expect(coachToLegacyGoal("recomposition")).toBe("mantener");
    expect(coachToLegacyGoal(null)).toBe("mantener");
  });
});
