"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  HomeIcon,
  TrainingIcon,
  NutritionIcon,
  CoachIcon,
  ProfileIcon,
} from "./icons";

const tabs = [
  { href: "/dashboard", label: "Inicio", Icon: HomeIcon },
  { href: "/training", label: "Entreno", Icon: TrainingIcon },
  { href: "/nutrition", label: "Nutrición", Icon: NutritionIcon },
  { href: "/coach", label: "Coach", Icon: CoachIcon },
  { href: "/profile", label: "Perfil", Icon: ProfileIcon },
];

export function TabBar() {
  const pathname = usePathname();

  return (
    <nav className="fixed inset-x-0 bottom-0 z-40 flex justify-center">
      <div className="glass safe-bottom mx-3 mb-3 flex w-full max-w-md items-stretch justify-between gap-1 rounded-2xl px-2 pt-2">
        {tabs.map(({ href, label, Icon }) => {
          const active = pathname === href || pathname.startsWith(href + "/");
          return (
            <Link
              key={href}
              href={href}
              aria-current={active ? "page" : undefined}
              className="group relative flex flex-1 cursor-pointer flex-col items-center gap-1 rounded-xl py-1.5 transition-colors"
            >
              <span
                className={`flex h-9 w-9 items-center justify-center rounded-xl transition-all ${
                  active
                    ? "text-neon glow bg-[rgba(53,230,255,0.08)]"
                    : "text-muted group-hover:text-ink"
                }`}
              >
                <Icon className="h-[22px] w-[22px]" />
              </span>
              <span
                className={`text-[10px] font-medium tracking-wide transition-colors ${
                  active ? "text-ink" : "text-muted"
                }`}
              >
                {label}
              </span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
