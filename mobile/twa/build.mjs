#!/usr/bin/env node
// Compila el APK de FightLab (TWA) sin preguntas. Lo lanza build.ps1 (o build.sh); también vale solo.
//
// Entradas (variables de entorno):
//   FIGHTLAB_HOST      obligatoria. Dominio de producción SIN https:// ni ruta. Ej.: mi-app.vercel.app
//   FIGHTLAB_KEYSTORE  ruta de la keystore (la del usuario, FUERA del repo). Obligatoria.
//   FIGHTLAB_KEY_ALIAS alias de la llave. Por defecto: fightlab
//   JAVA_HOME          JDK 17 (o FIGHTLAB_JDK). Obligatoria.
//   ANDROID_HOME       Android SDK con las licencias ya aceptadas (o FIGHTLAB_SDK). Obligatoria.
//   BUBBLEWRAP_KEYSTORE_PASSWORD / BUBBLEWRAP_KEY_PASSWORD  contraseñas; si faltan, Bubblewrap las pide.
//
// Salida: mobile/twa/build/project/app-release-signed.apk (y el .aab). Nada de esto se versiona.

import { spawn, spawnSync } from "node:child_process";
import { createServer } from "node:http";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync, statSync, createReadStream } from "node:fs";
import { dirname, join, resolve, normalize, extname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const publicDir = resolve(here, "..", "..", "frontend", "public");
const buildDir = join(here, "build");
const projectDir = join(buildDir, "project");
const homeDir = join(buildDir, "home"); // HOME aislado: config de Bubblewrap y caché de Gradle, dentro de build/
const manifestOut = join(buildDir, "twa-manifest.json");

const fail = (msg) => {
  console.error(`\nERROR: ${msg}`);
  process.exit(1);
};

// --- entradas ---
const host = (process.env.FIGHTLAB_HOST ?? "").trim();
if (!host) fail("falta FIGHTLAB_HOST (dominio de producción sin https://, p. ej. mi-app.vercel.app).");
if (!/^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+(:\d+)?$/i.test(host))
  fail(`FIGHTLAB_HOST «${host}» no es un dominio válido: sin https://, sin «/» ni ruta.`);
const keystore = (process.env.FIGHTLAB_KEYSTORE ?? "").trim();
if (!keystore) fail("falta FIGHTLAB_KEYSTORE (ruta de tu keystore, fuera del repo).");
if (!existsSync(keystore)) fail(`no existe la keystore: ${keystore}`);
const alias = (process.env.FIGHTLAB_KEY_ALIAS ?? "fightlab").trim();
const jdk = (process.env.FIGHTLAB_JDK || process.env.JAVA_HOME || "").trim();
if (!jdk || !existsSync(join(jdk, "bin", process.platform === "win32" ? "javac.exe" : "javac")))
  fail("falta un JDK 17 (JAVA_HOME o FIGHTLAB_JDK apuntando a la carpeta del JDK, con bin/javac).");
const sdk = (process.env.FIGHTLAB_SDK || process.env.ANDROID_HOME || process.env.ANDROID_SDK_ROOT || "").trim();
if (!sdk || !existsSync(sdk)) fail("falta el Android SDK (ANDROID_HOME o FIGHTLAB_SDK apuntando a su carpeta).");

const run = (cmd, args, opts = {}) => {
  const r = spawnSync(cmd, args, { stdio: "inherit", shell: process.platform === "win32" && cmd === "npm", ...opts });
  if (r.status !== 0) fail(`falló: ${cmd} ${args.join(" ")}`);
};
// Asíncrono: el servidor local de iconos vive en este proceso y spawnSync lo bloquearía (Bubblewrap se quedaría esperando).
const runAsync = (cmd, args, opts = {}) =>
  new Promise((done) => {
    spawn(cmd, args, { stdio: "inherit", ...opts }).on("exit", (code) =>
      code === 0 ? done() : fail(`falló: ${cmd} ${args.join(" ")}`),
    );
  });

// --- Bubblewrap (versión fijada en package.json / package-lock.json) ---
if (!existsSync(join(here, "node_modules", "@bubblewrap", "cli"))) {
  console.log("Instalando Bubblewrap (npm ci)...");
  run("npm", ["ci", "--no-audit", "--no-fund"], { cwd: here });
}
const bubblewrap = join(here, "node_modules", "@bubblewrap", "cli", "bin", "bubblewrap.js");

// --- entorno aislado: no toca ~/.bubblewrap ni ~/.gradle del usuario ---
rmSync(projectDir, { recursive: true, force: true });
mkdirSync(join(homeDir, ".bubblewrap"), { recursive: true });
mkdirSync(projectDir, { recursive: true });
writeFileSync(
  join(homeDir, ".bubblewrap", "config.json"),
  JSON.stringify({ jdkPath: jdk, androidSdkPath: sdk }, null, 2),
);

// --- los iconos salen de frontend/public, servidos solo en local mientras se genera el proyecto ---
const MIME = { ".png": "image/png", ".svg": "image/svg+xml" };
const server = createServer((req, res) => {
  const rel = normalize(decodeURIComponent((req.url ?? "/").split("?")[0])).replace(/^([/\\])+/, "");
  const file = resolve(publicDir, rel);
  const okType = MIME[extname(file)];
  if (!file.startsWith(publicDir) || !okType || !existsSync(file) || !statSync(file).isFile()) {
    res.writeHead(404).end();
    return;
  }
  res.writeHead(200, { "Content-Type": okType });
  createReadStream(file).pipe(res);
});
await new Promise((ok) => server.listen(0, "127.0.0.1", ok));
const iconsBase = `http://127.0.0.1:${server.address().port}`;

let ok = false;
try {
  // --- manifest de Bubblewrap a partir de la plantilla ---
  const manifest = readFileSync(join(here, "twa-manifest.template.json"), "utf8")
    .replaceAll("__FIGHTLAB_HOST__", host)
    .replaceAll("__ICONS_BASE__", iconsBase)
    .replaceAll("__KEYSTORE__", keystore.replaceAll("\\", "/"))
    .replaceAll("__KEY_ALIAS__", alias);
  writeFileSync(manifestOut, manifest);

  const env = {
    ...process.env,
    USERPROFILE: homeDir, // os.homedir() en Windows
    HOME: homeDir,
    JAVA_HOME: jdk,
    ANDROID_HOME: sdk,
    ANDROID_SDK_ROOT: sdk,
    BUBBLEWRAP_SKIP_VERSION_CHECK: "1",
  };
  const bw = (...args) => runAsync(process.execPath, [bubblewrap, ...args], { env, cwd: buildDir });

  // `update` con --skipVersionUpgrade: respeta appVersionCode de la plantilla (Bubblewrap, si no, lo sube solo).
  await bw("update", `--manifest=${manifestOut}`, `--directory=${projectDir}`, "--skipVersionUpgrade");
  await bw("build", `--manifest=${manifestOut}`, `--directory=${projectDir}`);
  ok = true;
} finally {
  server.close();
}

if (ok) {
  const apk = join(projectDir, "app-release-signed.apk");
  console.log(`\nListo. APK firmado: ${apk}`);
}
