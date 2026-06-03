# M3 · Nutrición — Mockup (diseño)

> Fecha: 2026-06-02 · Estado: aprobado · Tipo: mockup UI (datos de ejemplo + localStorage; backend/IA reales después)

## Pantallas
- **Diario (`/nutrition`)** — principal:
  - Progreso de hoy: kcal consumidas vs objetivo + barras de **proteína/carbos/grasa** vs objetivo.
  - Selector de **objetivo** (Perder / Mantener / Ganar) que ajusta los targets.
  - **Comidas**: Desayuno, Comida, Cena, Snack — con sus items y subtotal, botón + por comida.
  - Tarjeta resumen de **pesaje** → `/nutrition/weigh-in`.
- **Añadir comida (`/nutrition/add?meal=`)**:
  - **Buscador de alimentos** (principal): lista de ejemplo (kcal/macros por 100 g) + gramos → escala.
  - Botón **"Hacer foto"** → foto→kcal (IA **simulada**: "analizando…" → alimento + kcal estimadas).
  - Añade a la comida indicada.
- **Pesaje (`/nutrition/weigh-in`)**: peso **objetivo** vs **actual** (último de biometría M1) + **countdown** a una fecha de pesaje. Corte de peso básico (sin protocolos agresivos).

## Datos / lógica
- **Macros objetivo calculados** (Mifflin-St Jeor): BMR con peso (último de biometría) + altura/edad/sexo (perfil) × factor actividad (1.55), ajustado por objetivo (−500 perder / +300 ganar). Proteína 2 g/kg, grasa 25% kcal, resto carbos. Editable a futuro.
- **Persistencia mock en `localStorage`**: diario por día (`flp_nutri_<fecha>`), objetivo (`flp_nutri_goal`), pesaje (`flp_weigh`). Se cambiará por el backend (NutritionPlan/MealLog) y la IA real (foto→kcal con Claude visión, M4).

## Orden de construcción
1. **Lib** de nutrición (foods, targets, persistencia) + **Diario**.
2. **Añadir comida** (buscar + foto mock).
3. **Pesaje**.
