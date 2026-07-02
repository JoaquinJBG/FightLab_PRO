"use client";

import { Suspense, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import {
  FOODS,
  MEALS,
  addItem,
  recentFoods,
  scale,
  yesterdayMealItems,
  type Item,
} from "@/lib/nutrition";

/* Foto → lista de alimentos detectados. Con la IA configurada analiza la foto real
   (Claude visión); si no, cae a un ejemplo simulado claramente marcado.
   Cada componente lleva su base para reescalar al editar los gramos. */
type Detected = { name: string; grams: number | null; kcal: number; p: number; c: number; f: number };

/* Reescala la foto en el dispositivo (≤1280 px, JPEG) antes de subirla:
   menos datos, más rápido y dentro de los límites de la API de visión. */
async function toJpeg(file: File): Promise<Blob> {
  try {
    const bmp = await createImageBitmap(file);
    const MAX = 1280;
    const k = Math.min(1, MAX / Math.max(bmp.width, bmp.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(bmp.width * k));
    canvas.height = Math.max(1, Math.round(bmp.height * k));
    canvas.getContext("2d")!.drawImage(bmp, 0, 0, canvas.width, canvas.height);
    bmp.close();
    return await new Promise((res, rej) =>
      canvas.toBlob((b) => (b ? res(b) : rej(new Error("blob"))), "image/jpeg", 0.85),
    );
  } catch {
    return file; // formato que el navegador no decodifica: que lo valide el backend
  }
}

function fromFood(name: string, grams: number): Detected {
  const food = FOODS.find((f) => f.name === name);
  if (!food) return { name, grams, kcal: 0, p: 0, c: 0, f: 0 };
  return { name, grams, ...scale(food, grams) };
}
const PHOTO_PLATES: { name: string; items: Detected[] }[] = [
  {
    name: "Pollo con arroz y verduras",
    items: [fromFood("Pechuga de pollo", 150), fromFood("Arroz blanco cocido", 200), { name: "Verduras salteadas", grams: 120, kcal: 80, p: 2, c: 9, f: 4 }],
  },
  {
    name: "Ensalada con atún",
    items: [fromFood("Atún en lata", 80), { name: "Ensalada mixta", grams: 150, kcal: 35, p: 2, c: 6, f: 0 }, { name: "Aceite de oliva", grams: 10, kcal: 90, p: 0, c: 0, f: 10 }],
  },
  {
    name: "Tostada de aguacate y huevo",
    items: [fromFood("Pan integral", 60), fromFood("Aguacate", 50), fromFood("Huevo", 60)],
  },
  {
    name: "Bol de avena con plátano",
    items: [fromFood("Avena", 60), fromFood("Plátano", 120), fromFood("Yogur natural", 125)],
  },
];

type Mode = "recientes" | "buscar" | "rapido";

function AddInner() {
  const router = useRouter();
  const qpMeal = useSearchParams().get("meal");
  const meal = MEALS.includes(qpMeal ?? "") ? (qpMeal as string) : "Comida";

  const [recents, setRecents] = useState<Omit<Item, "id" | "meal">[]>([]);
  const [yesterday, setYesterday] = useState<Item[]>([]);
  const [mode, setMode] = useState<Mode>("buscar");
  const [addedFlash, setAddedFlash] = useState<string | null>(null);
  const [saving, setSaving] = useState(false); // anti doble-toque en acciones que añaden y navegan

  useEffect(() => {
    const r = recentFoods();
    setRecents(r);
    setYesterday(yesterdayMealItems(meal));
    if (r.length > 0) setMode("recientes");
  }, [meal]);

  function flash(name: string) {
    setAddedFlash(name);
    // solo apaga el ✓ si sigue siendo el de este alimento (evita la carrera entre taps)
    setTimeout(() => setAddedFlash((cur) => (cur === name ? null : cur)), 1200);
  }

  /* ---- buscar ---- */
  const [q, setQ] = useState("");
  const [sel, setSel] = useState<(typeof FOODS)[number] | null>(null);
  const [grams, setGrams] = useState(100);
  const results = FOODS.filter((f) => f.name.toLowerCase().includes(q.toLowerCase())).slice(0, 8);
  const scaled = sel ? scale(sel, grams) : null;

  function addFood() {
    if (!sel || !scaled || saving) return;
    setSaving(true);
    addItem({ meal, name: sel.name, grams, kcal: scaled.kcal, p: scaled.p, c: scaled.c, f: scaled.f });
    router.push("/nutrition");
  }

  /* ---- rápido ---- */
  const [qName, setQName] = useState("");
  const [qKcal, setQKcal] = useState("");
  const [qP, setQP] = useState("");
  const [qC, setQC] = useState("");
  const [qF, setQF] = useState("");
  const toInt = (s: string) => {
    const n = parseInt(s, 10);
    return Number.isFinite(n) && n >= 0 ? n : 0;
  };
  function addQuick() {
    const kcal = toInt(qKcal);
    if (kcal <= 0 || saving) return;
    setSaving(true);
    addItem({ meal, name: qName.trim() || "Comida rápida", grams: null, kcal, p: toInt(qP), c: toInt(qC), f: toInt(qF) });
    router.push("/nutrition");
  }

  /* ---- foto (IA real con fallback simulado) ---- */
  const fileRef = useRef<HTMLInputElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  useEffect(() => () => abortRef.current?.abort(), []); // corta el análisis al salir
  const [analyzing, setAnalyzing] = useState(false);
  const [photoError, setPhotoError] = useState<string | null>(null);
  const [detected, setDetected] = useState<{
    name: string;
    real: boolean;
    nota: string | null;
    items: (Detected & { base: Detected })[];
  } | null>(null);

  function takePhoto() {
    fileRef.current?.click();
  }

  async function onPhoto(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = ""; // permite repetir la misma foto
    if (!file) return;
    setDetected(null);
    setPhotoError(null);
    setAnalyzing(true);
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    try {
      const fd = new FormData();
      fd.append("image", await toJpeg(file), "comida.jpg");
      const res = await fetch("/api/proxy/ai/food/analyze", { method: "POST", body: fd, signal: ctrl.signal });
      if (res.status === 503) {
        // IA aún sin configurar: ejemplo simulado, marcado como tal
        const plate = PHOTO_PLATES[Math.floor(Math.random() * PHOTO_PLATES.length)];
        setDetected({ name: plate.name, real: false, nota: null, items: plate.items.map((i) => ({ ...i, base: i })) });
        return;
      }
      if (!res.ok) throw new Error(String(res.status));
      const data = (await res.json()) as {
        plato?: string | null;
        nota?: string | null;
        items?: { nombre: string; gramos: number | null; kcal: number; p: number; c: number; f: number }[];
      };
      const items = (data.items ?? []).map((it) => {
        const d: Detected = { name: it.nombre, grams: it.gramos, kcal: it.kcal, p: it.p, c: it.c, f: it.f };
        return { ...d, base: d };
      });
      if (items.length === 0) {
        setPhotoError(data.nota || "No he reconocido comida en la foto. Prueba con otra toma.");
        return;
      }
      setDetected({ name: data.plato || "Plato detectado", real: true, nota: data.nota ?? null, items });
    } catch {
      if (ctrl.signal.aborted) return; // se salió de la vista: no tocar el estado
      setPhotoError("No se pudo analizar la foto. Revisa la conexión e inténtalo de nuevo.");
    } finally {
      if (!ctrl.signal.aborted) setAnalyzing(false);
    }
  }
  function setDetGrams(idx: number, g: number) {
    setDetected((d) => {
      if (!d) return d;
      return {
        ...d,
        items: d.items.map((it, i) => {
          if (i !== idx || it.base.grams === null || it.base.grams <= 0) return it;
          const k = g / it.base.grams;
          return {
            ...it,
            grams: g,
            kcal: Math.round(it.base.kcal * k),
            p: Math.round(it.base.p * k),
            c: Math.round(it.base.c * k),
            f: Math.round(it.base.f * k),
          };
        }),
      };
    });
  }
  function removeDetected(idx: number) {
    setDetected((d) => (d ? { ...d, items: d.items.filter((_, i) => i !== idx) } : d));
  }
  function addAllDetected() {
    if (!detected || saving) return;
    setSaving(true);
    detected.items.forEach((it) => {
      addItem({ meal, name: it.name, grams: it.grams, kcal: it.kcal, p: it.p, c: it.c, f: it.f });
    });
    router.push("/nutrition");
  }
  const detTotal = detected ? detected.items.reduce((a, i) => a + i.kcal, 0) : 0;

  /* ---- copiar de ayer ---- */
  function copyYesterday() {
    if (saving) return;
    setSaving(true);
    yesterday.forEach((it) => {
      addItem({ meal, name: it.name, grams: it.grams, kcal: it.kcal, p: it.p, c: it.c, f: it.f });
    });
    router.push("/nutrition");
  }

  const segBtn = (k: Mode, label: string) => (
    <button key={k} onClick={() => setMode(k)} className="rounded-xl py-2.5 text-sm font-medium transition-colors"
      style={mode === k ? { background: "linear-gradient(180deg,#45e9ff,#3b74ff)", color: "#03101c" } : { background: "transparent", color: "var(--color-muted)" }}>
      {label}
    </button>
  );

  return (
    <div className="pt-4">
      <Link href="/nutrition" className="t-label text-muted">← Nutrición</Link>
      <h1 className="t-display mt-2 text-2xl text-ink">Añadir a <span className="neon-text">{meal}</span></h1>

      {/* Foto -> kcal */}
      <div className="glass neon-edge mt-4 p-4">
        <div className="flex items-center justify-between">
          <div>
            <p className="t-label text-ink">Foto → kcal</p>
            <p className="t-body text-xs text-muted">La IA detecta los alimentos del plato. Revisa y ajusta antes de añadir.</p>
          </div>
          <button onClick={takePhoto} disabled={analyzing} className="btn btn-tonal btn-sm shrink-0">📷 Hacer foto</button>
          <input ref={fileRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={onPhoto} />
        </div>
        {analyzing && <p className="pulse t-body mt-3 text-sm text-muted">Analizando la foto…</p>}
        {photoError && !analyzing && <p className="t-body mt-3 text-sm text-warn">{photoError}</p>}
        {detected && !analyzing && (
          <div className="mt-3 border-t border-[rgba(150,190,255,0.1)] pt-3">
            <div className="flex items-center justify-between">
              <p className="t-title text-ink">{detected.name}</p>
              <span className="badge badge-neon">{detected.real ? "IA real" : "IA simulada"}</span>
            </div>
            {detected.nota && <p className="t-body mt-1 text-[11px] text-muted">{detected.nota}</p>}
            <div className="mt-2 flex flex-col gap-2">
              {detected.items.map((it, i) => (
                <div key={`${it.name}-${i}`} className="flex items-center gap-2">
                  <div className="min-w-0 flex-1">
                    <p className="t-body text-sm text-ink">{it.name}</p>
                    <p className="t-body text-[11px] text-muted">{it.kcal} kcal · P {it.p} · C {it.c} · G {it.f}</p>
                  </div>
                  {it.grams !== null && (
                    <span className="flex items-center gap-1.5">
                      <button onClick={() => setDetGrams(i, Math.max(10, (it.grams ?? 0) - 10))} aria-label={`Quitar 10 g de ${it.name}`}
                        className="flex h-7 w-7 items-center justify-center rounded-full border border-[rgba(150,190,255,0.2)] text-ink active:scale-95">−</button>
                      <span className="t-body w-12 text-center text-xs text-ink">{it.grams} g</span>
                      <button onClick={() => setDetGrams(i, Math.min(1000, (it.grams ?? 0) + 10))} aria-label={`Añadir 10 g de ${it.name}`}
                        className="flex h-7 w-7 items-center justify-center rounded-full border border-[rgba(150,190,255,0.2)] text-ink active:scale-95">+</button>
                    </span>
                  )}
                  <button onClick={() => removeDetected(i)} aria-label="Quitar" className="t-label shrink-0 px-1 text-muted hover:text-bad">✕</button>
                </div>
              ))}
            </div>
            {detected.items.length > 0 ? (
              <button onClick={addAllDetected} disabled={saving} className="btn btn-primary mt-3 w-full disabled:opacity-60">
                Añadir todo · {detTotal} kcal
              </button>
            ) : (
              <p className="t-body mt-3 text-center text-xs text-muted">Has quitado todos los alimentos. Haz otra foto.</p>
            )}
          </div>
        )}
      </div>

      {/* copiar de ayer */}
      {yesterday.length > 0 && (
        <button onClick={copyYesterday} disabled={saving} className="glass mt-3 flex w-full items-center justify-between p-3.5 text-left disabled:opacity-60">
          <span>
            <span className="t-label block text-ink">Copiar {meal.toLowerCase()} de ayer</span>
            <span className="t-body text-[11px] text-muted">
              {yesterday.map((i) => i.name).slice(0, 3).join(", ")}{yesterday.length > 3 ? "…" : ""} · {yesterday.reduce((a, i) => a + i.kcal, 0)} kcal
            </span>
          </span>
          <span className="text-neon">↻</span>
        </button>
      )}

      {/* selector de modo */}
      <div className="glass mt-4 grid grid-cols-3 gap-1 rounded-2xl p-1">
        {segBtn("recientes", "Recientes")}
        {segBtn("buscar", "Buscar")}
        {segBtn("rapido", "Rápido")}
      </div>

      {/* ---- recientes ---- */}
      {mode === "recientes" && (
        <div className="mt-3 flex flex-col gap-2">
          {recents.length === 0 ? (
            <div className="glass p-4">
              <p className="t-body text-xs text-muted">Aún no hay recientes. Cuando añadas alimentos aparecerán aquí para repetirlos en un toque.</p>
            </div>
          ) : (
            recents.map((r) => (
              <button key={r.name} onClick={() => { addItem({ meal, ...r }); flash(r.name); }}
                className="glass flex items-center justify-between p-3.5 text-left">
                <span className="min-w-0">
                  <span className="t-body block text-sm text-ink">{r.name}{r.grams ? ` · ${r.grams} g` : ""}</span>
                  <span className="t-body text-[11px] text-muted">{r.kcal} kcal · P {r.p} · C {r.c} · G {r.f}</span>
                </span>
                <span className={`shrink-0 text-lg ${addedFlash === r.name ? "text-good" : "text-neon"}`}>
                  {addedFlash === r.name ? "✓" : "+"}
                </span>
              </button>
            ))
          )}
          {recents.length > 0 && (
            <Link href="/nutrition" className="btn btn-tonal mt-1 w-full">Hecho</Link>
          )}
        </div>
      )}

      {/* ---- buscar ---- */}
      {mode === "buscar" && (
        <div className="mt-3">
          <input value={q} onChange={(e) => { setQ(e.target.value); setSel(null); }} placeholder="Pollo, arroz, avena…" className="field w-full px-4 py-3 text-sm" />
          {!sel ? (
            <div className="mt-3 flex flex-col gap-2">
              {results.map((f) => (
                <button key={f.name} onClick={() => { setSel(f); setGrams(100); }} className="glass flex items-center justify-between p-3.5 text-left">
                  <span className="t-body text-ink">{f.name}</span>
                  <span className="t-body text-xs text-muted">{f.kcal} kcal/100g</span>
                </button>
              ))}
              {results.length === 0 && <p className="t-body mt-2 text-xs text-muted">Sin resultados. Prueba otra búsqueda, el modo Rápido o la foto.</p>}
            </div>
          ) : (
            <div className="glass mt-3 p-4">
              <p className="t-title text-ink">{sel.name}</p>
              <div className="mt-3 flex items-center justify-between">
                <span className="t-label text-muted">Cantidad</span>
                <div className="flex items-center gap-3">
                  <button onClick={() => setGrams((g) => Math.max(10, g - 10))} aria-label="Quitar 10 g" className="flex h-9 w-9 items-center justify-center rounded-full border border-[rgba(150,190,255,0.2)] text-xl text-ink active:scale-95">−</button>
                  <span className="stat w-20 text-center text-lg text-ink">{grams} g</span>
                  <button onClick={() => setGrams((g) => Math.min(1000, g + 10))} aria-label="Añadir 10 g" className="flex h-9 w-9 items-center justify-center rounded-full border border-[rgba(150,190,255,0.2)] text-xl text-ink active:scale-95">+</button>
                </div>
              </div>
              <p className="t-body mt-3 text-center text-sm text-neon">{scaled?.kcal} kcal · P {scaled?.p} · C {scaled?.c} · G {scaled?.f}</p>
              <div className="mt-3 flex gap-2">
                <button onClick={() => setSel(null)} className="btn btn-outline btn-sm flex-1">Volver</button>
                <button onClick={addFood} disabled={saving} className="btn btn-primary btn-sm flex-1 disabled:opacity-60">Añadir a {meal}</button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ---- rápido ---- */}
      {mode === "rapido" && (
        <div className="glass mt-3 flex flex-col gap-3 p-4">
          <p className="t-body text-xs text-muted">¿Sabes las kcal pero no quieres buscar? Apúntalas directas.</p>
          <input value={qName} onChange={(e) => setQName(e.target.value)} placeholder="Nombre (opcional)" className="field px-4 py-3 text-sm" />
          <label className="flex items-center justify-between gap-3">
            <span className="t-label text-ink">Kcal *</span>
            <input value={qKcal} onChange={(e) => setQKcal(e.target.value.replace(/\D/g, "").slice(0, 5))} inputMode="numeric" placeholder="0" className="field w-28 px-3 py-2.5 text-right text-sm" />
          </label>
          <div className="grid grid-cols-3 gap-2">
            {([["P (g)", qP, setQP], ["C (g)", qC, setQC], ["G (g)", qF, setQF]] as const).map(([label, val, set]) => (
              <label key={label} className="flex flex-col gap-1">
                <span className="t-label text-muted">{label}</span>
                <input value={val} onChange={(e) => set(e.target.value.replace(/\D/g, "").slice(0, 4))} inputMode="numeric" placeholder="—" className="field px-3 py-2 text-center text-sm" />
              </label>
            ))}
          </div>
          <button onClick={addQuick} disabled={toInt(qKcal) <= 0 || saving} className="btn btn-primary mt-1 disabled:opacity-60">
            Añadir a {meal}
          </button>
        </div>
      )}
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
