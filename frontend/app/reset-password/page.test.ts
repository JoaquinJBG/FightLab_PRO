import { describe, expect, test } from "vitest";
import { isCreatePasswordMode } from "./page";

describe("isCreatePasswordMode (modo 'crear contraseña' llegado desde verify-email)", () => {
  test("es true solo con mode=create", () => {
    expect(isCreatePasswordMode("create")).toBe(true);
  });

  test("es false sin mode o con cualquier otro valor", () => {
    expect(isCreatePasswordMode(null)).toBe(false);
    expect(isCreatePasswordMode("reset")).toBe(false);
    expect(isCreatePasswordMode("")).toBe(false);
  });
});
