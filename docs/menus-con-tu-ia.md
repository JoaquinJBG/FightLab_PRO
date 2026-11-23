# Menús con tu IA (coste 0)

FightLab no usa ninguna IA de pago para los menús. Hay tres formas de preparar un menú, y las tres
pasan por el motor de FightLab, que comprueba cada día contra tus objetivos de kcal, proteína,
grasa y fibra, que no se repitan platos y tus alergias:

| Forma | Dónde | Qué hace | Etiqueta en Menú |
|---|---|---|---|
| **B. Skill de Claude Code** (la principal) | Tu PC | Tu Claude (tu suscripción) descarga tus datos, prepara el menú, lo comprueba con el motor y lo sube. | IA del usuario |
| **C. Copiar y pegar** | El móvil | «Prepararlo con mi IA» copia tus datos y las instrucciones; los pegas en claude.ai u otra IA y pegas su respuesta en la app. | IA del usuario |
| **A. Automático** (el respaldo) | La app | «Preparar menú», sin IA: platos de FightLab y de tus menús anteriores, con tus gustos, tus comensales y Mi cocina. | Automático |

Los archivos que importas en Menú → Importar un menú (JSON de la app, YAML del coach o ParteDiario)
salen como «Importado».

## B. Desde el PC con Claude Code

Necesitas [Claude Code](https://claude.com/claude-code) con tu cuenta de Claude y Python 3.9 o
posterior (`python`, `py -3` o `uv run python`). El script de la skill solo usa la biblioteca
estándar de Python: no instala nada ni llama a ninguna IA.

### 1. Instala la skill

Copia la carpeta `tools/claude-skill/fightlab-menu` del repositorio a tu carpeta de skills de
Claude Code.

En Windows (PowerShell), desde la carpeta del repositorio:

```powershell
New-Item -ItemType Directory -Force "$env:USERPROFILE\.claude\skills" | Out-Null
Copy-Item -Recurse -Force tools\claude-skill\fightlab-menu "$env:USERPROFILE\.claude\skills\"
```

En macOS o Linux:

```bash
mkdir -p ~/.claude/skills
cp -r tools/claude-skill/fightlab-menu ~/.claude/skills/
```

Sin el repositorio, descarga los dos archivos de esa carpeta (`SKILL.md` y `fightlab_menu.py`) de
GitHub a `~/.claude/skills/fightlab-menu/`.

### 2. Crea un token personal

En FightLab: **Perfil → Mi IA → Tokens personales**. Ponle un nombre (por ejemplo «PC de casa») y
pulsa «Crear token».

- El token (`flm_…`) **solo se ve esa vez**: cópialo ya.
- Solo sirve para leer los datos del menú y subir menús. No abre nada más de tu cuenta.
- Si lo pierdes o crees que alguien lo ha visto, revócalo en la misma pantalla y crea otro.
- Puedes tener hasta 5 activos (uno por PC, por ejemplo).

### 3. Guarda el token y la dirección en tu PC

Nunca en un repositorio ni en un archivo que compartas. Lo más sencillo es un archivo en tu carpeta
de usuario, `~/.config/fightlab/`, que el script lee solo.

En Windows (PowerShell):

```powershell
New-Item -ItemType Directory -Force "$env:USERPROFILE\.config\fightlab" | Out-Null
Set-Content -NoNewline -Encoding utf8 "$env:USERPROFILE\.config\fightlab\token" "flm_PEGA_AQUI_TU_TOKEN"
Set-Content -NoNewline -Encoding utf8 "$env:USERPROFILE\.config\fightlab\url" "https://LA_DIRECCION_DE_MI_IA/api/ext"
```

En macOS o Linux:

```bash
mkdir -p ~/.config/fightlab && chmod 700 ~/.config/fightlab
printf '%s' 'flm_PEGA_AQUI_TU_TOKEN' > ~/.config/fightlab/token && chmod 600 ~/.config/fightlab/token
printf '%s' 'https://LA_DIRECCION_DE_MI_IA/api/ext' > ~/.config/fightlab/url
```

La dirección es la que enseña **Perfil → Mi IA** («Dirección para la skill»): la de la app
terminada en `/api/ext`.

También valen las variables de entorno `FIGHTLAB_TOKEN` y `FIGHTLAB_URL` (o `FIGHTLAB_TOKEN_FILE`
con la ruta de otro archivo). Las variables mandan sobre los archivos.

### 4. Pídele el menú a Claude

Abre Claude Code en cualquier carpeta y pide, por ejemplo, «menú de la semana» o
`/fightlab-menu 7 días, comida en tupper`. La skill:

1. te pregunta los días, el inicio y las comidas (si no se lo has dicho);
2. descarga tu contexto: objetivos del día, gustos, recetario, Mi cocina, los alimentos que conoce
   el motor, tu catálogo resumido y tus menús recientes;
3. escribe el menú en el JSON `schema: 1`;
4. lo comprueba con el motor de FightLab sin guardar nada, y corrige los días que no pasan;
5. te enseña el resumen y lo sube. Si ya hay otro menú que empieza ese día, te pregunta antes de
   sustituirlo.

El menú aparece en **Nutrición → Menú** con la etiqueta «IA del usuario». Si vuelves a subir el
mismo menú (mismo `id`), sustituye al anterior y se queda lo tachado de la lista de la compra.

### Qué datos salen de FightLab

El contexto lleva solo lo necesario para el menú: los objetivos del día (sin peso ni datos del
perfil), tus gustos y alergias, tus platos valorados, tu menaje y las restricciones de tus
comensales (sin sus nombres), los alimentos de la tabla con sus valores, tu catálogo de la cadena
resumido y los platos de tus últimos menús. Se lo das a tu Claude con tu cuenta. La skill lo guarda
en una carpeta temporal y lo borra al acabar.

### Problemas frecuentes

- `ERROR: FIGHTLAB_URL is not set` o `No personal token`: revisa el paso 3.
- `401 … Token no válido o revocado`: el token está revocado o mal copiado. Crea otro.
- `no_calorie_targets`: FightLab no tiene objetivos de kcal para ti ahora mismo (por un aviso de
  seguridad o un dato que falta). La app te dice por qué en Nutrición.
- La primera petición tarda: el servidor gratuito puede tardar hasta un minuto en despertar.

## C. Desde el móvil, copiando y pegando

1. En **Nutrición → Menú**, elige los días y las comidas del formulario.
2. Pulsa **«Prepararlo con mi IA»**: se copia un texto con las instrucciones y tus datos. Si el
   móvil no deja copiar solo, sale en un cuadro para copiarlo a mano.
3. Pégalo en claude.ai (o en otra IA) y copia su respuesta entera.
4. Pégala en **«Pega aquí la respuesta de tu IA»** y pulsa «Comprobar y guardar».

La app quita sola las marcas de código (```` ```json ````) y el texto de alrededor. Si el JSON no
vale, te dice qué falla (por ejemplo, «línea 3, columna 5» o el plato que no existe) para que se lo
pidas corregido a tu IA. Cuando se guarda, te dice cuántos días cuadran con tus objetivos y cuáles
no: pide a tu IA que ajuste esos días y vuelve a pegarlo (sustituye al anterior).

## A. Automático, sin IA

El botón **«Preparar menú»** de siempre. No usa ninguna IA: elige platos de la tabla de FightLab,
de tu recetario (los que valoraste) y de tus menús anteriores, sin los que chocan con tus gustos o
con las restricciones de tus comensales, y sin los que necesitan un aparato que no tienes en Mi
cocina (un paso de wok se hace en sartén, el de olla exprés en olla, y el horno y la air fryer se
sustituyen entre sí). Escala las cantidades hacia tu objetivo y el motor comprueba cada día.

## Para desarrolladores

- API con el token (`Authorization: Bearer flm_…`): `GET /api/v1/menu/context` y
  `POST /api/v1/menu/import` (`{"menu": …, "dry_run": true|false, "replace_start": true|false}`).
  La app los expone a la skill en `/api/ext/menu/context` y `/api/ext/menu/import`
  (`frontend/app/api/ext/menu/[action]/route.ts`). Ninguna otra ruta acepta el token.
- Con la sesión de la app: `GET /api/v1/coach/menu/context`, `POST /api/v1/coach/menu/paste` y
  `GET|POST /api/v1/coach/menu-tokens`, `DELETE /api/v1/coach/menu-tokens/<id>`.
- En local, `FIGHTLAB_URL=http://127.0.0.1:8000/api/v1` habla con Django directamente.
- Código: `backend/coaching/menu_tokens.py`, `menu_context.py`, `menu_ai_views.py`;
  `frontend/lib/menu-ai.ts`, `components/menu/AiMenuCard.tsx`, `app/(shell)/profile/my-ai/`.
