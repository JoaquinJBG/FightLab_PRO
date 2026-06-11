# M4 · Coach IA — Mockup (diseño)

> Fecha: 2026-06-11 · Estado: aprobado (modo autónomo) · Tipo: mockup UI (IA simulada; Claude real después)

Última pieza del mockup completo: el tab **Coach** deja de ser placeholder y muestra
la experiencia del coach proactivo + chat, con datos de ejemplo (AIContext mock).

## Pantalla (`/coach`)
1. **Contexto del atleta** (chips): ACWR, readiness, peso — lo que "ve" el coach
   (el AIContext del PRD, mock).
2. **Briefing de hoy**: tarjeta hero con el mensaje proactivo del día (persona
   "High-Performance Coach": directo, técnico, motivador).
3. **Recomendaciones proactivas** (tarjetas con severidad + acción):
   - Carga: ACWR alto → reducir volumen (botón "Aplicar al plan", mock).
   - Pesaje: peso vs objetivo a N días (enlace a `/nutrition/weigh-in`).
   - Recuperación: FC reposo/sueño → priorizar descanso (descartar).
   Descartes persistidos en localStorage.
4. **Chat con el coach**: conversación simulada por palabras clave (dieta, peso,
   entreno, fatiga, carga…), chips de pregunta rápida y micro mock. Streaming
   "escribiendo…".

## Notas
- IA simulada por reglas; la real será Claude con tool-calling + AIContext real
  (recomendaciones desde sesiones/carga/biometría) — fase post-mockup.
- El disclaimer "no es consejo médico" acompaña al coach.
