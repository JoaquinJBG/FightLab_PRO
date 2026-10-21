import { describe, test, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

const ROOT = path.resolve(__dirname, "..");
function walk(dir: string, out: string[] = []): string[] {
  for (const f of readdirSync(dir)) {
    if (f === "node_modules" || f === ".next") continue;
    const p = path.join(dir, f);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(tsx?|css)$/.test(f) && !/\.test\./.test(f)) out.push(p);
  }
  return out;
}
const src = [...walk(path.join(ROOT, "app")), ...walk(path.join(ROOT, "components")), ...walk(path.join(ROOT, "lib"))];
const read = (p: string) => readFileSync(p, "utf8");

describe("sin funciones simuladas ni valores inventados", () => {
  test.each(["mockVoice", "sin riesgo añadido", "zona segura"])("no aparece %s", (needle) => {
    expect(src.filter((p) => read(p).includes(needle))).toEqual([]);
  });

  test("el layout no bloquea el zoom", () => {
    expect(read(path.join(ROOT, "app/layout.tsx"))).not.toMatch(/maximumScale|user-scalable/);
  });

  test("nutrición y deportes no usan pesos/alturas/edades por defecto", () => {
    const nutri = read(path.join(ROOT, "app/(shell)/nutrition/page.tsx"));
    const sports = read(path.join(ROOT, "app/(shell)/training/sports/page.tsx"));
    expect(nutri).not.toMatch(/\?\? 175|return 75|return 30/);
    expect(sports).not.toMatch(/\?\? 70/);
  });

  test("no hay opción imperial en onboarding ni en el formulario de perfil", () => {
    expect(read(path.join(ROOT, "app/onboarding/page.tsx"))).not.toMatch(/IMPERIAL/);
    expect(read(path.join(ROOT, "components/profile-form.tsx"))).not.toMatch(/IMPERIAL/);
  });

  test("el hub de gimnasio no promete 'solo en tu dispositivo' ni rutina IA", () => {
    const gym = read(path.join(ROOT, "app/(shell)/training/gym/page.tsx"));
    expect(gym).not.toMatch(/solo en tu dispositivo|Crear rutina|Generar rutina/);
  });
});
