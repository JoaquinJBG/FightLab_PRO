"use client";

import { useRef, useState, type ReactNode } from "react";
import { useTranslations } from "next-intl";
import { move } from "@/lib/routines";

export type ReorderControls = {
  /** El asa para arrastrar (con el dedo o el ratón). */
  handle: ReactNode;
  /** Botones «subir» y «bajar»: la alternativa accesible al arrastre. */
  buttons: ReactNode;
  dragging: boolean;
};

type Props<T> = {
  items: T[];
  getKey: (item: T) => string | number;
  /** Nombre del elemento para los botones («Subir Press banca»). */
  label: (item: T) => string;
  onReorder: (next: T[], from: number, to: number) => void;
  render: (item: T, index: number, controls: ReorderControls) => ReactNode;
  testId?: string;
  className?: string;
};

/** Lista que se reordena arrastrando por el asa (eventos de puntero: funciona con el dedo en el
 * móvil, donde el drag and drop de HTML no existe) o con los botones subir/bajar. */
export function ReorderList<T>({ items, getKey, label, onReorder, render, testId, className }: Props<T>) {
  const t = useTranslations("routines.reorder");
  const refs = useRef<(HTMLLIElement | null)[]>([]);
  const [drag, setDrag] = useState<{ from: number; y0: number; dy: number; to: number } | null>(null);

  const targetFor = (from: number, y: number) => {
    let to = from;
    refs.current.forEach((el, i) => {
      if (!el || i === from) return;
      const r = el.getBoundingClientRect();
      const mid = r.top + r.height / 2;
      if (i < from && y < mid) to = Math.min(to, i);
      if (i > from && y > mid) to = Math.max(to, i);
    });
    return to;
  };

  const handleFor = (i: number, item: T) => (
    <button
      type="button"
      data-testid="drag-handle"
      aria-label={t("drag", { name: label(item) })}
      className="flex h-9 w-7 shrink-0 cursor-grab touch-none items-center justify-center text-muted active:cursor-grabbing"
      onPointerDown={(e) => {
        e.currentTarget.setPointerCapture?.(e.pointerId);
        setDrag({ from: i, y0: e.clientY, dy: 0, to: i });
      }}
      onPointerMove={(e) => {
        if (!drag || drag.from !== i) return;
        setDrag({ ...drag, dy: e.clientY - drag.y0, to: targetFor(i, e.clientY) });
      }}
      onPointerUp={() => {
        if (drag && drag.from === i && drag.to !== i) onReorder(move(items, i, drag.to), i, drag.to);
        setDrag(null);
      }}
      onPointerCancel={() => setDrag(null)}
    >
      <svg viewBox="0 0 12 20" className="h-5 w-3" aria-hidden fill="currentColor">
        {[3, 10, 17].map((y) => (
          <g key={y}>
            <circle cx="3" cy={y} r="1.6" />
            <circle cx="9" cy={y} r="1.6" />
          </g>
        ))}
      </svg>
    </button>
  );

  const buttonsFor = (i: number, item: T) => (
    <span className="flex shrink-0 gap-1">
      <button
        type="button"
        className="btn btn-outline btn-sm !px-2"
        aria-label={t("up", { name: label(item) })}
        disabled={i === 0}
        onClick={() => onReorder(move(items, i, i - 1), i, i - 1)}
      >
        ↑
      </button>
      <button
        type="button"
        className="btn btn-outline btn-sm !px-2"
        aria-label={t("down", { name: label(item) })}
        disabled={i === items.length - 1}
        onClick={() => onReorder(move(items, i, i + 1), i, i + 1)}
      >
        ↓
      </button>
    </span>
  );

  return (
    <ul data-testid={testId} className={className ?? "flex flex-col gap-3"}>
      {items.map((item, i) => {
        const dragging = drag?.from === i;
        const showLine = drag && drag.to === i && drag.from !== i;
        return (
          <li
            key={getKey(item)}
            ref={(el) => {
              refs.current[i] = el;
            }}
            className="relative"
            style={dragging ? { transform: `translateY(${drag.dy}px)`, zIndex: 10, opacity: 0.9 } : undefined}
          >
            {showLine && (
              <span
                aria-hidden
                className={`absolute inset-x-0 h-0.5 rounded bg-[var(--color-neon)] ${drag.to < drag.from ? "-top-2" : "-bottom-2"}`}
              />
            )}
            {render(item, i, { handle: handleFor(i, item), buttons: buttonsFor(i, item), dragging })}
          </li>
        );
      })}
    </ul>
  );
}
