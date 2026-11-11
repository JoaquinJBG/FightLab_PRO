import { describe, expect, it } from "vitest";
import { userFacingRuleText } from "@/lib/evidence";
import rulesEs from "./fixtures/rules-es.json";

// F20 de la prueba en móvil: la hoja de evidencia enseñaba el texto pensado para el motor
// («El texto del coach puede decir…», «la app no debe decir…»).

describe("userFacingRuleText", () => {
  it("quita las prohibiciones a la app y deja el contenido de «puede decir que…»", () => {
    const es =
      "Muestra la carga sin alarmas. El texto del coach puede decir que conviene comentar los saltos grandes con un entrenador, y que nada de esto es un diagnóstico. Cualquier aviso numérico debe etiquetarse como \"convención de FightLab\", y la app no debe decir que mantenerse por debajo evita las lesiones.";
    const out = userFacingRuleText(es);
    expect(out).toContain("Conviene comentar los saltos grandes con un entrenador");
    expect(out).not.toMatch(/texto del coach|no debe decir|debe etiquetarse/);
  });

  it("en inglés igual", () => {
    const en =
      "FightLab may tell combat-sport athletes that rapid weight loss had the most consistent evidence. The app must not say that staying under it prevents injury.";
    expect(userFacingRuleText(en)).toBe("Rapid weight loss had the most consistent evidence.");
    expect(userFacingRuleText("Plain rule.")).toBe("Plain rule.");
  });

  it("si todo era para el motor, mejor el original que nada", () => {
    expect(userFacingRuleText("The app must not say X.")).toBe("The app must not say X.");
  });

  it("ninguna regla traducida del anexo deja «puede decir» ni «no debe decir» a la vista", () => {
    const texts = JSON.stringify(rulesEs).match(/"rule_text":\s*"((?:[^"\\]|\\.)*)"/g) ?? [];
    expect(texts.length).toBeGreaterThan(0);
    for (const raw of texts) {
      const text = JSON.parse(`{${raw}}`).rule_text as string;
      const out = userFacingRuleText(text);
      expect(out, text.slice(0, 80)).not.toMatch(/\b(?:la app|el texto del coach|FightLab) (?:puede|no debe) decir\b/i);
    }
  });
});
