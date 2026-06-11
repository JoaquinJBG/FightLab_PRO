"use client";

import { Suspense, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { FOODS, scale, addItem, MEALS } from "@/lib/nutrition";

const PLATES = [
  { name: "Pollo con arroz y verduras", kcal: 520, p: 42, c: 55, f: 12 },
  { name: "Ensalada con atún", kcal: 310, p: 28, c: 14, f: 16 },
  { name: "Tostada de aguacate y huevo", kcal: 380, p: 16, c: 30, f: 22 },
  { name: "Bol de avena con plátano", kcal: 340, p: 12, c: 58, f: 8 },
];

function AddInner() {
  const router = useRouter();
  const qpMeal = useSearchParams().get("meal");
  const meal = MEALS.includes(qpMeal ?? "") ? (qpMeal as string) : "Comida";

  const [q, setQ] = useState("");
  const [sel, setSel] = useState<(typeof FOODS)[number] | null>(null);
  const [grams, setGrams] = useState(100);

  // foto mock
  const [analyzing, setAnalyzing] = useState(false);
  const [detected, setDetected] = useState<(typeof PLATES)[number] | null>(null);

  const results = FOODS.filter((f) => f.name.toLowerCase().includes(q.toLowerCase())).slice(0, 8);
  const scaled = sel ? scale(sel, grams) : null;

  function takePhoto() {
    setDetected(null);
    setAnalyzing(true);
    setTimeout(() => {
      setAnalyzing(false);
      setDetected(PLATES[Math.floor(Math.random() * PLATES.length)]);
    }, 1500);
  }

  function addFood() {
    if (!sel || !scaled) return;
    addItem({ meal, name: sel.name, grams, kcal: scaled.kcal, p: scaled.p, c: scaled.c, f: scaled.f });
    router.push("/nutrition");
  }
  function addPhoto() {
    if (!detected) return;
    addItem({ meal, name: detected.name, grams: null, kcal: detected.kcal, p: detected.p, c: detected.c, f: detected.f });
    router.push("/nutrition");
  }

  return (
    <div className="pt-4">
      <Link href="/nutrition" className="t-label text-muted">← Nutrición</Link>
      <h1 className="t-display mt-2 text-2xl text-ink">Añadir a <span className="neon-text">{meal}</span></h1>

      {/* Foto -> kcal */}
      <div className="glass neon-edge mt-4 p-4">
        <div className="flex items-center justify-between">
          <div>
            <p className="t-label text-ink">Foto → kcal</p>
            <p className="t-body text-xs text-muted">Haz una foto al plato y la IA lo estima.</p>
          </div>
          <button onClick={takePhoto} disabled={analyzing} className="btn btn-tonal btn-sm">📷 Hacer foto</button>
        </div>
        {analyzing && <p className="pulse t-body mt-3 text-sm text-muted">Analizando la foto…</p>}
        {detected && !analyzing && (
          <div className="mt-3 border-t border-[rgba(150,190,255,0.1)] pt-3">
            <p className="t-title text-ink">{detected.name}</p>
            <p className="t-body text-xs text-muted">~{detected.kcal} kcal · P {detected.p} · C {detected.c} · G {detected.f}</p>
            <span className="badge badge-neon mt-2">IA simulada</span>
            <button onClick={addPhoto} className="btn btn-primary mt-3 w-full">Añadir a {meal}</button>
          </div>
        )}
      </div>

      {/* Buscar alimento */}
      <div className="mt-5">
        <p className="t-eyebrow text-muted">Buscar alimento</p>
        <input value={q} onChange={(e) => { setQ(e.target.value); setSel(null); }} placeholder="Pollo, arroz, avena…" className="field mt-2 w-full px-4 py-3 text-sm" />

        {!sel ? (
          <div className="mt-3 flex flex-col gap-2">
            {results.map((f) => (
              <button key={f.name} onClick={() => { setSel(f); setGrams(100); }} className="glass flex items-center justify-between p-3.5 text-left">
                <span className="t-body text-ink">{f.name}</span>
                <span className="t-body text-xs text-muted">{f.kcal} kcal/100g</span>
              </button>
            ))}
            {results.length === 0 && <p className="t-body mt-2 text-xs text-muted">Sin resultados. Prueba otra búsqueda o usa la foto.</p>}
          </div>
        ) : (
          <div className="glass mt-3 p-4">
            <p className="t-title text-ink">{sel.name}</p>
            <div className="mt-3 flex items-center justify-between">
              <span className="t-label text-muted">Cantidad</span>
              <div className="flex items-center gap-3">
                <button onClick={() => setGrams((g) => Math.max(10, g - 10))} className="flex h-9 w-9 items-center justify-center rounded-full border border-[rgba(150,190,255,0.2)] text-xl text-ink active:scale-95">−</button>
                <span className="stat w-20 text-center text-lg text-ink">{grams} g</span>
                <button onClick={() => setGrams((g) => Math.min(1000, g + 10))} className="flex h-9 w-9 items-center justify-center rounded-full border border-[rgba(150,190,255,0.2)] text-xl text-ink active:scale-95">+</button>
              </div>
            </div>
            <p className="t-body mt-3 text-center text-sm text-neon">{scaled?.kcal} kcal · P {scaled?.p} · C {scaled?.c} · G {scaled?.f}</p>
            <div className="mt-3 flex gap-2">
              <button onClick={() => setSel(null)} className="btn btn-outline btn-sm flex-1">Volver</button>
              <button onClick={addFood} className="btn btn-primary btn-sm flex-1">Añadir a {meal}</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default function AddFoodPage() {
  return (
    <Suspense fallback={<div className="pt-6 text-center"><p className="t-body text-muted">Cargando…</p></div>}>
      <AddInner />
    </Suspense>
  );
}
