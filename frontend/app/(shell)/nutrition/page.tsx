"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useProfile, useBiometrics } from "@/lib/hooks";
import { MEALS, GOAL_LABEL, loadToday, loadGoal, saveGoal, targets, type Goal, type Item } from "@/lib/nutrition";
import { NutritionIcon, ScaleIcon, ChevronRight } from "@/components/icons";

function ageFrom(dob: string | null): number {
  if (!dob) return 30;
  const d = new Date(dob);
  const now = new Date();
  let a = now.getFullYear() - d.getFullYear();
  if (now.getMonth() < d.getMonth() || (now.getMonth() === d.getMonth() && now.getDate() < d.getDate())) a--;
  return a > 0 && a < 120 ? a : 30;
}

function Bar({ label, val, target, color }: { label: string; val: number; target: number; color: string }) {
  const pct = target > 0 ? Math.min(100, (val / target) * 100) : 0;
  return (
    <div>
      <div className="flex justify-between">
        <span className="t-label text-muted">{label}</span>
        <span className="t-body text-xs text-ink">{val}/{target} g</span>
      </div>
      <div className="mt-1 h-2 rounded-full bg-[rgba(150,190,255,0.12)]">
        <div className="h-2 rounded-full transition-all" style={{ width: `${pct}%`, background: color }} />
      </div>
    </div>
  );
}

export default function NutritionPage() {
  const { data: profile } = useProfile();
  const { data: logs = [] } = useBiometrics();
  const [goal, setGoal] = useState<Goal>("mantener");
  const [items, setItems] = useState<Item[]>([]);
  const [weigh, setWeigh] = useState<{ target: number; date: string } | null>(null);

  useEffect(() => {
    setGoal(loadGoal());
    setItems(loadToday());
    try { const w = localStorage.getItem("flp_weigh"); if (w) setWeigh(JSON.parse(w)); } catch { /* noop */ }
  }, []);

  const weight = (() => { for (const l of logs) { const w = l.weight_kg ? parseFloat(l.weight_kg) : null; if (w) return w; } return 75; })();
  const t = targets(weight, profile?.height_cm ?? 175, ageFrom(profile?.date_of_birth ?? null), profile?.gender ?? null, goal);

  const sum = items.reduce((a, i) => ({ kcal: a.kcal + i.kcal, p: a.p + i.p, c: a.c + i.c, f: a.f + i.f }), { kcal: 0, p: 0, c: 0, f: 0 });
  const remaining = t.kcal - sum.kcal;
  const kcalPct = t.kcal > 0 ? Math.min(100, (sum.kcal / t.kcal) * 100) : 0;

  function changeGoal(g: Goal) { setGoal(g); saveGoal(g); }

  return (
    <div className="pt-4">
      <div className="flex items-center gap-2">
        <span className="text-neon"><NutritionIcon className="h-6 w-6" /></span>
        <h1 className="t-display text-2xl text-ink">Nutrición</h1>
      </div>

      {/* Progreso de hoy */}
      <section className="glass neon-edge mt-4 p-5">
        <div className="flex items-end justify-between">
          <div>
            <p className="t-eyebrow text-muted">Hoy</p>
            <p className="stat mt-1 text-4xl text-ink">{sum.kcal}<span className="text-base text-muted"> / {t.kcal} kcal</span></p>
          </div>
          <div className="text-right">
            <p className={`stat text-2xl ${remaining < 0 ? "text-bad" : "neon-text"}`}>{remaining}</p>
            <p className="t-label text-muted">restantes</p>
          </div>
        </div>
        <div className="mt-3 h-2.5 rounded-full bg-[rgba(150,190,255,0.12)]">
          <div className="h-2.5 rounded-full" style={{ width: `${kcalPct}%`, background: "linear-gradient(90deg,#45e9ff,#3b74ff)" }} />
        </div>
        <div className="mt-4 grid grid-cols-3 gap-3">
          <Bar label="Proteína" val={sum.p} target={t.p} color="#45e9ff" />
          <Bar label="Carbos" val={sum.c} target={t.c} color="#7b5cff" />
          <Bar label="Grasa" val={sum.f} target={t.f} color="#ffd25a" />
        </div>
      </section>

      {/* Objetivo */}
      <div className="glass mt-4 grid grid-cols-3 gap-1 rounded-2xl p-1">
        {(["perder", "mantener", "ganar"] as Goal[]).map((g) => (
          <button key={g} onClick={() => changeGoal(g)} className="rounded-xl py-2.5 text-sm font-medium transition-colors"
            style={goal === g ? { background: "linear-gradient(180deg,#45e9ff,#3b74ff)", color: "#03101c" } : { background: "transparent", color: "var(--color-muted)" }}>
            {GOAL_LABEL[g]}
          </button>
        ))}
      </div>
      <p className="t-body mt-2 text-xs text-muted">Objetivos calculados de tu perfil (peso, altura, edad). Edítalos a futuro.</p>

      {/* Comidas */}
      <div className="mt-5 flex flex-col gap-3">
        {MEALS.map((meal) => {
          const its = items.filter((i) => i.meal === meal);
          const k = its.reduce((a, i) => a + i.kcal, 0);
          return (
            <div key={meal} className="glass p-4">
              <div className="flex items-center justify-between">
                <p className="t-title text-ink">{meal}</p>
                <div className="flex items-center gap-3">
                  <span className="t-label text-muted">{k} kcal</span>
                  <Link href={`/nutrition/add?meal=${encodeURIComponent(meal)}`} aria-label={`Añadir a ${meal}`}
                    className="flex h-8 w-8 items-center justify-center rounded-full btn-neon" style={{ borderRadius: "9999px" }}>+</Link>
                </div>
              </div>
              {its.length > 0 && (
                <ul className="mt-3 flex flex-col gap-1.5 border-t border-[rgba(150,190,255,0.1)] pt-3">
                  {its.map((i) => (
                    <li key={i.id} className="flex justify-between text-sm">
                      <span className="t-body text-muted">{i.name}{i.grams ? ` · ${i.grams} g` : ""}</span>
                      <span className="text-ink">{i.kcal} kcal</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          );
        })}
      </div>

      {/* Pesaje */}
      <Link href="/nutrition/weigh-in" className="glass rise mt-5 flex items-center gap-3 p-4">
        <span className="text-neon"><ScaleIcon className="h-5 w-5" /></span>
        <div className="flex-1">
          <p className="t-label text-ink">Pesaje</p>
          <p className="t-body text-xs text-muted">
            {weigh ? `Objetivo ${weigh.target} kg · ${weight} kg ahora` : "Configura tu peso objetivo y fecha"}
          </p>
        </div>
        <ChevronRight className="h-5 w-5 text-muted" />
      </Link>
    </div>
  );
}
