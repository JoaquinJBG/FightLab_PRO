# Plan: FightLab sustituye al Entrenador IA y a ParteDiario

> Decisión del usuario (2026-11-03): el Entrenador IA (`ai-personal-coach` en su copia local) y la app
> Android ParteDiario no se van a modificar más. Todo lo que dan y FightLab no tiene pasa a FightLab.
> Todo va sobre `feat/beta-coach` (beta de producción + integración del coach). Nada se despliega sin
> el OK del usuario.

## Qué tiene hoy el Entrenador IA y FightLab no

| Pieza | Dónde vive hoy | Qué falta en FightLab |
|---|---|---|
| Catálogo Mercadona puntuado (359 productos en la tabla de la app; 1.807 en la tabla puntuada con `precio_kilo`) | `entrenador IA/mercadona/*.csv`, `puntuacion.md`, `scripts/` | Productos de cadena con su valoración (`bueno`/`regular`/`evitar`) y su formato de venta |
| Menú con batch cooking (JSON `schema: 1`) | `menus-app/*.json`, `para-amigo/menu-ejemplo.json` | Platos con `steps_batch`/`steps_day`/`storage`, sesiones de batch con cronograma por aparato, tareas de víspera (`eve`), comidas en tupper o libres, lista de la compra por sección, formato (`pack`) y semana |
| Reglas de batch cooking | `batch-cooking/investigacion.md` | Enfriado, días de nevera/congelador, qué no congelar, recalentado una vez a 74-75 °C, air fryer y temperaturas internas, etiquetado y FIFO |
| Parte diario | ParteDiario (Kotlin, Room, Glance, WorkManager, Health Connect) | Parte rápido con comidas hechas/cambiadas, tipo de día, cardio por sesiones, movilidad; avisos de víspera (22:00) y de revisión (martes); widget |
| Historial | Copia de seguridad JSON y CSV semanal de ParteDiario; `checkins.csv`, `sessions.csv`, `menus/*.yaml`, `reviews/*.md` del coach | Importarlo todo a la cuenta del usuario |
| Menús con IA | El usuario los genera con Claude (`/menu`) y los importa en la app | Generación a coste 0 (sin API de pago) |

## Restricciones

- **El repo es público.** Los datos de Mercadona salen de la API no oficial de la tienda, de Numisalud y
  de FatSecret: no tienen licencia para redistribuirlos. **No se suben al repo.** Lo que sí va en el
  código es la lógica de puntuación (Nutri-Score de OFF + semáforo FSA), y los productos entran por
  importación privada en la cuenta del usuario. Lo que venga de OFF lleva atribución ODbL.
- **Sin API de pago de Anthropic.** La suscripción del usuario no se puede usar como API desde el
  servidor: solo él, desde su PC, con Claude Code.
- **Render free** duerme a los 15 min y no tiene cron. **Vercel Hobby** permite 2 cron jobs de una vez
  al día: alcanza para el aviso de las 22:00 y el de los martes.
- **Health Connect no tiene API web.** En la PWA, FC y zonas se apuntan a mano o se dejan para más adelante.
- Datos personales: en las pruebas, siempre inventados. Ninguna sesión abre `ai-personal-coach/data/`.

## Fases

### Fase 10: importar el historial (partes, pesajes y revisiones)

- Importador de la **copia de seguridad JSON de ParteDiario** (`kind: "parte-diario-copia"`: `days`,
  `meal_checks`, `cardio_sessions`, `menus`, `shopping_checks`) y, como alternativa, del CSV semanal
  (contrato en el informe de formatos: `date,weight_kg,sleep_h,…,cardio_min_eq`).
- Importador de los archivos del coach: `checkins.csv` (`sleep_hours`), `reviews/*.md` (`tdee_kcal`,
  `target_kcal`, `in_deficit` y el texto), `sessions.csv` (ya cubierto por F9 con el genérico).
- Destino: `DailyCheckin`/`BiometricsLog` (F5), `Activity`/`SetLog` (F6/F9), `WeeklyReview` (F7).
  `quad` (cuádriceps) pasa a zona de molestias del check-in; los tipos de cardio, a actividades.
- Deduplicación por fecha (lo que ya existe no se pisa sin confirmar), informe de lo importado y de lo
  descartado. Pantalla de subida en Perfil → Importar. Datos inventados en las pruebas.
- **Sin dependencias** (sale de `feat/beta-coach`). Los menús se importan en la Fase 12.

### Fase 11: parte diario rápido, avisos y acceso rápido

- **Pantalla "Hoy"** como en ParteDiario: plan del día, próxima comida, peso, botones de entreno y
  movilidad, comidas del menú con hecho / no hecho / cambiada (y qué se comió en su lugar), tipo de
  día y cardio por sesiones. Reutiliza el check-in de F5 (no se duplica).
- **Avisos con Web Push** (PWA): víspera a las 22:00 solo si hay tareas `eve`, revisión los martes,
  pesarse y movilidad opcionales. Claves VAPID como variables de entorno; el disparo con **Vercel Cron**
  (2 tareas diarias) llamando a un endpoint protegido del backend. En Android funciona con la PWA en
  Chrome; en iPhone, solo con la app añadida a la pantalla de inicio (iOS 16.4+).
- **Sustituto del widget:** `shortcuts` del manifiesto (pulsación larga en el icono: "Parte de hoy",
  "Pesarme", "Próxima comida") y "Hoy" como pantalla de inicio de la PWA.
- **Sin dependencias** salvo F5. Puede ir a la vez que la F10.

### Fase 12: batch cooking y menús completos

- El modelo de menú de F8 se amplía al **JSON `schema: 1`** de la app: `dishes` con `steps_batch`,
  `steps_day`, `storage` y `batch_servings`; comidas `tupper`/`free`/`free_budget_kcal`, `prep` y `eve`;
  `batch_sessions` con `timeline[{min, until, where, step}]`; `shopping.items` con `section`, `pack`,
  `when` (semana 1, semana 2 o las dos), `grams_two` y `batches`.
- **Perfil de cocina del usuario** (no se escribe en el código): menaje (ollas, olla exprés, wok,
  sartén, air fryer, horno, microondas, fuegos grandes y pequeños) y **comensales** con sus
  restricciones por comida (p. ej. "la pareja: cena sin pescado, salvo gambas"). Los rellena el usuario.
- **Reglas de batch cooking** de `investigacion.md` como reglas del anexo de FightLab (con sus fuentes,
  o etiquetadas como convención): cronograma de lo más largo a lo más corto y en paralelo por aparato,
  lunes-martes de nevera y miércoles-viernes de congelador, enfriado, recalentado, qué no congelar.
- Pantallas: **sesión de batch a pantalla completa con temporizador por paso**, tareas de la víspera,
  lista de la compra por sección y formato ("pollo picado", no "pollo") con casillas, e impresión/PDF
  (amplía el PDF de la 8.5).
- **Importar menús** en JSON `schema: 1` (los de `menus-app/`) y YAML del coach: si se reimporta el mismo
  `id`, sustituye al anterior conservando lo tachado.
- **Depende de F8** (ya en la integración).

### Fase 13: productos de Mercadona y su valoración

- **Catálogo de cadena privado por usuario:** importación del CSV (`mercadona-puntuada.csv` o
  `mercadona.csv`) desde Perfil → Importar. Se guarda en la cuenta del usuario y no se publica.
- **Motor de valoración en el código** (`puntuacion.md`): Nutri-Score 2023 de OFF + semáforo FSA
  (azúcar 22,5 g, saturada 5 g, sal 1,5 g por 100 g; límites de bebidas), excepciones (aceites, frutos
  secos, azúcar de la fruta), y `revisar` si las kcal se apartan más de un 15 % de 4P+4C+9G+2F.
- Uso: la lista de la compra de F12 elige el producto y el formato de la cadena (`equivale_a`), los
  sustitutos isocalóricos penalizan los "evitar", y el coste estimado de la semana sale de `precio_kilo`
  si está.
- Los productos que se busquen en OFF (proxy de F8) se valoran igual y llevan atribución ODbL.
- **Depende de F12** para la lista de la compra; el catálogo y el motor pueden empezar a la vez.

### Fase 14: menús con IA a coste 0

Opciones:

- **A. Reglas + LLM simulado (ya en F8).** Automático y gratis, pero los platos salen de un recetario fijo:
  calidad limitada.
- **B. Generar con la suscripción del usuario desde su PC.** El repo trae una skill o comando de Claude
  Code ("menú de la semana") que descarga de FightLab los objetivos, gustos, menaje, comensales y
  catálogo (export con un token personal o un archivo), genera el menú en JSON `schema: 1` y lo
  comprueba con el motor. El usuario lo importa en la app (o la skill lo sube con su token). Coste 0,
  la mejor calidad y es el flujo que ya usa hoy (`/menu`), pero es un paso manual de unos minutos a
  la semana.
- **C. Copiar y pegar.** La app prepara un texto con datos e instrucciones, el usuario lo pega en
  claude.ai y devuelve el JSON. Coste 0 y sin instalar nada, pero es más frágil.

**Recomendación:** B como camino principal, A como respaldo automático y C para el móvil.
**Depende de F12** (el esquema del menú) y de F13 si se quiere el catálogo de la cadena.

## Orden y paralelismo

1. **F10 y F11 a la vez**: son las que sustituyen el uso diario de ParteDiario.
2. **F12**, y **F13** a la vez con ella (catálogo y motor; el enlace con la lista de la compra al final de F12).
3. **F14**.

Cada fase: rama propia desde `feat/beta-coach`, push normal, sin PR, pruebas (pytest, vitest, E2E,
tsc, build y la CI de la beta) y textos en es/en. Al terminar, se juntan en `feat/beta-coach`.

## Decisiones del usuario

1. Catálogo Mercadona: importación privada por usuario (recomendado) / subirlo al repo (no: es
   público y los datos no tienen licencia) / solo OFF y USDA.
2. Menús con IA: B + A + C (recomendado) / solo A / solo B.
3. Avisos: Web Push con Vercel Cron (recomendado; pide crear claves VAPID y ponerlas en Render y
   Vercel) / solo recordatorios dentro de la app.
4. Fotos de tickets: no por ahora (recomendado; Neon free tiene 0,5 GB) / sí.
5. Health Connect: no en la PWA (recomendado; FC a mano) / estudiar una app Android envoltorio más adelante.
