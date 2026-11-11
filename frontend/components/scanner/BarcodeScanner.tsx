"use client";

import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { cameraErrorKind, normalizeBarcode, startScanner, type CameraError, type Scanner } from "@/lib/barcode";

type Props = {
  /** Un código válido (EAN-13, EAN-8, UPC-A o UPC-E ya expandido). */
  onCode: (code: string) => void;
  onClose: () => void;
};

/** La cámara trasera a pantalla completa con el marco, la linterna (si la hay) y el código a mano.
 * Al leer un código se cierra la cámara y se avisa una sola vez. */
export function BarcodeScanner({ onCode, onClose }: Props) {
  const t = useTranslations("scanner");
  const videoRef = useRef<HTMLVideoElement>(null);
  const scannerRef = useRef<Scanner | null>(null);
  const doneRef = useRef(false);
  const onCodeRef = useRef(onCode);
  const [phase, setPhase] = useState<"starting" | "scanning" | "error">("starting");
  const [error, setError] = useState<CameraError | null>(null);
  const [engine, setEngine] = useState<Scanner["engine"] | null>(null);
  const [torch, setTorch] = useState<{ available: boolean; on: boolean }>({ available: false, on: false });
  const [manual, setManual] = useState("");
  const [manualError, setManualError] = useState(false);

  useEffect(() => {
    onCodeRef.current = onCode;
  }, [onCode]);

  function finish(code: string) {
    if (doneRef.current) return;
    doneRef.current = true;
    scannerRef.current?.stop();
    onCodeRef.current(code);
  }

  useEffect(() => {
    let cancelled = false;
    const video = videoRef.current;
    if (!video) return;
    const done = (code: string) => {
      if (doneRef.current) return;
      doneRef.current = true;
      scannerRef.current?.stop();
      onCodeRef.current(code);
    };
    startScanner(video, done)
      .then((s) => {
        if (cancelled) {
          s.stop();
          return;
        }
        scannerRef.current = s;
        setEngine(s.engine);
        setTorch({ available: s.torch, on: false });
        setPhase("scanning");
      })
      .catch((err) => {
        if (cancelled) return;
        setError(cameraErrorKind(err));
        setPhase("error");
      });
    return () => {
      cancelled = true;
      scannerRef.current?.stop();
      scannerRef.current = null;
    };
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  async function toggleTorch() {
    const s = scannerRef.current;
    if (!s) return;
    const on = await s.setTorch(!torch.on);
    setTorch((cur) => ({ ...cur, on }));
  }

  function submitManual(e: React.FormEvent) {
    e.preventDefault();
    const code = normalizeBarcode(manual);
    if (!code) {
      setManualError(true);
      return;
    }
    finish(code);
  }

  return (
    <div role="dialog" aria-modal="true" aria-label={t("title")} data-testid="scanner"
      className="fixed inset-0 z-50 flex flex-col bg-[rgba(3,8,18,0.96)] px-4 pb-4 pt-[max(1rem,env(safe-area-inset-top))]">
      <div className="flex items-center justify-between">
        <p className="t-title text-ink">{t("title")}</p>
        <button type="button" onClick={onClose} aria-label={t("close")} data-testid="scanner-close"
          className="flex h-10 w-10 items-center justify-center rounded-full border border-[rgba(150,190,255,0.2)] text-ink">✕</button>
      </div>

      <div className="relative mt-3 w-full overflow-hidden rounded-2xl bg-black" style={{ aspectRatio: "4 / 3", maxHeight: "45vh" }}>
        <video ref={videoRef} data-testid="scanner-video" muted playsInline autoPlay className="h-full w-full object-cover" />
        {phase === "scanning" && (
          <div aria-hidden className="pointer-events-none absolute inset-x-[10%] top-1/2 h-[38%] -translate-y-1/2 rounded-xl border-2 border-neon" />
        )}
        {phase === "starting" && (
          <p className="t-body absolute inset-0 flex items-center justify-center text-sm text-muted">{t("starting")}</p>
        )}
      </div>

      {phase === "scanning" && (
        <div className="mt-3 flex items-center justify-between gap-2">
          <p className="t-body text-xs text-muted" data-testid="scanner-engine" data-engine={engine ?? ""}>
            {t("aim")}{engine === "zxing" ? ` ${t("engineZxing")}` : ""}
          </p>
          {torch.available && (
            <button type="button" onClick={toggleTorch} aria-pressed={torch.on} data-testid="scanner-torch"
              className="btn btn-tonal btn-sm shrink-0">
              {torch.on ? t("torchOff") : t("torchOn")}
            </button>
          )}
        </div>
      )}
      {phase === "error" && error && (
        <p role="alert" data-testid="scanner-error" data-kind={error} className="t-body mt-3 text-sm text-warn">
          {t(`errors.${error}`)}
        </p>
      )}

      <form onSubmit={submitManual} className="glass mt-4 p-3">
        <label htmlFor="scanner-manual" className="t-label text-ink">{t("manualTitle")}</label>
        <div className="mt-2 flex gap-2">
          <input id="scanner-manual" data-testid="scanner-manual" value={manual} inputMode="numeric" autoComplete="off"
            aria-label={t("manualLabel")} placeholder={t("manualPlaceholder")} maxLength={14}
            onChange={(e) => { setManual(e.target.value.replace(/\D/g, "").slice(0, 14)); setManualError(false); }}
            className="field min-w-0 flex-1 px-3 py-2.5 text-sm" />
          <button type="submit" disabled={manual.length < 8} data-testid="scanner-manual-go"
            className="btn btn-primary btn-sm shrink-0 disabled:opacity-60">{t("manualGo")}</button>
        </div>
        {manualError && <p role="alert" className="t-body mt-2 text-xs text-bad">{t("manualInvalid")}</p>}
      </form>
    </div>
  );
}
