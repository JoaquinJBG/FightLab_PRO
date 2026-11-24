# Cómo se aplicaría «B oscuro + A claro» al código

Nota de planificación. **No se ha tocado el código.** Aplicarlo es otra tarea, con el OK del usuario y después
de que el jefe de FightLab termine `feat/app-simplificar-ui`: esa rama toca `TodayView.tsx`,
`training/page.tsx`, `icons.tsx` y `messages/*.json`, y chocaría con las fases 3 y 4.

Lo que hay que decidir antes: el color de acción en claro (ver «Choques» abajo).

## Qué queda en cada modo

| | Oscuro (B) | Claro (A) |
|---|---|---|
| Fondo | `#04060c` con nebulosa azul-violeta (la de hoy) | niebla `#E7EEF2` con nebulosa cobalto-coral en acuarela |
| Cristal | el de hoy, borde de luz cian → azul | blanco 78 → 55 %, borde coral → cobalto |
| Color de acción | cian `#45e9ff` → azul `#3b74ff` | coral `#F97279` (A tal cual) o azul `#1f6fe0` (propuesta) |
| Destacado (récord, semana actual) | coral `#F97279` | coral; en texto, `#B83A44` |
| Titulares y cifras | Bricolage Grotesque 800, minúsculas | igual |
| Texto | Roboto Flex | igual |
| Logo | «FIGHTLAB» en gris con franja coral | igual |
| Estados | `#43e8a0` · `#ffd25a` · `#ff5d80` | `#0B7550` · `#8A5A00` · `#B42B37` |

## Choques al cambiar de modo

- **Color de acción.** Pasa de cian a coral: cambian el botón principal, la pestaña activa, el campo activo
  y las barras. Además, en claro el coral se parece al rojo de error, y la app tiene avisos de seguridad.
  **Propuesta:** en claro, la base de A con el azul de FightLab para actuar y el coral solo como firma (fila
  «propuesta» del lienzo). Así cada color hace lo mismo en los dos modos.
- **Logo, letra y forma.** Se fijan los de B en los dos modos. Con A claro tal cual cambiarían el logo
  («fightlab» en minúsculas), la letra (Geist) y las esquinas.
- **Nebulosa.** Azul-violeta en oscuro y cobalto-coral en claro. Casa bien: en los dos modos es luz por los
  lados.

## Fases

**Fase 1: tokens y letra (2 archivos, sin cambio visible en oscuro).**
- `frontend/app/globals.css`:
  - Los colores de `@theme` (`--color-bg`, `surface`, `ink`, `muted`, `neon`, `neon-deep`, `good`, `warn`,
    `bad`) pasan a variables con valor oscuro y claro, con `@theme inline` para que `text-neon`,
    `bg-surface`… cambien solas.
  - Se añaden `--color-sello` (coral) y `--color-hi` (destacado).
  - `color-scheme: dark` pasa a `light dark`, con claro por `prefers-color-scheme` y `data-theme`.
- `frontend/app/layout.tsx`: `Plus_Jakarta_Sans` → `Bricolage_Grotesque` (800) en `--ff-display`. Se queda
  `Roboto_Flex`.
- Opcional: `pnpm add github:JoaquinJBG/brand-joaquin#v2.3.0` e importar solo `tokens.css`, para tomar los
  valores de claro de la marca en vez de copiarlos.

**Fase 2: piezas comunes (1 archivo, cambia todo a la vez).**
- En `globals.css`, reescribir con las variables:
  - `.glass`, `.neon-edge`, `.glow`, `.neon-text`;
  - `.btn-primary`, `.btn-tonal`, `.btn-outline`, `.field`, `.badge*`;
  - `.t-display` y `.t-title` (minúsculas, interletra −0,04 em).
- Fondo: `.bg-fx` (`.neb`, `.dots`, `.vignette`) y `components/nebula-canvas.tsx` con un parámetro de tema
  que cambie la paleta y la mezcla, como hace `nebulosa.js` de la marca con `uLight`.
- Estas clases las usan unos 107 componentes, así que el cambio llega a toda la app sin tocarlos.

**Fase 3: colores sueltos (~40 archivos, después de que entre `feat/app-simplificar-ui`).**
- Cambiar los hex y `rgba(69,233,255,…)` puestos a mano por tokens.
- Sin esto, el modo claro sale roto en esas pantallas.
- Los grupos más grandes:
  - gráficas: `gym/ProgressChart`, `gym/TrainingCalendar`, `zones/ZonesCard`, `checkin/ReadinessCard`;
  - series: `gym/SetRow` y `training/gym/session`;
  - seguridad: `safety/*`;
  - plan: `plan/PlanView` (que también está cambiando el jefe);
  - `tab-bar.tsx`, `today/TodayView`, `coach/ChatPanel`;
  - las páginas de `training/*`, `nutrition/*` y `profile/*`.

**Fase 4: la firma.**
- Componente nuevo `components/brand/LogoFranja.tsx` (logo «FIGHTLAB» con franja), en:
  - `login`, `register`, `onboarding` y `public/offline.html`;
  - el pie del perfil, con «by joaquín beltrán».
- Coral para lo destacado: récord en `SetRow`, semana actual en las gráficas de carga.
- Iconos: `public/icon.svg`, `icon-maskable.svg`, los PNG (192, 512, maskable, `apple-touch-icon`) y los
  atajos, desde `plantillas/icono-app.svg` de la marca.
- `app/manifest.ts` y `themeColor` de `layout.tsx`: `#04060c` en oscuro y `#E7EEF2` en claro.

**Fase 5: modo claro y pruebas.**
- Claro y oscuro según el sistema; opcional, un selector Sistema / Claro / Oscuro en Perfil.
- Pruebas:
  - repasar el contraste de cada pantalla en claro;
  - `pnpm lint`, `typecheck`, `test` y `e2e`, actualizando las capturas que cambien;
  - probar con «reducir movimiento» activado.

## Orden y tamaño

- Fases 1 y 2: una PR, de bajo riesgo para lo que esté haciendo el jefe.
- Fases 3 y 4: otra PR, cuando `feat/app-simplificar-ui` esté en `staging`.
- Fase 5: dentro de la segunda PR o aparte.
- Flujo de siempre: feat → staging → main.
