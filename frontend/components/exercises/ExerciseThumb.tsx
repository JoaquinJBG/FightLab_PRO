"use client";

import type { SVGProps } from "react";
import { GloveIcon, RunIcon, TrainingIcon } from "@/components/icons";
import type { Exercise } from "@/lib/exercises";

type ThumbExercise = Pick<Exercise, "images" | "category"> | null | undefined;

const iconBase = {
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.8,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
};

/** Figura estirándose: el icono genérico de la movilidad. */
function StretchIcon(p: SVGProps<SVGSVGElement>) {
  return (
    <svg {...iconBase} {...p}>
      <circle cx="12" cy="4.5" r="1.6" />
      <path d="M12 6.5v6l-4 7M12 12.5l4 7M5 9l7-1 7-3" />
    </svg>
  );
}

const ICONS = { strength: TrainingIcon, combat: GloveIcon, cardio: RunIcon, mobility: StretchIcon } as const;

/** Icono genérico de un ejercicio sin imagen (los propios, el combate y parte de la movilidad). */
export function ExerciseIcon({ category, className }: { category?: string; className?: string }) {
  const Icon = ICONS[(category ?? "strength") as keyof typeof ICONS] ?? TrainingIcon;
  return <Icon aria-hidden="true" className={className} />;
}

/**
 * Miniatura de un ejercicio: el primer fotograma de su imagen o, si no tiene, un icono genérico
 * según su tipo. Es decorativa (`alt=""`): el nombre va siempre al lado.
 */
export function ExerciseThumb({
  exercise,
  size = 44,
  className = "",
}: {
  exercise: ThumbExercise;
  size?: number;
  className?: string;
}) {
  const img = exercise?.images[0];
  const box = `flex shrink-0 items-center justify-center overflow-hidden rounded-xl ${className}`;
  if (img) {
    return (
      <span className={`${box} bg-[#f4f7fb]`} style={{ width: size, height: size }} data-testid="exercise-thumb-image">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={img.url} alt="" loading="lazy" decoding="async" width={size} height={size}
          className="h-full w-full object-contain" />
      </span>
    );
  }
  return (
    <span className={`${box} bg-[rgba(69,233,255,0.07)] text-neon`} style={{ width: size, height: size }}
      data-testid="exercise-thumb-icon">
      <ExerciseIcon category={exercise?.category} className="h-1/2 w-1/2" />
    </span>
  );
}
