/**
 * Fondo "Neural" estilo Google Stitch: negro + nebulosa azul→violeta→magenta
 * que fluye desde los lados, con rejilla de puntos ("ola de partículas").
 * Capa fija detrás de todo el contenido. Sin interacción.
 */
export function BackgroundFx() {
  return (
    <div className="bg-fx" aria-hidden="true">
      <div className="neb neb-l1" />
      <div className="neb neb-l2" />
      <div className="neb neb-l3" />
      <div className="neb neb-r1" />
      <div className="neb neb-r2" />
      <div className="neb neb-r3" />
      <div className="dots" />
      <div className="vignette" />
    </div>
  );
}
