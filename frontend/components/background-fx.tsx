/**
 * Fondo animado estilo "aurora neón" (negro + ondas de luz azul).
 * Capa fija detrás de todo el contenido. Sin interacción.
 */
export function BackgroundFx() {
  return (
    <div className="bg-fx" aria-hidden="true">
      <div className="blob blob-1" />
      <div className="blob blob-2" />
      <div className="blob blob-3" />

      <svg
        className="waves"
        viewBox="0 0 1440 1024"
        preserveAspectRatio="xMidYMid slice"
        xmlns="http://www.w3.org/2000/svg"
      >
        <defs>
          <linearGradient id="waveGrad" x1="0" y1="0" x2="1440" y2="0" gradientUnits="userSpaceOnUse">
            <stop stopColor="#35e6ff" stopOpacity="0" />
            <stop offset="0.5" stopColor="#35e6ff" />
            <stop offset="1" stopColor="#2b6bff" stopOpacity="0" />
          </linearGradient>
          <filter id="waveBlur" x="-20%" y="-50%" width="140%" height="200%">
            <feGaussianBlur stdDeviation="5" />
          </filter>
        </defs>
        <g filter="url(#waveBlur)" fill="none" stroke="url(#waveGrad)" strokeWidth="2.5">
          <path className="wave-g wave-a" d="M-200 360 C 160 250, 420 470, 760 360 S 1320 250, 1700 360" />
          <path className="wave-g wave-b" d="M-200 520 C 220 430, 520 640, 880 520 S 1380 410, 1700 520" />
          <path className="wave-g wave-c" d="M-200 690 C 180 600, 480 800, 820 690 S 1340 590, 1700 690" />
        </g>
      </svg>

      <div className="grain" />
    </div>
  );
}
