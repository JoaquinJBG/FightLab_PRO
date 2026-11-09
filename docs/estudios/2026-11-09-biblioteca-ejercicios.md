# Estudio: biblioteca de ejercicios con imagen o vídeo (2026-11-09)

Solo documentación, sin código. Objetivo: que al crear o ver una rutina cada ejercicio muestre cómo se hace
(estilo Hevy), con coste 0, en un repo **público** y en una app que algún día podría cobrar.
No es asesoría legal: es lo que dicen las licencias y los términos que se han podido abrir (fuentes al final).

## 1. Lo que ya tiene FightLab (rama `feat/beta-coach`)

- **Sin tabla de ejercicios.** Un ejercicio es un texto: `SetLog.exercise` (`CharField(120)`,
  `backend/activities/models.py`). Las series llegan en `detail.exercises` o en `sets` (`activities/sets.py`).
- **La biblioteca es una constante del frontend:** `LIBRARY` en `frontend/lib/gym.ts`, con 30 ejercicios en 6
  grupos. El nombre en español es el id que se guarda; `EXERCISE_KEYS` solo lo traduce a una clave de i18n.
- **Músculos:** `coach/muscle_map.yaml` del coach (nombres en inglés y alias en español) más
  `FIGHTLAB_ALIASES` (`backend/coaching/bridge/muscle_map.py`). El plan semanal elige los ejercicios de esa
  misma biblioteca (`DEFAULT_EXERCISES` en `coaching/plan.py`), y `PlanView` y el selector de
  `training/gym/session` los muestran por nombre.
- **Importador F9** (`coaching/imports.py`): trae los nombres tal cual vienen de Hevy, por ejemplo
  «Bench Press (Barbell)».
- **CSP:** `img-src 'self' blob: data:` (`frontend/next.config.ts`). Las imágenes tienen que servirse desde el
  propio origen; si no, hay que abrir la CSP.

Conclusión: no hace falta migrar la base de datos. Basta un **catálogo estático** con la clave del nombre
que ya se guarda, la imagen y sus créditos. Un nombre sin entrada (propio o importado) se queda sin imagen.

## 2. Tabla comparativa

| Fuente | Licencia del código | Licencia de los datos (texto) | Licencia de las imágenes o vídeos | Repo público + app de pago | Español | Combate / movilidad | Tamaño y formato |
|---|---|---|---|---|---|---|---|
| **wger** | AGPL-3.0 (no se usa su código) | CC BY-SA 4.0 por entrada (`license` y `license_author` en la API) | CC BY-SA 3.0 (88) o 4.0 (295), con autor por imagen; vídeos CC BY-SA 4.0 | **Sí**, con atribución. ShareAlike solo si se adapta la obra | 644 de 954 ejercicios | «Boxing», «Bag training», «punches» y burpees **sin imagen**; 62 estiramientos y movilidad, 20 con imagen | 383 imágenes para 279 ejercicios (PNG, JPG o WebP; ~140 KB de media en la muestra; miniaturas de 400 px de ~25 KB). 78 vídeos para 46 ejercicios: **3,57 GB** en HEVC/MOV 1080p |
| **everkinetic** (`everkinetic/data`) | — | CC BY-SA 4.0 (`LICENSE.md`) | CC BY-SA 4.0: dibujos de línea en SVG, 2 fotogramas por ejercicio (relajación y tensión) | **Sí**, con atribución | No (inglés) | Cuello isométrico y poco más; sin combate | 289 ejercicios; `dist/svg` 537 archivos, 10,7 MB (~20 KB cada uno); PNG 23 MB. Sin commits desde 2022. Es el origen de 83 imágenes de wger |
| **free-exercise-db** (yuhonas) | Unlicense | Unlicense **declarada**, pero el texto viene de una fuente rascada | **Procedencia desconocida.** El autor admite que no sabe de dónde salen; el proyecto del que deriva dice que se rascaron de internet y desaconseja el uso comercial | **No** para las imágenes; el texto, con riesgo | No (hay forks traducidos) | Algún estiramiento (51) y cuello; sin combate | Unos 870 ejercicios (876 JSON), 1.746 JPG, ~94 MB |
| **ExerciseDB** (AscendAPI) | Repo AGPL-3.0 que hoy solo contiene README y LICENSE | Términos: «propiedad exclusiva de AscendAPI», licencia revocable mientras dure la suscripción | Igual. **Prohíbe guardar** texto, GIF o vídeo (caché máxima de 1 hora) | **No**: no se puede guardar, y sin guardar no hay PWA sin conexión | Sin datos | — | V1 gratis: 1.500 ejercicios con GIF. RapidAPI: 0 $ por 690 peticiones al mes (GIF de 180 px), 12,99 $ y 18,99 $ al mes. V2: «11.000+» |
| **openGym** / `hasaneyldrm/exercises-dataset` | openGym: AGPL-3.0. Dataset: MIT | MIT (el texto viene de ExerciseDB v1, según el NOTICE de openGym) | **© Gym visual**: permiso solo para openGym o para ese repo; para cualquier otro uso hay que comprar una licencia propia | **No** para los medios. El texto MIT choca con lo que AscendAPI dice ser suyo | Sí (10 idiomas) | Sin combate | 1.324 ejercicios, miniaturas y GIF de 180×180; repo de 128 MB |
| **MuscleWiki API** | Cerrado | Propietaria | Propietaria: prohíbe descargar, guardar o alojar en otro sitio; solo streaming desde su API | **No** a coste 0 | Solo en planes de pago | — | Plan gratis solo en su Playground; de 10 $ a 199,99 $ al mes |
| **Wikimedia Commons** | — | — | Licencia por archivo (CC BY, CC BY-SA o dominio público) | Sí, archivo a archivo | — | Casi nada | «Strength training»: 91 archivos; «Animations of physical exercises»: 7. Estilos mezclados |

**La «disputa» de las imágenes de openGym.** No hay un caso público. Son dos reivindicaciones incompatibles
sobre los mismos medios, ambas en fuentes primarias. Los términos de ExerciseDB dicen que todo su contenido,
incluidos los GIF, es «propiedad exclusiva de AscendAPI». El dataset de hasaneyldrm y el NOTICE de openGym
atribuyen esos mismos medios a Gym visual (Aliaksandr Makatserchyk) y dicen que el texto viene de ExerciseDB v1.
Para FightLab da igual quién tenga razón: ninguno de los dos da derecho a reutilizarlos sin una licencia
propia y de pago.

**Cobertura de los 30 ejercicios de `LIBRARY`** (búsqueda aproximada por nombre, hay que revisarla a mano):
wger con imagen, 28 de 30 (faltan press Arnold y crunch en polea); everkinetic, 25 de 30 (faltan jalón,
peso muerto, face pull, plancha y crunch en polea). Entre los dos cubren 29 de 30. El crunch en polea no está
en ninguno, y free-exercise-db queda descartada.

## 3. Qué implican las licencias

- **CC BY-SA en una app de pago:** se puede. La licencia no tiene cláusula NC (no comercial).
- **Atribución (CC BY-SA 4.0, §3(a)(1)):** autor, aviso de licencia con enlace, enlace a la fuente si es
  razonable y aviso de si se modificó.
- **ShareAlike (§3(b)):** solo se aplica si se comparte una **obra adaptada** (§1(a)). Mostrar la imagen junto
  al código MIT no la convierte en una adaptación, así que el código sigue siendo MIT. Redimensionar o pasar a
  WebP son «modificaciones técnicas» (§2(a)(4)) y **no** producen una adaptación. Si se dibujan flechas o se
  recorta el dibujo, el resultado sale CC BY-SA 4.0. Lo mismo pasa con los textos de wger traducidos o
  editados: la traducción es CC BY-SA, no la CC BY 4.0 del resto del contenido de FightLab.
- **`LICENSE-CONTENT.md`:** hay que excluir los medios y textos de terceros, igual que ya se hace con
  `backend/vendor/ai-personal-coach/`.
- **wger:** 104 imágenes no tienen autor (`license_author` vacío) y 46 están marcadas `is_ai_generated`.
  Propuesta: quedarse con las que tienen autor y no usar las de IA, para no depender de un estado legal dudoso.

## 4. Dónde guardar los medios

Tamaño previsto: un subconjunto curado de 60 a 120 ejercicios, con SVG minificado de everkinetic (~10 KB) y
WebP de 400 px de wger (~30 KB). Ocupa **menos de 5 MB**. Los vídeos de wger no entran en la v1: habría que
recodificar 3,57 GB.

| Opción | Coste | Encaje | Atribución |
|---|---|---|---|
| **A. Repo, en `frontend/public/exercise-media/`** | 0 € (CDN de Vercel) | Mismo origen, encaja con la CSP actual. El service worker de la PWA la guarda para usarla sin conexión. Sin credenciales | `ATTRIBUTION.md` en la carpeta, generado del catálogo, más la exclusión en `LICENSE-CONTENT.md`. CC BY-SA permite redistribuir |
| **B. Cloudflare R2** (la cuenta de la F12) | 0 € dentro de los 10 GB | El bucket de tickets es privado; harían falta un segundo bucket público y un dominio propio en Cloudflare, porque `r2.dev` tiene límite de peticiones y es solo para desarrollo (lo dice Cloudflare). La otra salida es una ruta de Next que haga de proxy con `Cache-Control`. Más piezas y claves | Igual, más la página de créditos |
| C. CDN propio o enlazar directamente a wger.de | 0 € | No: rompe la CSP, manda la IP del usuario a un tercero y depende de un servidor de voluntarios | — |

**Recomendación: A.** El peso es pequeño, los medios tienen licencia para redistribuirlos y no añade cuentas
ni claves. R2 queda para cuando haya vídeo. Lo decide el usuario: este estudio no sube ninguna imagen de
terceros.

**Cómo se cumple la atribución:** cada medio lleva en el catálogo `source`, `author`, `license`,
`license_url`, `source_url` y `modified` (p. ej. «redimensionada a 400 px, WebP»). En la ficha del ejercicio
aparece un pie corto, por ejemplo «Imagen: Everkinetic vía wger · CC BY-SA 4.0», con enlace. Una página de
**Créditos** los lista todos, y un test comprueba que ningún medio se queda sin crédito.

## 5. Veredicto

1. **Usar wger como base:** datos y nombres en español con CC BY-SA 4.0, más imágenes CC BY-SA con autor.
   **Everkinetic** aporta un estilo de línea uniforme con dos fotogramas, que se pueden animar alternándolos.
2. **Descartar free-exercise-db:** imágenes de origen desconocido, rascadas, con indicios de bodybuilding.com
   y ExRx. La Unlicense del repo no da derechos que el autor no tenía.
3. **Descartar ExerciseDB, openGym/Gym visual y MuscleWiki:** prohíben guardar los medios, exigen suscripción
   o una licencia propia de pago, y sus medios tienen dos dueños que se los disputan.
4. **Combate (golpeo, sombra, sprawl) y gran parte de la movilidad:** ninguna base abierta tiene medios. Hay
   que hacerlos propios (dibujos o clips del usuario, CC BY 4.0 de FightLab) o, de momento, solo texto.
5. **Sin migración:** un catálogo estático con la clave del nombre que ya se guarda, con los medios en el repo
   (opción A) y créditos por imagen.

## 6. Propuesta de fase: F17, biblioteca de ejercicios con imagen

**Cuándo:** después de dejar la app funcional (F12 y la subida a producción). Puede ir a la vez que la F16.

**Alcance:** los 30 ejercicios de `LIBRARY` y unos 30 o 60 más (estiramientos y movilidad de wger) con imagen
y pasos en español. El combate, con texto y un icono genérico hasta que haya medios propios. Sin vídeo.

**Pasos:**

1. **Catálogo:** `exercise_catalog.json` con la clave del nombre en español que ya se guarda, los ids de wger y
   everkinetic, los pasos y los créditos. Se busca por nombre y alias sin distinguir mayúsculas, y sin el
   «(Equipo)» final, como hace el coach.
2. **Script de snapshot:** lee la API pública de wger (sin clave) para una lista fija de ids y los SVG de
   everkinetic por ruta. Genera el catálogo, optimiza los medios (svgo o WebP de 400 px) y descarta los que no
   tienen autor o están hechos con IA. No se ejecuta en CI: el resultado se fija en el repo.
3. **Mapeo a mano** de los 30 ejercicios. El crunch en polea se queda sin imagen o con un medio propio.
4. **Frontend:** miniatura en el selector de `training/gym/session` y en `PlanView`, ficha con fotogramas,
   pasos y crédito, y página de Créditos. Precarga en la caché de la PWA.
5. **Licencias:** `ATTRIBUTION.md` generado del catálogo, la exclusión en `LICENSE-CONTENT.md` y un test de
   «todo medio tiene crédito». E2E con imagen y sin imagen (nombre importado).
6. **Ampliar `LIBRARY`** (opcional): cada ejercicio nuevo necesita un alias en `FIGHTLAB_ALIASES` o en el mapa
   del coach; si no, sale como «sin mapear» en las series semanales.

**Qué hace falta del usuario:**

- elegir dónde van los medios: en el repo (A, recomendado) o en R2 (B);
- dar el visto bueno al estilo: línea de everkinetic, con wger para los huecos, o mezclar fotos;
- decir qué ejercicios de combate y movilidad quiere y si va a grabar o dibujar medios propios.

No hace falta crear cuentas ni claves: la API de wger es pública para leer.

**Riesgos:**

- metadatos de licencia de wger mal puestos por quien los subió (se revisan a mano los ~60-120 elegidos);
- estilos mezclados entre fotos y dibujos;
- equivocarse con ShareAlike: un medio editado o un texto traducido sale CC BY-SA y hay que marcarlo;
- la tentación de usar free-exercise-db u otros GIF «gratis» que no lo son;
- crecer hacia vídeo: con 3,57 GB pasa a R2 y a recodificar.

## Fuentes

Abiertas:

- wger, README y licencias: https://github.com/wger-project/wger
- API pública de wger (solo lectura, sin clave, consultada el 2026-11-09): https://wger.de/api/v2/license/ ,
  `…/exercise/`, `…/exercise-translation/?language=4`, `…/exerciseinfo/`, `…/exerciseimage/`, `…/video/`
- Documentación de la API de wger: https://wger.readthedocs.io/en/latest/api/api.html
- everkinetic: https://github.com/everkinetic/data (`LICENSE.md`, `CONTRIBUTION.md`, `dist/exercises.json`)
- free-exercise-db: https://github.com/yuhonas/free-exercise-db (`LICENSE.md`, `README.md`, `schema.json`),
  issues https://github.com/yuhonas/free-exercise-db/issues/2 y https://github.com/yuhonas/free-exercise-db/issues/13
- exercises.json (origen): https://github.com/wrkout/exercises.json , `CONTRIBUTING.md` e issue
  https://github.com/wrkout/exercises.json/issues/305
- ExerciseDB: https://github.com/ExerciseDB/exercisedb-api , https://exercisedb.dev/ y términos
  https://exercisedb.notion.site/ExerciseDB-API-Terms-of-Use-226983b728ca8090bf7be79564e4b356 (se leyeron las
  secciones 1 a 3)
- RapidAPI ExerciseDB, precios: https://rapidapi.com/justin-WFnsXH_t6/api/exercisedb/pricing
- openGym: https://github.com/DuarteSantos8/openGym (`README.md`, `NOTICE.md`, commit `6dfb36c4`, issue
  https://github.com/DuarteSantos8/openGym/issues/332)
- exercises-dataset: https://github.com/hasaneyldrm/exercises-dataset (`LICENSE`, `NOTICE.md`, `README.md`)
- MuscleWiki API: https://api.musclewiki.com/api-terms y https://api.musclewiki.com/pricing.md
- Wikimedia Commons (API de categorías): https://commons.wikimedia.org/w/api.php
- CC BY-SA 4.0, texto legal: https://creativecommons.org/licenses/by-sa/4.0/legalcode.en
- Cloudflare R2: https://developers.cloudflare.com/r2/pricing/ y
  https://developers.cloudflare.com/r2/buckets/public-buckets/

No se pudieron abrir:

- **Términos de Gym visual** (https://gymvisual.com/content/3-terms-and-conditions-of-use): HTTP 403. Se usaron
  las citas de esos términos que hacen el NOTICE de openGym y el del dataset.
- **Términos de wger.de** (https://wger.de/en/software/terms-of-service): página antibots (Anubis). La plantilla
  del repo (`wger/software/templates/tos.html`) está vacía. Las licencias salen de la API.
- **Documentación del ExerciseDB v1 gratis** (https://oss.exercisedb.dev/docs): sin contenido legible. Los
  enlaces `dub.sh` del README de ExerciseDB devuelven 403.
- **Términos de musclewiki.com** (web principal): 403. Se usaron los de su API.
- **Wikimedia Commons:** la API cortó con 429 tras unas pocas consultas. Las cifras de Commons son parciales.
