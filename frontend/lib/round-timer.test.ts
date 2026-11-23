import { describe, test, expect, beforeEach } from "vitest";
import { CFG_KEY, readRoundConfig } from "./round-timer";

describe("readRoundConfig", () => {
  beforeEach(() => localStorage.clear());

  test("sin config guardada: objeto vacío", () => {
    expect(readRoundConfig()).toEqual({});
  });

  test("config guardada: se devuelve tal cual", () => {
    const cfg = { rounds: 8, work: 20, rest: 10, prep: 5, warn: 10 };
    localStorage.setItem(CFG_KEY, JSON.stringify(cfg));
    expect(readRoundConfig()).toEqual(cfg);
  });

  test("JSON corrupto: no revienta, devuelve objeto vacío", () => {
    localStorage.setItem(CFG_KEY, "{no-es-json");
    expect(readRoundConfig()).toEqual({});
  });

  test("valor guardado que no es un objeto: se ignora", () => {
    localStorage.setItem(CFG_KEY, JSON.stringify(42));
    expect(readRoundConfig()).toEqual({});
  });
});
