// Genera los PNG y el favicon de la PWA desde public/icon.svg y public/icon-maskable.svg (F16).
// Uso: node scripts/icons.mjs (desde frontend/). Usa sharp, que ya viene con Next.
import { readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";

// sharp llega como dependencia de Next (pnpm no la sube a la raíz): se resuelve desde next.
const fromHere = createRequire(import.meta.url);
const sharp = createRequire(fromHere.resolve("next/package.json"))("sharp");

const icon = readFileSync("public/icon.svg");
const maskable = readFileSync("public/icon-maskable.svg");

const png = (svg, size) => sharp(svg, { density: 384 }).resize(size, size).png().toBuffer();

const out = [
  ["public/icon-192.png", icon, 192],
  ["public/icon-512.png", icon, 512],
  ["public/icon-maskable-192.png", maskable, 192],
  ["public/icon-maskable-512.png", maskable, 512],
  // iOS redondea las esquinas por su cuenta: fondo a sangre, como el maskable.
  ["public/apple-touch-icon.png", maskable, 180],
];
for (const [path, svg, size] of out) writeFileSync(path, await png(svg, size));

// favicon.ico con un PNG de 48 px dentro (formato ICO con PNG, válido desde Windows Vista).
const fav = await png(icon, 48);
const header = Buffer.alloc(6);
header.writeUInt16LE(0, 0);
header.writeUInt16LE(1, 2);
header.writeUInt16LE(1, 4);
const entry = Buffer.alloc(16);
entry.writeUInt8(48, 0);
entry.writeUInt8(48, 1);
entry.writeUInt8(0, 2);
entry.writeUInt8(0, 3);
entry.writeUInt16LE(1, 4);
entry.writeUInt16LE(32, 6);
entry.writeUInt32LE(fav.length, 8);
entry.writeUInt32LE(6 + 16, 12);
writeFileSync("app/favicon.ico", Buffer.concat([header, entry, fav]));
console.log("ok");
