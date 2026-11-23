import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { buildAssetLinks, normalizeFingerprint } from "@/lib/assetlinks";
import { GET } from "@/app/.well-known/assetlinks.json/route";
import { config as proxyConfig } from "@/proxy";

const HEX = "0123456789ABCDEF".repeat(4); // 64 hex = 32 bytes
const FP = HEX.match(/../g)!.join(":");

afterEach(() => vi.unstubAllEnvs());

describe("normalizeFingerprint", () => {
  it("acepta con o sin «:» y en minúsculas, y lo deja como AA:BB:…", () => {
    expect(normalizeFingerprint(FP)).toBe(FP);
    expect(normalizeFingerprint(HEX.toLowerCase())).toBe(FP);
    expect(normalizeFingerprint(`  ${FP}  `)).toBe(FP);
  });
  it("rechaza lo que no son 32 bytes en hex", () => {
    expect(normalizeFingerprint("")).toBeNull();
    expect(normalizeFingerprint("AA:BB")).toBeNull();
    expect(normalizeFingerprint(HEX + "00")).toBeNull();
    expect(normalizeFingerprint("Z".repeat(64))).toBeNull();
  });
});

describe("buildAssetLinks", () => {
  it("sin huella o con huella inválida devuelve []", () => {
    expect(buildAssetLinks(undefined, undefined)).toEqual([]);
    expect(buildAssetLinks("", "app.fightlab.pro")).toEqual([]);
    expect(buildAssetLinks("no-es-un-sha", undefined)).toEqual([]);
  });
  it("paquete por defecto app.fightlab.pro", () => {
    expect(buildAssetLinks(FP, undefined)).toEqual([
      {
        relation: ["delegate_permission/common.handle_all_urls"],
        target: { namespace: "android_app", package_name: "app.fightlab.pro", sha256_cert_fingerprints: [FP] },
      },
    ]);
  });
  it("paquete propio, varias huellas y descarta las inválidas", () => {
    const other = "AB".repeat(32);
    const out = buildAssetLinks(`${FP}, basura ,${other}`, "com.ejemplo.app");
    expect(out[0].target.package_name).toBe("com.ejemplo.app");
    expect(out[0].target.sha256_cert_fingerprints).toEqual([FP, "AB:".repeat(31) + "AB"]);
  });
  it("un paquete mal formado cae al de por defecto", () => {
    expect(buildAssetLinks(FP, "no valido!")[0].target.package_name).toBe("app.fightlab.pro");
  });
});

describe("GET /.well-known/assetlinks.json", () => {
  it("sin ANDROID_CERT_SHA256: 200, application/json y []", async () => {
    vi.stubEnv("ANDROID_CERT_SHA256", "");
    const res = GET();
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("application/json");
    expect(res.headers.get("location")).toBeNull();
    expect(await res.json()).toEqual([]);
  });
  it("con variables: el paquete y la huella", async () => {
    vi.stubEnv("ANDROID_CERT_SHA256", FP);
    vi.stubEnv("ANDROID_PACKAGE", "");
    const body = await GET().json();
    expect(body[0].target.package_name).toBe("app.fightlab.pro");
    expect(body[0].target.sha256_cert_fingerprints).toEqual([FP]);
  });
});

describe("la ruta no la interceptan ni el proxy ni el service worker", () => {
  it("ningún matcher del proxy cubre /.well-known/", () => {
    const re = (m: string) => new RegExp("^" + m.replace(/:path\*/g, ".*") + "$");
    for (const m of proxyConfig.matcher) expect(re(m).test("/.well-known/assetlinks.json"), m).toBe(false);
  });
  it("sw.js deja pasar /.well-known/ a la red", () => {
    const sw = readFileSync(join(process.cwd(), "public", "sw.js"), "utf8");
    expect(sw).toContain('url.pathname.startsWith("/.well-known/")');
  });
});
