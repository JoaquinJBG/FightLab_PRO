import { describe, test, expect } from "vitest";
import { itemSource, photoErrorForStatus, photoErrorKind, scale, searchSource } from "./nutrition";
import es from "@/messages/es.json";

describe("scale", () => {
  test("escala los macros por gramos (valores por 100 g)", () => {
    // Pechuga de pollo por 100 g -> 200 g duplica y redondea
    const r = scale({ kcal: 165, p: 31, c: 0, f: 3.6 }, 200);
    expect(r).toEqual({ kcal: 330, p: 62, c: 0, f: 7 }); // 3.6*2 = 7.2 -> 7
  });

  test("con menos de 100 g escala hacia abajo y redondea", () => {
    const r = scale({ kcal: 100, p: 10, c: 20, f: 5 }, 50);
    expect(r).toEqual({ kcal: 50, p: 5, c: 10, f: 3 }); // 5*0.5 = 2.5 -> 3
  });
});

// Los objetivos de kcal/macros ya no se calculan en el cliente: los da el servidor
// (`/coach/targets`, ver tests/nutrition/nutrition-page.test.tsx).

describe("photoErrorForStatus", () => {
  test("503 (IA no configurada/caída): mensaje de no disponible, no un plato inventado", () => {
    expect(photoErrorForStatus(503)).toMatch(/no está disponible/i);
  });

  test("429 (cuota agotada): mensaje de límite diario", () => {
    expect(photoErrorForStatus(429)).toMatch(/límite diario/i);
  });

  test("502 (respuesta inválida del proveedor): mensaje de fallo al analizar", () => {
    expect(photoErrorForStatus(502)).toMatch(/no ha podido analizar/i);
  });

  test("200/otros códigos: no es un error conocido, devuelve null", () => {
    expect(photoErrorForStatus(200)).toBeNull();
    expect(photoErrorForStatus(500)).toBeNull();
    expect(photoErrorForStatus(400)).toBeNull();
  });
});

describe("photoErrorKind", () => {
  test("da la clave de catálogo de cada fallo conocido de la IA de visión", () => {
    expect(photoErrorKind(503)).toBe("unavailable");
    expect(photoErrorKind(429)).toBe("quota");
    expect(photoErrorKind(502)).toBe("failed");
  });

  test("200/otros códigos: null", () => {
    expect(photoErrorKind(200)).toBeNull();
    expect(photoErrorKind(500)).toBeNull();
  });
});

describe("R4-9: el origen de lo que viene del catálogo", () => {
  test("un producto de tu catálogo sale «De tu catálogo»; uno de la tabla de la región o un alimento, de la tabla", () => {
    expect(searchSource({ kind: "product", source: "off" })).toBe("catalogue");
    expect(searchSource({ kind: "product", source: "label:Mercadona" })).toBe("food");
    expect(searchSource({ kind: "food", source: "usda" })).toBe("food");
  });

  test("«Escaneado» y «De tu catálogo» tienen su texto y no caen en «Apuntado a mano»", () => {
    expect(itemSource({ source: "scanned" })).toBe("scanned");
    expect(itemSource({ source: "catalogue" })).toBe("catalogue");
    expect(es.nutrition.source.scanned).toBe("Escaneado");
    expect(es.nutrition.source.catalogue).toBe("De tu catálogo");
  });
});
