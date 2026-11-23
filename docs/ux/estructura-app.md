# Estructura de la app (beta) — decidida 2026-11-23

Fuente visual: [mapa-app.html](mapa-app.html) (userflow + wireflow). Publicada para el usuario en
https://claude.ai/artifact/TWdMfLA9QL4XE3cx6XXYuC. El usuario eligió la **opción A**.

## Reglas

1. La portada de cada pestaña cabe sin scroll en 375 × 667 (con la barra de pestañas). Las pantallas de detalle pueden ser largas.
2. Arriba lo que se hace hoy y los botones para apuntarlo; gráficas e histórico van a Progreso.
3. Bibliotecas (Ejercicios, Programas clásicos) no son destinos de primer nivel: se entra desde Mis rutinas / editor.
4. Un sitio para cada cosa.
5. **No hay funciones nuevas ni rutas nuevas salvo agrupadores.** Todas las URLs actuales siguen funcionando.

## Barra de pestañas

`Hoy /today` · `Entreno /training` · `Nutrición /nutrition` · `Progreso /dashboard` · `Coach /coach`.
Perfil sale de la barra: avatar (inicial) arriba a la derecha en Hoy → `/profile`. En `/profile/*` se marca
activa Hoy (de ahí se llega). Progreso activo en `/dashboard`, `/biometrics*`,
`/training/load`, `/training/review`. Hoy ya no se marca activo en `/dashboard`.

## Portadas

- **Hoy** (`/today`): cabecera (Hoy + fecha + avatar) · chip de estado (SafetyBanner completo solo si no está en verde) ·
  «Entreno de hoy» (Qué toca + Plan del día fusionados: Empezar / Hecho / tipo de día) · «Próxima comida» (Hecha / Cambiar /
  Ver el día → `/nutrition`; «Para esta noche» como línea dentro cuando aplique) · fila «Apuntar rápido»: Check-in
  (→ `/checkin`), Peso y Cardio (abren su formulario actual en un panel inferior). Se quitan: lista entera de comidas del menú
  (ya está en Nutrición), botón Resumen. Los anclajes `#weight` y `#next-meal` de los atajos del manifest deben seguir
  funcionando (`#weight` abre el panel de peso).
- **Entreno** (`/training`): cabecera con botón «Temporizador» (→ `/training/tools`) · «Hoy toca» del plan con Empezar ·
  «Registrar» 2×2: Gimnasio, MMA, Deporte y cardio, Historial (→ `/training/gym`, que tiene el calendario) ·
  «Planificar»: Mi semana (→ `/training/plan`, que ya enlaza a Mi rutina) y Mis rutinas (→ `/training/routines`).
  Se quitan de la portada: LoadSummary, Revisión semanal, Ejercicios, Mi rutina, Herramientas como tarjeta.
- **Mis rutinas** (`/training/routines`): añade «Añadir desde»: Programas clásicos y Biblioteca de ejercicios
  (`/training/exercises`). El editor de rutina ya abre el selector de ejercicios.
- **Gimnasio** (`/training/gym`): sin el enlace a Importar entrenos ni a Rutinas. Récords como botón en cabecera.
  (Afinar más tras ver Hevy en el móvil.)
- **Nutrición** (`/nutrition`): kcal + macros compacto · comidas en filas con + · agua en una fila · 2 accesos:
  Menú y compra, Objetivo y pesaje (→ `/nutrition/weigh-in`; el bloque «Objetivo» sale de la portada y se muestra allí).
  SafetyPanel solo cuando aplique.
- **Menú y compra** (`/nutrition/menu`): pestañas Menú / Compra / Batch; botón ⚙ Ajustes → `/nutrition/menu/settings`
  (agrupador nuevo) con Mi cocina (`/profile/kitchen`), Mi IA (`/profile/my-ai`), Gustos y Mis productos (las tarjetas
  TastesCard y ProductsCard se mueven ahí).
- **Progreso** (`/dashboard`): tarjeta de carga/estado (→ `/training/load`) · mosaicos 2×3: Peso (→ `/biometrics`),
  Medidas (FC/HRV/% grasa → `/biometrics`), Revisión semanal (→ `/training/review`), Récords (→ `/training/gym/records`),
  Zonas de esfuerzo, Fotos (→ `/biometrics`) · botón Registrar medición. Se quitan los bloques que repetía Hoy
  (Estado de hoy, Hoy toca, Check-in, recordatorio de peso).
- **Coach**: Memoria del coach como botón en cabecera; chat fijo abajo.
- **Perfil** (`/profile`): Editar perfil, Repetir el cribado, Avisos, Importar datos (agrupador nuevo
  `/profile/import-hub` o similar con Historial `/profile/import`, Entrenos de Hevy `/training/gym/import`,
  Catálogo `/profile/import/catalogue`), Créditos, Cerrar sesión. Mi cocina y Mi IA salen de aquí.

## Volver atrás

Los enlaces «← volver» de las pantallas movidas apuntan a su nuevo padre (p. ej. Mi cocina → Ajustes del menú,
Importar entrenos → Importar datos, Carga → Progreso).
