import { describe, expect, it } from "vitest";
import es from "@/messages/es.json";
import en from "@/messages/en.json";

// Claves anidadas como "credits.title" (los arrays se tratan como una hoja)
function keys(obj: unknown, prefix = ""): string[] {
  if (obj === null || typeof obj !== "object" || Array.isArray(obj)) return [prefix];
  return Object.entries(obj as Record<string, unknown>).flatMap(([k, v]) =>
    keys(v, prefix ? `${prefix}.${k}` : k),
  );
}

describe("catálogos es/en", () => {
  it("tienen exactamente las mismas claves", () => {
    const a = keys(es).sort();
    const b = keys(en).sort();
    expect(a.filter((k) => !b.includes(k)), "faltan en en.json").toEqual([]);
    expect(b.filter((k) => !a.includes(k)), "faltan en es.json").toEqual([]);
  });

  it("no tienen cadenas vacías", () => {
    for (const [name, cat] of [["es", es], ["en", en]] as const) {
      const flat = JSON.stringify(cat);
      expect(flat, name).not.toContain('""');
    }
  });
});
