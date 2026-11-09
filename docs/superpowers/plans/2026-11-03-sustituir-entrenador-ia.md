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

**Hecho en `feat/coach-f13-mercadona` (2026-11-09):**

- Modelo propio `ChainProduct` (por perfil, privado), aparte de `CatalogueProduct` (OFF, ODbL):
  la clave es el id de la tienda o el EAN, trae precio, formato y `equivale_a`, y borrar el
  catálogo no toca lo guardado de OFF. Importación en Perfil → Importar → Catálogo de la cadena,
  con vista previa (nuevos, actualizados, sin cambios, descartados con motivo y línea, valoraciones
  y diferencias con la del archivo). Una celda vacía no borra lo guardado: la tabla puntuada y la
  de la app se juntan.
- Motor en `backend/coaching/product_rating.py`; reglas y fuentes en
  `backend/knowledge_fightlab/food-products.md` (F145 a F148: guía FSA 2016, informe Nutri-Score
  2022, documentación de OFF y anexo XIV del Reglamento 1169/2011), con traducción.
- Uso: enganche `settings.SHOPPING_CHAIN_PROVIDER` = `coaching.chain_catalogue.chain_product` (acordado con F12),
  además de `product_for` / `shopping_for` (y `POST /coach/chain-products/shopping`)
  para la lista de la compra de F12; `GET /coach/substitutes` para los sustitutos isocalóricos.
- Los CSV de cadena están en `.gitignore`; las pruebas usan productos inventados.

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
4. **F15** (estudio) y después **F16** (app Android), cuando el usuario lo diga.

**Cambio de prioridad (2026-11-09).** El usuario necesita sustituir **Hevy** (con lo que Hevy tiene
de pago) y **Entrenador IA** para poder usar FightLab a diario. Pasan por delante:
- **F17 «Gimnasio de verdad»**, la máxima prioridad, en paralelo con los arreglos A y B, F12 y F13.
  Se divide en tres ramas que no tocan los mismos archivos:
  - **F17-E, ejercicios y biblioteca:** ejercicios propios sin límite, con músculo principal y
    secundario y material; biblioteca wger + everkinetic con imágenes y créditos (estudio
    `docs/estudios/2026-11-09-biblioteca-ejercicios.md`); búsqueda y filtros en es/en.
  - **F17-R, rutinas y programas:** rutinas y plantillas sin límite (crear, editar, duplicar,
    reordenar y carpetas), programas clásicos (full body de 3 días, torso-pierna y
    empuje-tirón-pierna), y el plan por reglas genera rutinas del mismo modelo.
  - **F17-H, registro, historial y récords:** empezar el entreno desde una rutina; tipos de serie;
    RPE o RIR por serie; superseries; notas y descanso por ejercicio; calculadora de discos;
    historial y calendario desde el servidor (arregla F1 de raíz, junto con F2 y F18); gráfica por
    ejercicio; récords con aviso; e importar de Hevy con sus rutinas.
- **Nutrición, para igualar a Entrenador IA:** F6 (arreglos A), F12 y F13 juntas, el **escáner de
  código de barras** con la cámara y **F14** justo después de F12.
- **F18, rutinas generadas con IA:** un formulario y la clave gratuita de Gemini del propio usuario;
  el motor valida los números. Va después de F17.
- **Producción:** cuando esté todo esto y el usuario lo haya probado en el móvil, siempre con su OK.

Cada fase: rama propia desde `feat/beta-coach`, push normal, sin PR, pruebas (pytest, vitest, E2E,
tsc, build y la CI de la beta) y textos en es/en. Al terminar, se juntan en `feat/beta-coach`.

### Fase 15 (estudio, sin construir): app Android con Health Connect

- Estudio, no implementación: una app Android que envuelva la PWA (TWA con Bubblewrap, o Capacitor) y
  lea de **Health Connect** la frecuencia cardiaca en reposo, la media y la máxima, y los minutos por
  zona, como hacía ParteDiario (`fc_reposo,fc_media,fc_max,min_z1..z3`), y los mande a FightLab.
- Comparar TWA (casi sin código nativo, pero sin acceso a Health Connect salvo con un módulo aparte)
  con Capacitor (con plugin de Health Connect, más mantenimiento). También: permisos de Health Connect,
  publicación (APK propio o Play Store), firma, actualizaciones y coste 0.
- Resultado: un documento con la recomendación y un prototipo mínimo solo si el usuario lo pide.
- **Después de F11.** El usuario ya ha elegido Capacitor para la F16 (abajo): el estudio se centra
  en el plugin de Health Connect, el widget y la publicación, y sus conclusiones son la entrada de la F16.

### Fase 16 (apuntada, sin empezar): app Android con Capacitor

- **Cuándo:** después de dejar la app funcional (F12 y la subida a producción). No se empieza hasta
  que el usuario lo diga.
- **Qué:** una app Android hecha con **Capacitor** que envuelve la PWA de FightLab, la misma URL de
  producción. No es una app nueva: las pantallas y la lógica siguen en la PWA.
- **Widget de la pantalla de inicio** que sustituye al de ParteDiario (Glance): parte rápido del
  día y lo pendiente de Hoy. Es código nativo (Kotlin) dentro del proyecto Capacitor y lee la misma
  API del backend con la sesión del usuario.
- **Health Connect:** FC en reposo, media y máxima, y minutos por zona
  (`fc_reposo,fc_media,fc_max,min_z1..z3`, como ParteDiario), enviados a FightLab. Se apoya en el
  estudio de la **F15** (plugin, permisos y qué datos se guardan).
- **Avisos:** decidir en el estudio si siguen por Web Push o pasan a notificaciones nativas.
- **iPhone:** sin cambios, sigue con la PWA.
- **Publicación:** APK propio o Play Store, firma y actualizaciones a coste 0, según el estudio F15.
  Cualquier cuenta o pago (por ejemplo, la cuota de Google Play) lo decide el usuario.

## Decisiones del usuario (2026-11-03)

1. **Catálogo Mercadona:** importación privada en su cuenta, desde su PC. Nunca en el repo.
2. **Menús con IA a coste 0:** B + A + C. Skill de Claude Code en su PC con su suscripción que
   genera el menú y lo sube, reglas automáticas de respaldo y copiar y pegar desde el móvil.
3. **Avisos:** Web Push con Vercel Cron. Las claves VAPID las crea y las pone el usuario (pasos en
   `docs/DEPLOY.md` cuando se haga la F11).
4. **Fotos de tickets:** en **Cloudflare R2** (decidido tras el estudio de abajo). Va en la F12.
5. **Health Connect:** fase de estudio F15 (arriba).
6. **App Android (2026-11-09):** apuntada como F16, con Capacitor envolviendo la PWA, el widget
   que sustituye al de ParteDiario y Health Connect (con el estudio F15). La PWA sigue igual para
   iPhone. Se empieza después de dejar la app funcional.

## Fotos de tickets solo en el móvil (IndexedDB de la PWA)

Las fotos se guardan en el navegador del teléfono (IndexedDB), comprimidas (unos 150-300 KB cada
una), y al servidor solo va una referencia: menú, fecha y un identificador. No ocupan Neon.

**Ventajas:** coste 0 y nada de espacio en Neon (0,5 GB en el plan gratis); privadas (no salen del
teléfono); funcionan sin conexión y cargan al instante.

**Límites:**

- **Se pierden** si se borran los datos del navegador o del sitio, se desinstala la PWA o se cambia de
  móvil. Para que el navegador no las borre por falta de espacio, la app pide almacenamiento
  persistente (`navigator.storage.persist()`); Chrome lo concede casi siempre a una PWA instalada. En
  iPhone, Safari puede borrar los datos de webs no instaladas tras 7 días sin uso, pero no los de una
  app añadida a la pantalla de inicio.
- **Solo en ese teléfono y ese navegador:** no se ven desde el PC ni desde otro móvil.
- **Copia de seguridad:** no la hace el servidor. La app tendría "Exportar fotos" (un .zip que se guarda
  en el teléfono o en Drive) e "Importar fotos" para recuperarlas.
- Si en el servidor queda una referencia a una foto que el móvil ya no tiene, la app lo dice ("foto
  solo en el otro dispositivo o borrada") sin romperse.

**Alternativas:** en Neon (unas 2.000 fotos llenarían el plan gratis, compartido con todo lo demás), o
un almacenamiento externo gratuito tipo Cloudflare R2 (10 GB, pide crear otra cuenta).

**Recomendación:** solo en el móvil con IndexedDB, almacenamiento persistente y exportar/importar en
.zip. Iría en la F12, con la lista de la compra.

### Decisión: Cloudflare R2 (F12)

El usuario eligió R2. Requisitos para la F12:

- **Bucket privado**, sin acceso público ni dominio público. Las fotos se sirven con **URLs firmadas** que
  caducan (p. ej. 10 min) y que solo pide el dueño del ticket a través del backend.
- **Compresión y límite al subir**: el cliente redimensiona y comprime (JPEG o WebP, unos 300 KB), y el
  backend rechaza lo que pase de un máximo (p. ej. 2 MB). Un contador del uso total avisa al admin al
  llegar al 80 % de los 10 GB gratis.
- **Borrado**: al borrar un ticket se borra su objeto, y al borrar la cuenta todos los del usuario.
- **Pruebas** con un almacenamiento falso en memoria; ninguna llamada real a R2.
- **Ninguna credencial en el repo**, que es público.

Variables (backend, en Render; ninguna va en Vercel ni con `NEXT_PUBLIC_`):

| Variable | Qué es |
|---|---|
| `R2_ACCOUNT_ID` | ID de la cuenta de Cloudflare (sale en la URL del panel y en R2 → Overview) |
| `R2_ACCESS_KEY_ID` | Access Key ID del token de API de R2 |
| `R2_SECRET_ACCESS_KEY` | Secret Access Key del mismo token (secreto) |
| `R2_BUCKET` | Nombre del bucket, p. ej. `fightlab-tickets` |
| `R2_SIGNED_URL_SECONDS` | Opcional, caducidad de las URLs firmadas (por defecto 600) |

Sin `R2_*`, la subida de tickets se desactiva y la app lo explica, igual que OFF sin contacto.

Pasos del usuario (ya tiene cuenta de Cloudflare):

1. Cloudflare → **R2 Object Storage** → **Create bucket** → nombre `fightlab-tickets`, ubicación
   automática o UE. No actives el acceso público ni un dominio personalizado.
2. R2 → **Manage R2 API Tokens** → **Create API token** → permiso **Object Read & Write**, limitado a
   ese bucket → crear. Copia el **Access Key ID** y el **Secret Access Key**: el secreto solo se ve una vez.
3. En Render, en el servicio del backend (el de prueba primero), añade las variables de la tabla y
   redespliega.

La F12 copia esta sección en `docs/DEPLOY.md`, junto a las variables VAPID de la F11.

