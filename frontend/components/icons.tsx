import type { SVGProps } from "react";

type IconProps = SVGProps<SVGSVGElement>;

const base = {
  width: 24,
  height: 24,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.8,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
};

export function HomeIcon(p: IconProps) {
  return (
    <svg {...base} {...p}>
      <path d="M3 10.5 12 4l9 6.5" />
      <path d="M5 9.5V20h14V9.5" />
      <path d="M9.5 20v-5h5v5" />
    </svg>
  );
}

export function TrainingIcon(p: IconProps) {
  return (
    <svg {...base} {...p}>
      <path d="M6.5 8.5v7M17.5 8.5v7" />
      <path d="M4 10.5v3M20 10.5v3" />
      <path d="M6.5 12h11" />
    </svg>
  );
}

export function NutritionIcon(p: IconProps) {
  return (
    <svg {...base} {...p}>
      <path d="M12 8c-2.5-3-7-2.5-7 2.5C5 16 9 20 12 20s7-4 7-9.5C19 5.5 14.5 5 12 8Z" />
      <path d="M12 8c0-2 .8-3.4 2.4-4.2" />
    </svg>
  );
}

export function CoachIcon(p: IconProps) {
  return (
    <svg {...base} {...p}>
      <path d="M12 3.5l1.9 4.6 4.6 1.9-4.6 1.9L12 16.5l-1.9-4.6L5.5 10l4.6-1.9L12 3.5Z" />
      <path d="M18.5 16.5l.7 1.8 1.8.7-1.8.7-.7 1.8-.7-1.8-1.8-.7 1.8-.7.7-1.8Z" />
    </svg>
  );
}

export function ProfileIcon(p: IconProps) {
  return (
    <svg {...base} {...p}>
      <circle cx="12" cy="8" r="3.4" />
      <path d="M5.5 19.5a6.5 6.5 0 0 1 13 0" />
    </svg>
  );
}

export function ScaleIcon(p: IconProps) {
  return (
    <svg {...base} {...p}>
      <rect x="4" y="4" width="16" height="16" rx="4" />
      <path d="M8.5 9h7" />
      <path d="M12 9v3.5" />
    </svg>
  );
}

export function MoonIcon(p: IconProps) {
  return (
    <svg {...base} {...p}>
      <path d="M20 14.5A8 8 0 1 1 9.5 4 6.5 6.5 0 0 0 20 14.5Z" />
    </svg>
  );
}

export function HeartIcon(p: IconProps) {
  return (
    <svg {...base} {...p}>
      <path d="M12 20s-7-4.3-7-9.4A3.6 3.6 0 0 1 12 7.7a3.6 3.6 0 0 1 7 2.9C19 15.7 12 20 12 20Z" />
    </svg>
  );
}

export function PulseIcon(p: IconProps) {
  return (
    <svg {...base} {...p}>
      <path d="M3 12h3l2-5 4 10 2-5h7" />
    </svg>
  );
}

export function BoltIcon(p: IconProps) {
  return (
    <svg {...base} {...p}>
      <path d="M13 3 5 13h5l-1 8 8-10h-5l1-8Z" />
    </svg>
  );
}

export function InfoIcon(p: IconProps) {
  return (
    <svg {...base} {...p}>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 11v5" />
      <path d="M12 7.6v.4" />
    </svg>
  );
}

export function ChevronDown(p: IconProps) {
  return (
    <svg {...base} {...p}>
      <path d="M6 9l6 6 6-6" />
    </svg>
  );
}

export function ChevronRight(p: IconProps) {
  return (
    <svg {...base} {...p}>
      <path d="M9 6l6 6-6 6" />
    </svg>
  );
}

export function RunIcon(p: IconProps) {
  return (
    <svg {...base} {...p}>
      <circle cx="15" cy="4.5" r="1.6" />
      <path d="M8 21l2.5-5 3-2-1-5" />
      <path d="M6.5 10.5 11 8l3 2.5 3 1" />
      <path d="M13.5 13.5 16 21" />
    </svg>
  );
}

export function GloveIcon(p: IconProps) {
  return (
    <svg {...base} {...p}>
      <path d="M7 11V7.5a2 2 0 0 1 4 0V11" />
      <path d="M11 9.5a2 2 0 0 1 4 0V11" />
      <path d="M6 11h10v3a4 4 0 0 1-4 4H9a3 3 0 0 1-3-3v-4Z" />
      <path d="M6 13.5H4.5a1.5 1.5 0 0 1 0-3H6" />
    </svg>
  );
}

export function ClipboardIcon(p: IconProps) {
  return (
    <svg {...base} {...p}>
      <rect x="5" y="4.5" width="14" height="16" rx="2.5" />
      <path d="M9 4.5a1.5 1.5 0 0 1 1.5-1.5h3A1.5 1.5 0 0 1 15 4.5V6H9V4.5Z" />
      <path d="M8.5 11h7M8.5 15h5" />
    </svg>
  );
}

export function TimerIcon(p: IconProps) {
  return (
    <svg {...base} {...p}>
      <circle cx="12" cy="13.5" r="6.5" />
      <path d="M12 13.5V10" />
      <path d="M9.5 3h5" />
      <path d="M12 3v2.5" />
    </svg>
  );
}

export function ArrowUpRight(p: IconProps) {
  return (
    <svg {...base} {...p}>
      <path d="M7 17 17 7" />
      <path d="M8 7h9v9" />
    </svg>
  );
}
