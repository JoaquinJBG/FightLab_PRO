# M2 · Entreno — Mockup (diseño)

> Fecha: 2026-06-02 · Estado: aprobado · Tipo: mockup UI (datos de ejemplo; lógica e IA reales después)

Mockup-first: pantallas navegables con datos de ejemplo. La IA se **simula** (chat y wizard con respuestas guionizadas); la real (Claude) y el backend se enchufan en fases posteriores.

## Tab Entreno (`/training`) — hub
- **Mini-resumen carga/estado** (arriba): ACWR semáforo + readiness, enlaza a `/training/load`.
- **5 tarjetas**:
  1. Deportes predefinidos → `/training/sports`
  2. Entrenamiento MMA → `/training/mma`
  3. Entrenamiento gimnasio → `/training/gym`
  4. Mi rutina → `/training/my-routine`
  5. Herramientas → `/training/tools`

## Sub-vistas
| Ruta | Contenido | Real/Mock |
|---|---|---|
| `/training/sports` | Rejilla de deportes (estilo reloj) → deporte + duración → estima kcal (MET × tiempo × peso del perfil) | kcal por fórmula; "datos del reloj" mock |
| `/training/mma` | Arte (boxeo/BJJ/muay thai/taekwondo…) + técnica/intensidad + duración; chat IA por voz con respuestas guionizadas (adapta + recuerda estirar) | UI real, IA simulada |
| `/training/gym` | Calendario semanal para apuntar + "Crear rutina con IA" (wizard: nivel, días/sem 2-6, lineal/frecuencia/full-body, objetivo) → rutina de ejemplo | wizard real, IA simulada |
| `/training/my-routine` | Vista del atleta con rutina de ejemplo asignada (gym y/o MMA), solo lectura | datos de ejemplo |
| `/training/tools` | Cronómetro + temporizador de rounds (round/descanso) | **funcional real** (client-side) |
| `/training/load` | ACWR gauge + carga semanal (sRPE) + monotonía/tensión + readiness | datos de ejemplo |

## Home (dashboard)
Añadir resumen de **ACWR + carga semanal + readiness** (datos de ejemplo) — la otra mitad de "ambas".

## Notas
- **IA antes de lo previsto**: el chat MMA y el creador de rutinas viven en M2 a nivel de UI; la IA real es infra de M4.
- **"Mi rutina" implica rol coach** (multi-usuario, aplazado): el mockup muestra solo el lado atleta.
- Reutiliza design system neón + shell (tab bar, gate, BFF) ya montados. Rutas bajo `(shell)`, protegidas por middleware `/training/:path*`.

## Orden de construcción
1. **Hub** (mini-resumen + 5 tarjetas) ← empezamos aquí.
2. Herramientas (cronómetro/timer, real). 3. Deportes. 4. MMA (+chat mock). 5. Gimnasio (+wizard mock). 6. Mi rutina. 7. Métricas en Home + vista Carga.
