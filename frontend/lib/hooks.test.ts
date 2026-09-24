import { afterEach, describe, test, expect, beforeEach, vi } from "vitest";

// vi.mock se hoistea sobre los imports de más abajo, así que "./hooks" (y lo
// que importa de "./activities"/"./user-state") ya carga con estos stubs.
// Registra el orden de llamadas en `calls` para comprobar la secuencia real
// que sigue el logout (vaciar colas -> solo entonces cerrar sesión).
const calls: string[] = [];

vi.mock("./activities", () => ({
  cachedActivityUid: vi.fn(() => "42"),
  resetActivityUid: vi.fn(() => {
    calls.push("resetActivityUid");
  }),
  flushActivities: vi.fn(async () => {
    calls.push("flushActivities");
    return true;
  }),
}));

vi.mock("./user-state", () => ({
  flushUserState: vi.fn(async () => {
    calls.push("flushUserState");
  }),
  resetUserStateQueue: vi.fn(() => {
    calls.push("resetUserStateQueue");
  }),
}));

import { clearDeviceState, finishLogout, performLogout } from "./hooks";

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

  test("borra la cola pendiente de user-state del uid que cierra sesión", () => {
    localStorage.setItem("flp_pending_state_42", "[1]");

    clearDeviceState("42");

    expect(localStorage.getItem("flp_pending_state_42")).toBeNull();
  });

  test("NO borra la cola pendiente de user-state de OTRO uid (móvil compartido)", () => {
    localStorage.setItem("flp_pending_state_99", "[1]"); // otra cuenta, aún sin subir

    clearDeviceState("42");

    expect(localStorage.getItem("flp_pending_state_99")).toBe("[1]");
  });
});

describe("performLogout / finishLogout (useLogout)", () => {
  beforeEach(() => {
    localStorage.clear();
    calls.length = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        calls.push("logout-fetch");
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
      }),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  test("vacía primero la cola de activities y la de user-state, y solo entonces llama a /api/auth/logout", async () => {
    const uid = await performLogout();

    expect(uid).toBe("42"); // capturado antes de que nada lo borre
    expect(calls).toEqual(["flushActivities", "flushUserState", "logout-fetch"]);
  });

  test("si el logout falla en la red, aun así se intentó vaciar lo pendiente antes", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        calls.push("logout-fetch");
        throw new Error("offline");
      }),
    );
    await expect(performLogout()).rejects.toThrow();
    expect(calls).toEqual(["flushActivities", "flushUserState", "logout-fetch"]);
  });

  test("finishLogout cancela la cola de user-state (resetUserStateQueue) ANTES de limpiar el dispositivo", () => {
    localStorage.setItem("flp_pending_state_42", "[1]"); // simula algo que no se pudo subir
    const qc = { clear: () => calls.push("qc.clear") };

    finishLogout(qc, "42");

    expect(calls).toEqual(["qc.clear", "resetUserStateQueue", "resetActivityUid"]);
    // resetUserStateQueue no toca localStorage: clearDeviceState es quien lo hace
    expect(localStorage.getItem("flp_pending_state_42")).toBeNull();
  });
});

describe("applyProfileUpdate", () => {
  test("deja en caché el perfil guardado para que el guard de onboarding no lea el viejo", async () => {
    const { QueryClient } = await import("@tanstack/react-query");
    const { applyProfileUpdate } = await import("./hooks");
    const qc = new QueryClient();
    // Perfil incompleto cacheado cuando el guard mandó al usuario a /onboarding.
    qc.setQueryData(["profile"], { date_of_birth: null, height_cm: null });
    const saved = {
      date_of_birth: "1995-04-02",
      gender: "M",
      height_cm: 178,
      dominant_stance: null,
      preferred_units: "metric",
      timezone: "Europe/Madrid",
    };
    applyProfileUpdate(qc, saved);
    const cached = qc.getQueryData<{ date_of_birth: string | null; height_cm: number | null }>(["profile"]);
    expect(cached?.date_of_birth).toBe("1995-04-02");
    expect(cached?.height_cm).toBe(178);
  });

  test("si la respuesta no encaja con el schema, borra la caché para forzar una lectura nueva", async () => {
    const { QueryClient } = await import("@tanstack/react-query");
    const { applyProfileUpdate } = await import("./hooks");
    const qc = new QueryClient();
    qc.setQueryData(["profile"], { date_of_birth: null, height_cm: null });
    applyProfileUpdate(qc, { raro: true });
    expect(qc.getQueryData(["profile"])).toBeUndefined();
  });
});
