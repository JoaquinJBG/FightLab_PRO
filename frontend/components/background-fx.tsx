import { NebulaCanvas } from "./nebula-canvas";

/**
 * Fondo "Neural" estilo Google Stitch: negro + nebulosa azul→violeta→magenta
 * que FLUYE (shader WebGL) con rejilla de puntos ("ola de partículas").
 * Las capas .neb son el fallback CSS si el dispositivo no soporta WebGL.
 */
export function BackgroundFx() {
  return (
    <div className="bg-fx" aria-hidden="true">
      {/* Fallback CSS (queda detrás del canvas cuando WebGL funciona) */}
      <div className="neb neb-l1" />
      <div className="neb neb-l2" />
      <div className="neb neb-l3" />
      <div className="neb neb-r1" />
      <div className="neb neb-r2" />
      <div className="neb neb-r3" />

      {/* Nebulosa fluida (WebGL) */}
      <NebulaCanvas />

      {/* Partículas + viñeta por encima */}
      <div className="dots" />
      <div className="vignette" />
    </div>
  );
}
