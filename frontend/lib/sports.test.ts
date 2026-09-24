import { describe, test, expect, beforeEach } from "vitest";
import { LIVE_KEY, readLiveSession } from "./sports";

const VALID_KEYS = ["run", "walk", "bike"];

describe("readLiveSession", () => {
  beforeEach(() => localStorage.clear());

  test("sin nada guardado: no hay sesión que recuperar", () => {
    expect(readLiveSession(VALID_KEYS)).toBeNull();
  });

  test("sesión reciente y con deporte válido: se recupera", () => {
    const s = { sportKey: "run", elapsed: 120, kcal: 45, intIdx: 1, savedAt: Date.now() };
    localStorage.setItem(LIVE_KEY, JSON.stringify(s));
    expect(readLiveSession(VALID_KEYS)).toEqual(s);
  });

  test("sesión de hace más de 12 h: se descarta y se limpia el storage", () => {
    const s = { sportKey: "run", elapsed: 120, kcal: 45, intIdx: 1, savedAt: Date.now() - 13 * 3600_000 };
    localStorage.setItem(LIVE_KEY, JSON.stringify(s));
    expect(readLiveSession(VALID_KEYS)).toBeNull();
    expect(localStorage.getItem(LIVE_KEY)).toBeNull();
  });

  test("deporte desconocido (ya no existe en la app): se descarta y se limpia el storage", () => {
    const s = { sportKey: "no-existe", elapsed: 120, kcal: 45, intIdx: 1, savedAt: Date.now() };
    localStorage.setItem(LIVE_KEY, JSON.stringify(s));
    expect(readLiveSession(VALID_KEYS)).toBeNull();
    expect(localStorage.getItem(LIVE_KEY)).toBeNull();
  });

  test("sin tiempo transcurrido (elapsed 0): se descarta", () => {
    const s = { sportKey: "run", elapsed: 0, kcal: 0, intIdx: 1, savedAt: Date.now() };
    localStorage.setItem(LIVE_KEY, JSON.stringify(s));
    expect(readLiveSession(VALID_KEYS)).toBeNull();
  });

  test("JSON corrupto: no revienta, devuelve null", () => {
    localStorage.setItem(LIVE_KEY, "{no-es-json");
    expect(readLiveSession(VALID_KEYS)).toBeNull();
  });
});
