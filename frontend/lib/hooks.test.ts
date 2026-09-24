import { describe, test, expect, beforeEach } from "vitest";
import { clearDeviceState } from "./hooks";

describe("clearDeviceState (useLogout)", () => {
  beforeEach(() => localStorage.clear());

  test("borra las claves flp_* del dispositivo", () => {
    localStorage.setItem("flp_activities", "[1]");
    localStorage.setItem("flp_mma", "[1]");
    localStorage.setItem("flp_gym_sessions", "[1]");
    localStorage.setItem("flp_weigh", "{}");
    localStorage.setItem("flp_uid", "42");
    localStorage.setItem("otra_clave_no_flp", "no se toca");

    clearDeviceState("42");

    expect(localStorage.getItem("flp_activities")).toBeNull();
    expect(localStorage.getItem("flp_mma")).toBeNull();
    expect(localStorage.getItem("flp_gym_sessions")).toBeNull();
    expect(localStorage.getItem("flp_weigh")).toBeNull();
    expect(localStorage.getItem("flp_uid")).toBeNull();
    expect(localStorage.getItem("otra_clave_no_flp")).toBe("no se toca"); // ni se plantea: no es flp_*
  });

  test("conserva las preferencias no personales del dispositivo", () => {
    localStorage.setItem("flp_round_cfg", JSON.stringify({ rounds: 5 }));
    localStorage.setItem("flp_gym_rest", "90");
    localStorage.setItem("flp_activities", "[1]");

    clearDeviceState("42");

    expect(localStorage.getItem("flp_round_cfg")).not.toBeNull();
    expect(localStorage.getItem("flp_gym_rest")).not.toBeNull();
    expect(localStorage.getItem("flp_activities")).toBeNull();
  });

  test("borra la cola pendiente del uid que cierra sesión", () => {
    localStorage.setItem("flp_pending_acts_42", "[1]");
    localStorage.setItem("flp_pending_dels_42", "[1]");

    clearDeviceState("42");

    expect(localStorage.getItem("flp_pending_acts_42")).toBeNull();
    expect(localStorage.getItem("flp_pending_dels_42")).toBeNull();
  });

  test("NO borra la cola pendiente de OTRO uid (móvil compartido)", () => {
    localStorage.setItem("flp_pending_acts_99", "[1]"); // otra cuenta, aún sin subir
    localStorage.setItem("flp_pending_dels_99", "[1]");

    clearDeviceState("42");

    expect(localStorage.getItem("flp_pending_acts_99")).toBe("[1]");
    expect(localStorage.getItem("flp_pending_dels_99")).toBe("[1]");
  });

  test("sin uid conocido, no arriesga ninguna cola pendiente", () => {
    localStorage.setItem("flp_pending_acts_42", "[1]");

    clearDeviceState(null);

    expect(localStorage.getItem("flp_pending_acts_42")).toBe("[1]");
  });
});
