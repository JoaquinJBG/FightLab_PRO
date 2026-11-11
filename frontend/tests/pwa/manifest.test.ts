import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";

vi.mock("next-intl/server", () => ({ getTranslations: async () => (key: string) => key }));

const { default: manifest } = await import("@/app/manifest");
const pub = (src: string) => join(process.cwd(), "public", src.replace(/^\//, ""));

// F16 de la prueba en móvil: el icono de la PWA era una «F» y el logo de la app dice «FL».
describe("manifest de la PWA", () => {
  it("iconos en 192 y 512, normal y maskable, y todos existen", async () => {
    const m = await manifest();
    const icons = m.icons ?? [];
    for (const purpose of ["any", "maskable"]) {
      const sizes = icons.filter((i) => i.purpose === purpose).map((i) => i.sizes);
      expect(sizes, purpose).toEqual(expect.arrayContaining(["any", "192x192", "512x512"]));
    }
    for (const i of icons) expect(existsSync(pub(i.src)), i.src).toBe(true);
  });

  it("los SVG dibujan «FL» (la F y la L), no solo la F", () => {
    for (const f of ["icon.svg", "icon-maskable.svg"]) {
      const svg = readFileSync(pub(f), "utf8");
      const paths = svg.match(/<path d="[^"]+"/g) ?? [];
      // F: palo, barra de arriba y barra del medio; L: palo con su pie (una sola línea con H)
      expect(paths.length, f).toBe(4);
      expect(paths.some((p) => /V\d+ H\d+/.test(p)), f).toBe(true);
    }
  });

  it("los PNG tienen el tamaño que dicen", () => {
    const size = (f: string) => {
      const b = readFileSync(pub(f));
      return [b.readUInt32BE(16), b.readUInt32BE(20)];
    };
    expect(size("icon-192.png")).toEqual([192, 192]);
    expect(size("icon-512.png")).toEqual([512, 512]);
    expect(size("icon-maskable-192.png")).toEqual([192, 192]);
    expect(size("icon-maskable-512.png")).toEqual([512, 512]);
    expect(size("apple-touch-icon.png")).toEqual([180, 180]);
  });
});
