"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { BarcodeScanner } from "./BarcodeScanner";
import { ScanResult, type ScannedEntry } from "./ScanResult";

type Props = {
  mode: "diary" | "catalogue";
  addLabel?: string;
  onAdd?: (entry: ScannedEntry) => void;
};

/** El botón «Escanear», la cámara y el producto encontrado. La cámara (y ZXing, si hace falta) solo
 * se cargan al pulsar el botón. */
export function ScanFood({ mode, addLabel, onAdd }: Props) {
  const t = useTranslations("scanner");
  const [open, setOpen] = useState(false);
  const [code, setCode] = useState<string | null>(null);

  const start = () => {
    setCode(null);
    setOpen(true);
  };

  return (
    <>
      <button type="button" onClick={start} data-testid="scan-open"
        className="glass mt-3 flex w-full items-center justify-between gap-3 p-3.5 text-left">
        <span className="min-w-0">
          <span className="t-label block text-ink">{t("openLong")}</span>
          <span className="t-body text-[11px] text-muted">{t("openIntro")}</span>
        </span>
        <span aria-hidden className="shrink-0 text-lg text-neon">▥</span>
      </button>
      {open && (
        <BarcodeScanner
          onClose={() => setOpen(false)}
          onCode={(c) => {
            setOpen(false);
            setCode(c);
          }}
        />
      )}
      {code && (
        <ScanResult key={code} code={code} mode={mode} addLabel={addLabel} onAdd={onAdd} onRescan={start} onClose={() => setCode(null)} />
      )}
    </>
  );
}
