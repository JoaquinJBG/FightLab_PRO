"use client";

import { useEffect, useRef } from "react";

/**
 * Nebulosa fluida en WebGL (estilo Google Stitch): ruido fractal con
 * deformación de dominio (domain warping) que fluye continuamente, mapeado a
 * una paleta azul → violeta → magenta y concentrado en los laterales.
 * Render a baja resolución (la nebulosa es difusa) para ir ligero en móvil.
 * Si WebGL no está disponible, no pinta nada y queda el fallback CSS de detrás.
 */
const FRAG = `
precision highp float;
uniform vec2 uRes;
uniform float uTime;

float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 p){
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  float a = hash(i), b = hash(i + vec2(1.0, 0.0));
  float c = hash(i + vec2(0.0, 1.0)), d = hash(i + vec2(1.0, 1.0));
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}
float fbm(vec2 p){
  float v = 0.0, a = 0.5;
  for (int i = 0; i < 5; i++) { v += a * noise(p); p *= 2.03; a *= 0.5; }
  return v;
}

void main(){
  vec2 uv = gl_FragCoord.xy / uRes.xy;
  vec2 p = uv;
  p.x *= uRes.x / uRes.y;          // corrige aspecto
  float t = uTime * 0.06;

  // Domain warping para un flujo orgánico
  vec2 q = vec2(fbm(p * 1.6 + vec2(0.0, t)), fbm(p * 1.6 + vec2(5.2, 1.3) + vec2(t, 0.0)));
  vec2 r = vec2(fbm(p * 1.6 + 3.0 * q + vec2(1.7, 9.2) + t * 0.7),
                fbm(p * 1.6 + 3.0 * q + vec2(8.3, 2.8) - t * 0.6));
  float f = fbm(p * 1.6 + 3.2 * r);
  f = clamp(f * 1.25, 0.0, 1.0);

  // Paleta azul -> violeta -> magenta
  vec3 blue   = vec3(0.16, 0.40, 1.00);
  vec3 violet = vec3(0.52, 0.26, 1.00);
  vec3 magenta= vec3(0.78, 0.28, 1.00);
  vec3 col = mix(blue, violet, smoothstep(0.30, 0.65, f));
  col = mix(col, magenta, smoothstep(0.62, 0.92, f));

  // Intensidad: concentrar en los laterales y suavizar arriba/abajo
  float sides = pow(abs(uv.x - 0.5) * 2.0, 1.35);
  float vert  = smoothstep(0.05, 0.5, uv.y) * (1.0 - smoothstep(0.6, 1.05, uv.y));
  float intensity = pow(f, 1.6) * (0.35 + 0.95 * sides) * (0.55 + 0.55 * vert);

  vec3 base = vec3(0.020, 0.024, 0.043);  // negro azulado
  vec3 outc = base + col * intensity * 1.45;

  gl_FragColor = vec4(outc, 1.0);
}
`;

const VERT = `
attribute vec2 p;
void main(){ gl_Position = vec4(p, 0.0, 1.0); }
`;

function compile(gl: WebGLRenderingContext, type: number, src: string) {
  const sh = gl.createShader(type);
  if (!sh) return null;
  gl.shaderSource(sh, src);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
    gl.deleteShader(sh);
    return null;
  }
  return sh;
}

export function NebulaCanvas() {
  const ref = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const gl = canvas.getContext("webgl", { antialias: false, alpha: false });
    if (!gl) return;

    const vs = compile(gl, gl.VERTEX_SHADER, VERT);
    const fs = compile(gl, gl.FRAGMENT_SHADER, FRAG);
    if (!vs || !fs) return;

    const prog = gl.createProgram();
    gl.attachShader(prog, vs);
    gl.attachShader(prog, fs);
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) return;
    gl.useProgram(prog);

    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(prog, "p");
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);

    const uRes = gl.getUniformLocation(prog, "uRes");
    const uTime = gl.getUniformLocation(prog, "uTime");

    const SCALE = 0.6; // render a baja resolución (nebulosa difusa => barato)
    const resize = () => {
      const w = Math.max(1, Math.floor(window.innerWidth * SCALE));
      const h = Math.max(1, Math.floor(window.innerHeight * SCALE));
      canvas.width = w;
      canvas.height = h;
      gl.viewport(0, 0, w, h);
    };
    resize();
    window.addEventListener("resize", resize);

    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let raf = 0;
    let start = 0;
    const render = (ts: number) => {
      if (!start) start = ts;
      const t = reduce ? 12 : (ts - start) / 1000;
      gl.uniform2f(uRes, canvas.width, canvas.height);
      gl.uniform1f(uTime, t);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      if (!reduce) raf = requestAnimationFrame(render);
    };
    raf = requestAnimationFrame(render);

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", resize);
      const ext = gl.getExtension("WEBGL_lose_context");
      ext?.loseContext();
    };
  }, []);

  return <canvas ref={ref} className="neb-canvas" aria-hidden="true" />;
}
