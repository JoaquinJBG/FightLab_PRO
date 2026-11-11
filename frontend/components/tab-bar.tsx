"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import {
  HomeIcon,
  TrainingIcon,
  NutritionIcon,
  CoachIcon,
  ProfileIcon,
} from "./icons";
import { useKeyboardOpen } from "@/lib/viewport";

// "Hoy" es la primera pestaña y la pantalla de inicio (fase 11). El resumen de antes
// (/dashboard) se abre desde Hoy y cuenta como la misma pestaña.
const tabs = [
  { href: "/today", key: "today", Icon: HomeIcon, also: ["/dashboard"] },
  { href: "/training", key: "training", Icon: TrainingIcon },
  { href: "/nutrition", key: "nutrition", Icon: NutritionIcon },
  { href: "/coach", key: "coach", Icon: CoachIcon },
  { href: "/profile", key: "profile", Icon: ProfileIcon },
];

export function TabBar() {
  const t = useTranslations("nav");
  const pathname = usePathname();
  // Con el teclado abierto la barra no sube encima de él (F4): se esconde hasta que se cierra.
  // En horizontal (poca altura) va compacta, solo con los iconos (F21).
  const keyboardOpen = useKeyboardOpen();

  return (
    <nav
      data-testid="tab-bar"
      hidden={keyboardOpen}
      className={`fixed inset-x-0 bottom-0 z-40 justify-center ${keyboardOpen ? "hidden" : "flex"}`}
    >
      <div className="glass safe-bottom mx-3 mb-3 flex w-full max-w-md items-stretch justify-between gap-1 rounded-2xl px-2 pt-2 [@media(orientation:landscape)_and_(max-height:500px)]:mb-1 [@media(orientation:landscape)_and_(max-height:500px)]:pt-1 [@media(orientation:landscape)_and_(max-height:500px)]:pb-1">
        {tabs.map(({ href, key, Icon, also }) => {
          const active = [href, ...(also ?? [])].some((p) => pathname === p || pathname.startsWith(p + "/"));
          return (
            <Link
              key={href}
              href={href}
              aria-current={active ? "page" : undefined}
              aria-label={t(key)}
              className="group relative flex flex-1 cursor-pointer flex-col items-center gap-1 rounded-xl py-1.5 transition-colors [@media(orientation:landscape)_and_(max-height:500px)]:py-0.5"
            >
              <span
                className={`flex h-9 w-9 items-center justify-center rounded-xl transition-all [@media(orientation:landscape)_and_(max-height:500px)]:h-8 [@media(orientation:landscape)_and_(max-height:500px)]:w-8 ${
                  active
                    ? "text-neon glow bg-[rgba(53,230,255,0.08)]"
                    : "text-muted group-hover:text-ink"
                }`}
              >
                <Icon className="h-[22px] w-[22px]" />
              </span>
              <span
                className={`text-[10px] font-medium tracking-wide transition-colors [@media(orientation:landscape)_and_(max-height:500px)]:hidden ${
                  active ? "text-ink" : "text-muted"
                }`}
              >
                {t(key)}
              </span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
