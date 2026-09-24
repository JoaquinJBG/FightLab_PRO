import { describe, test, expect } from "vitest";
import {
  isSegmentSafe,
  isPathSafe,
  isPrefixAllowed,
  isBodyTooLarge,
  isOriginAllowed,
  buildProxyResponse,
  isRefreshTokenExpiredOrMalformed,
  classifyGatewayError,
  MAX_PROXY_BODY_BYTES,
} from "./proxy-guard";

/** Construye un JWT sin firmar (no hace falta firma real: la función bajo
 * prueba solo decodifica el payload) con el "exp" indicado. */
function fakeJwt(payload: Record<string, unknown>): string {
  const b64url = (obj: unknown) => Buffer.from(JSON.stringify(obj)).toString("base64url");
  return `${b64url({ alg: "none" })}.${b64url(payload)}.sig`;
}

describe("isSegmentSafe", () => {
  test("acepta un id o slug normal", () => {
    expect(isSegmentSafe("activities")).toBe(true);
    expect(isSegmentSafe("42")).toBe(true);
    expect(isSegmentSafe("sync")).toBe(true);
  });

  test("rechaza segmentos vacíos y de traversal", () => {
    expect(isSegmentSafe("")).toBe(false);
    expect(isSegmentSafe(".")).toBe(false);
    expect(isSegmentSafe("..")).toBe(false);
  });

  test("rechaza separadores y % (para no colarse tras un doble decode)", () => {
    expect(isSegmentSafe("me/../admin")).toBe(false);
    expect(isSegmentSafe("me%2Fadmin")).toBe(false);
    expect(isSegmentSafe("a\\b")).toBe(false);
  });

  test("rechaza '..' con TAB, salto de línea, '?' o '#' colados (bypass real reportado en revisión)", () => {
    // Next entrega el segmento ya decodificado: "..%09" llega como ".." + TAB.
    // El parser de URL de fetch descarta TAB/CR/LF, lo que reintroduce ".."
    // y permitía escapar de /api/v1 arrastrando el Bearer del usuario.
    expect(isSegmentSafe("..\t")).toBe(false);
    expect(isSegmentSafe(".\n.")).toBe(false);
    expect(isSegmentSafe("..?")).toBe(false);
    expect(isSegmentSafe("..#")).toBe(false);
  });
});

describe("isPathSafe", () => {
  test("una ruta vacía no es segura", () => {
    expect(isPathSafe([])).toBe(false);
  });

  test("todos los segmentos deben ser seguros", () => {
    expect(isPathSafe(["me", "photos", "3"])).toBe(true);
    expect(isPathSafe(["me", "..", "admin"])).toBe(false);
  });
});

describe("isPrefixAllowed", () => {
  test("permite los prefijos de la allowlist", () => {
    expect(isPrefixAllowed(["me"])).toBe(true);
    expect(isPrefixAllowed(["activities", "sync"])).toBe(true);
    expect(isPrefixAllowed(["ai", "coach", "chat"])).toBe(true);
    expect(isPrefixAllowed(["health"])).toBe(true);
  });

  test("bloquea cualquier otro prefijo, incluido /admin", () => {
    expect(isPrefixAllowed(["admin"])).toBe(false);
    expect(isPrefixAllowed(["auth", "login"])).toBe(false);
    expect(isPrefixAllowed([])).toBe(false);
  });
});

describe("isBodyTooLarge", () => {
  test("sin content-length, no se bloquea aquí", () => {
    expect(isBodyTooLarge(null)).toBe(false);
  });

  test("por debajo del límite pasa", () => {
    expect(isBodyTooLarge(String(MAX_PROXY_BODY_BYTES - 1))).toBe(false);
  });

  test("por encima del límite de 10 MB se rechaza", () => {
    expect(isBodyTooLarge(String(MAX_PROXY_BODY_BYTES + 1))).toBe(true);
  });

  test("un content-length no numérico no bloquea (no es señal fiable)", () => {
    expect(isBodyTooLarge("no-soy-un-numero")).toBe(false);
  });
});

describe("isOriginAllowed", () => {
  const self = "https://app.example.com";

  test("GET nunca se comprueba, aunque el Origin no coincida", () => {
    expect(isOriginAllowed("GET", "https://evil.example.com", self)).toBe(true);
  });

  test("POST/PATCH/PUT/DELETE con Origin igual al propio host pasan", () => {
    for (const method of ["POST", "PATCH", "PUT", "DELETE"]) {
      expect(isOriginAllowed(method, self, self)).toBe(true);
    }
  });

  test("POST con Origin de otro dominio se rechaza", () => {
    expect(isOriginAllowed("POST", "https://evil.example.com", self)).toBe(false);
  });

  test("sin cabecera Origin (clientes sin navegador) se deja pasar", () => {
    expect(isOriginAllowed("POST", null, self)).toBe(true);
  });
});

describe("buildProxyResponse", () => {
  test("204 se reenvía sin cuerpo (antes daba 500 al borrar biometrías/fotos)", async () => {
    const upstream = new Response(null, { status: 204 });
    const res = await buildProxyResponse(upstream);
    expect(res.status).toBe(204);
    expect(await res.arrayBuffer()).toEqual(new ArrayBuffer(0));
  });

  test("205 también se reenvía sin cuerpo", async () => {
    const upstream = new Response(null, { status: 205 });
    const res = await buildProxyResponse(upstream);
    expect(res.status).toBe(205);
  });

  test("JSON se parsea y se reenvía tal cual", async () => {
    const upstream = new Response(JSON.stringify({ id: 7, name: "x" }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
    const res = await buildProxyResponse(upstream);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ id: 7, name: "x" });
  });

  test("cuerpo vacío sin content-type se trata como JSON ({})", async () => {
    const upstream = new Response(null, { status: 200 });
    const res = await buildProxyResponse(upstream);
    expect(await res.json()).toEqual({});
  });

  test("un content-type no-JSON (foto) se reenvía en streaming con su content-type y cache-control", async () => {
    const bytes = new Uint8Array([1, 2, 3, 4]);
    const upstream = new Response(bytes, {
      status: 200,
      headers: {
        "content-type": "image/jpeg",
        "cache-control": "private, max-age=3600",
        "content-length": "4",
      },
    });
    const res = await buildProxyResponse(upstream);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/jpeg");
    expect(res.headers.get("cache-control")).toBe("private, max-age=3600");
    expect(res.headers.get("content-length")).toBe("4");
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(bytes);
  });

  test("un error 502 con texto plano se reenvía sin envolverlo en JSON", async () => {
    const upstream = new Response("Bad Gateway", {
      status: 502,
      headers: { "content-type": "text/plain" },
    });
    const res = await buildProxyResponse(upstream);
    expect(res.status).toBe(502);
    expect(await res.text()).toBe("Bad Gateway");
  });

  test("con content-encoding no se reenvía content-length (undici ya descomprimió el body)", async () => {
    const bytes = new Uint8Array([1, 2, 3, 4]);
    const upstream = new Response(bytes, {
      status: 200,
      headers: {
        "content-type": "image/jpeg",
        "content-encoding": "gzip",
        "content-length": "999", // tamaño comprimido original, ya no coincide con el body
      },
    });
    const res = await buildProxyResponse(upstream);
    expect(res.headers.get("content-length")).toBeNull();
  });
});

describe("isRefreshTokenExpiredOrMalformed", () => {
  test("un token sin 3 partes es inválido", () => {
    expect(isRefreshTokenExpiredOrMalformed("no-es-un-jwt")).toBe(true);
  });

  test("un token con payload no-JSON es inválido", () => {
    expect(isRefreshTokenExpiredOrMalformed("a.b.c")).toBe(true);
  });

  test("un token sin 'exp' se trata como inválido", () => {
    expect(isRefreshTokenExpiredOrMalformed(fakeJwt({ sub: "1" }))).toBe(true);
  });

  test("un token con 'exp' en el pasado está expirado", () => {
    const exp = Math.floor(Date.now() / 1000) - 60;
    expect(isRefreshTokenExpiredOrMalformed(fakeJwt({ exp }))).toBe(true);
  });

  test("un token con 'exp' en el futuro NO está expirado (no hay que borrar sus cookies)", () => {
    const exp = Math.floor(Date.now() / 1000) + 3600;
    expect(isRefreshTokenExpiredOrMalformed(fakeJwt({ exp }))).toBe(false);
  });
});

describe("classifyGatewayError", () => {
  test("un TimeoutError (AbortSignal.timeout) se traduce a 504", () => {
    const err = new DOMException("The operation timed out.", "TimeoutError");
    expect(classifyGatewayError(err)).toEqual({
      status: 504,
      detail: "El backend ha tardado demasiado en responder",
    });
  });

  test("un AbortError también se traduce a 504", () => {
    const err = new DOMException("The operation was aborted.", "AbortError");
    expect(classifyGatewayError(err).status).toBe(504);
  });

  test("cualquier otro fallo de red se traduce a 502", () => {
    expect(classifyGatewayError(new TypeError("fetch failed")).status).toBe(502);
    expect(classifyGatewayError("algo raro").status).toBe(502);
  });
});
