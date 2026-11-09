# Prueba en móvil real: `feat/beta-coach` (9 de noviembre de 2026)

**Qué se probó.** La rama `feat/beta-coach` (66f48e2, con F10 y F11) montada **en local** en el PC y
abierta en el móvil del usuario: Honor FCP-N49 plegado (pantalla exterior, 353×681 CSS, dpr 3),
Android, Chrome 156. El móvil llega al PC por `adb reverse` (depuración inalámbrica) y se maneja por
CDP (Playwright) y `adb shell input` (toques y teclado reales). Producción y el entorno alojado no se
han tocado.

**Cuentas.** La cuenta demo de `seed_demo` (`demo@fightlab.test`, 28 días de datos) y una segunda
cuenta nueva (`prueba2@fightlab.test`) con el alta completa. Contraseñas de prueba generadas en el PC,
solo en el `.env` local (sin commit). Sin `ANTHROPIC_API_KEY`: el chat responde por reglas.

**Resumen.** La app funciona de punta a punta en el móvil y se puede usar a diario: alta, Hoy,
check-in, entrenos, plan, revisión, menú con PDF, importar historial y PWA. **Ningún fallo bloquea.**
Antes de dejar Entrenador IA conviene arreglar **F3** (seguridad del chat por reglas), **F2** (datos
de gimnasio corruptos) y **F1** (historial que parece borrado).

Hoja de contacto: [`capturas/00-hoja-de-contacto.jpg`](capturas/00-hoja-de-contacto.jpg).

---

## Fallos, por gravedad

Gravedad: **bloquea** (no se puede usar), **molesta** (se usa, pero confunde, da datos malos o
inseguros) y **menor** (detalle). Ninguno bloquea.

### Molesta

#### F3. El chat por reglas anima a entrenar duro con dolor (seguridad, prioridad alta)
- **Pasos:** Coach → escribir «me duele la rodilla después del sparring, ¿entreno hoy?» → Enviar
  (sin IA: sin clave, con la cuota agotada o si la API falla).
- **Resultado:** «Recuperación por encima de tu media y +20 % sobre tu media de 4 semanas: **dale duro
  hoy, tienes margen**. Calienta bien.»
- **Esperado:** el modo por reglas no debería contestar a mensajes con dolor o lesión con un «dale
  duro». Debería llevar a la regla de dolor nuevo o a «para y consulta», como hacen el check-in y el
  cribado.
- Captura: [`13-coach-reglas-dale-duro.jpg`](capturas/13-coach-reglas-dale-duro.jpg).

#### F2. El peso de una serie admite texto mal formado y corrompe el entreno
- **Pasos:** Entreno → Gimnasio → Empezar entreno → Sentadilla → «toca para copiar» la serie anterior
  y ✓ → «+ Serie» (sale ya rellena con 92.5 / 6) → tocar el campo kg (el cursor cae en medio del
  número) → escribir «95,5».
- **Resultado:** el campo queda en **«9295,.»** y lo acepta, igual que las 65 repeticiones. Al
  terminar, el resumen muestra **610.938 kg totales** y «3 series». En la base de datos,
  `Activity.detail` guarda `{"kg": 9295, "reps": 65}` y `volume_kg: 610938`, pero `SetLog` solo tiene
  2 series: la absurda se descarta **sin avisar**. Lo que se ve y lo que se guarda no coinciden.
- **Esperado:** no dejar más de un separador decimal, avisar de valores imposibles (más de 500 kg o
  más de 100 repeticiones, por ejemplo) y no mostrar un total que el servidor no guarda. Que «+ Serie»
  rellene los campos está bien, pero con el número seleccionado al tocar sería más fácil cambiarlo.
- Capturas: [`11-gym-peso-malformado.jpg`](capturas/11-gym-peso-malformado.jpg),
  [`12-gym-resumen-610938kg.jpg`](capturas/12-gym-resumen-610938kg.jpg).

#### F1. Al guardar una sesión de MMA, el historial «desaparece» hasta recargar
- **Pasos:** con la caché local vacía (móvil nuevo, datos borrados o primer uso tras importar; se
  reproduce borrando la clave `flp_mma` de `localStorage`) → Entreno → MMA → Guardar sesión.
- **Resultado:** la lista pasa de **9 sesiones a 1** y «Este mes» pasa a 1 sesión. Al recargar salen
  las 10. No se pierden datos, pero parece que se ha borrado el historial. Se ha reproducido 2 veces.
- **Relacionado:** en Gimnasio, «Últimos entrenos» solo muestra la sesión hecha en este móvil. Las 4
  sesiones de gimnasio de la demo, que están en el servidor, no aparecen ni al recargar. Puede ser la
  misma causa: la lista sale de la caché local y no del servidor.
- Capturas: [`08-mma-lista-antes.jpg`](capturas/08-mma-lista-antes.jpg) →
  [`09-mma-lista-tras-guardar.jpg`](capturas/09-mma-lista-tras-guardar.jpg) →
  [`10-mma-lista-tras-recargar.jpg`](capturas/10-mma-lista-tras-recargar.jpg).

#### F4. Chat del coach: ventana diminuta y la respuesta queda fuera de la vista
- **Pasos:** Coach → tocar «Pregunta a tu coach…» → escribir → Enviar con el teclado abierto.
- **Resultado:** la conversación vive en una caja con scroll propio de **137 px de alto** (cabe una
  burbuja). Con el teclado abierto, la barra de navegación sube encima del teclado y la respuesta queda
  fuera de la vista: hay que cerrar el teclado y hacer scroll.
- Capturas: [`14-coach-respuesta-oculta.jpg`](capturas/14-coach-respuesta-oculta.jpg),
  [`13-coach-reglas-dale-duro.jpg`](capturas/13-coach-reglas-dale-duro.jpg).

#### F5. Sin conexión: la PWA no tiene pantalla propia y no avisa de lo pendiente
- **Pasos:** abrir la PWA instalada → quitar la red (CDP `setOffline`) → cambiar de pestaña o recargar.
- **Resultado:** sale la página genérica de Chrome «No tienes conexión». El service worker no guarda
  nada en caché, por diseño («Modo ONLINE»), así que en un gimnasio sin cobertura no se puede ni abrir.
  Sin red, marcar «Movilidad» o guardar el peso **no da ninguna señal** (el botón no cambia y el peso
  sigue con el valor anterior), pero se envía solo al volver la red. Quien toque dos veces dejará en
  cola dos cambios contrarios.
- **Esperado:** como mínimo, una página propia sin conexión y un aviso de «pendiente de enviar».
- Captura: [`25-pwa-sin-conexion.jpg`](capturas/25-pwa-sin-conexion.jpg).

#### F6. Marcar una comida del menú como hecha no suma a las kcal del día
- **Pasos:** Hoy → Desayuno → «Hecha» → Nutrición.
- **Resultado:** Nutrición sigue en **0 / 2793 kcal**. Las marcas de Hoy (hecha, no hecha, cambiada)
  no llegan al diario de comidas. Si es a propósito (adherencia y no ingesta), la app debería decirlo,
  porque quien viene de ParteDiario espera que cuente.
- Captura: [`06-hoy-demo.jpg`](capturas/06-hoy-demo.jpg).

#### F7. Revisión semanal: los contadores no cuadran con la lista
- **Pasos:** Entreno → Revisión semanal → Rehacer la revisión.
- **Resultado:** «Gimnasio: 2 de 2», pero en la lista «3 nov · Gimnasio A» y «6 nov · Gimnasio B»
  salen como «No registrada», porque los gimnasios se hicieron en días de cardio. «MMA: 3 de 2». Además,
  la lista empieza por el 9 de noviembre y sigue con el 3.
- Captura: [`16-revision-contadores.jpg`](capturas/16-revision-contadores.jpg).

#### F8. Avisos: «Activar los avisos aquí» no hace nada visible si el permiso no sale
- **Pasos:** Perfil → Avisos → Activar los avisos aquí, en un Chrome que tiene las notificaciones
  bloqueadas a nivel de Android (como el de este móvil).
- **Resultado:** el permiso se queda en `default` (Chrome lo bloquea en silencio, con el icono de la
  campana tachada en la barra) y la app **no dice nada**. `RemindersSettings` solo trata `denied`.
- **Esperado:** si el permiso no queda concedido, explicar cómo activarlo (Ajustes de Android → Apps →
  Chrome → Notificaciones, y el candado de la barra).
- Captura: [`22-avisos-sin-respuesta.jpg`](capturas/22-avisos-sin-respuesta.jpg).

#### F9. El plan propone «Cardio moderado · 5 min» (por confirmar)
- **Dónde:** el plan de la demo tiene lunes, miércoles y sábado con «Cardio moderado · 5 min», y Hoy
  muestra «Plan del día: Cardio, 5 min». Una sesión de 5 minutos no tiene sentido. Puede venir del
  motor (lo que falta para llegar a 150 min repartido) o de `seed_demo`. Hay que mirarlo con una cuenta
  real antes de dar el plan por bueno.
- Captura: [`06-hoy-demo.jpg`](capturas/06-hoy-demo.jpg).

### Menor

| # | Qué pasa | Dónde |
|---|---|---|
| F10 | Alta: «Paso 3 de 7» sale dos veces («Lo básico» y «Tu peso»), así que hay 8 pantallas para 7 pasos. «← Atrás» es `type=submit`. | [`03-alta-paso-3-repetido.jpg`](capturas/03-alta-paso-3-repetido.jpg) |
| F11 | Fecha «Lunes, 9 **De** Noviembre» (la «de» va en minúscula). | Hoy, todas las capturas |
| F12 | Decimales con punto en la interfaz en español: «92.5 kg», «80.1 KG» (Coach y chat), «610.938» (¿miles o decimales?). Fecha de nacimiento en ISO en Perfil («1990-06-15») y fechas ISO en el PDF. | Gimnasio, Coach, Perfil, PDF |
| F13 | Perfil muestra «ATHLETE» en inglés con la app en español. | Perfil |
| F14 | Error de hidratación de React #418 en la consola en `/training` y `/training/load` (el HTML del servidor no coincide con el del cliente, probablemente la carga leída de `localStorage`). | Consola (CDP) |
| F15 | Tras «Cerrar sesión», la URL es `/login?reason=expired` (no ha caducado) y siguen saliendo peticiones a `/me`, `/me/profile` y `/coach/safety` que dan 401. | Consola y log del BFF |
| F16 | El icono de la PWA es una «F» y el logo de la app dice «FL». | [`23-pwa-instalar.jpg`](capturas/23-pwa-instalar.jpg) |
| F17 | Importar con solo archivos ilegibles dice «No hay nada nuevo que importar: todo lo de los archivos ya estaba» y deja el botón «Importar». | [`21-importar-archivos-malos.jpg`](capturas/21-importar-archivos-malos.jpg) |
| F18 | La barra flotante del descanso entre series tapa el botón «Terminar entreno». | [`11-gym-peso-malformado.jpg`](capturas/11-gym-peso-malformado.jpg) |
| F19 | Accesibilidad: 12 botones sin nombre en Nutrición. Los botones del tipo de día («Gimnasio/Cardio/Descanso») no llevan `aria-pressed` (las comidas sí). | Nutrición, Hoy |
| F20 | Algunas evidencias enseñan al usuario el texto pensado para el motor («El texto del coach puede decir…», «la app no debe decir…»). | Popup de «Evidencia emergente» en Coach |
| F21 | En horizontal (emulado por CDP, 760×330), la barra de navegación ocupa 97 de 330 px (29 %). La PWA instalada está fijada en vertical (`orientation: portrait`). | — |
| F22 | Check-in → «Volver al inicio» lleva a `/dashboard` (Resumen) y no a Hoy, que ahora es el inicio. | [`07-checkin-guardado.jpg`](capturas/07-checkin-guardado.jpg) |
| F23 | Con una lesión en el alta, la tarjeta de seguridad ocupa toda la primera pantalla de Hoy cada día. | [`05-alta-nueva-hoy.jpg`](capturas/05-alta-nueva-hoy.jpg) |
| F24 | Redondeo: Nutrición dice proteína 160 g y Menú «al menos 161 g». | Nutrición, Menú |
| F25 | `docker-compose.yml` no lanza `createcachetable`: sin esa tabla, el registro da 500 y la app dice «No se pudo registrar». El README sí lo pone. | Entorno local |

---

## Qué funciona

- **Registro y verificación:** el email no invitado se rechaza («Registro solo por invitación»), la
  contraseña corta se avisa en vivo, el email de verificación sale por consola y el enlace verifica.
- **Alta nueva con cribado** (cuenta nueva): idioma y región, relación con la comida (no deja seguir sin
  las 5 respuestas), datos básicos con fecha de 3 campos que salta sola, peso con coma («84,5» se guarda
  bien), PAR-Q+ con enlace oficial, señales de alarma, medicación, objetivo, deportes y lesión. Termina
  con la tarjeta de seguridad de la lesión. Perfil, objetivos de kcal y macros calculados.
  «Repetir el cribado» (`/onboarding?redo=1`) abre el cribado para cuentas existentes.
- **Teclado:** en el alta, el pesaje, el check-in, las series y el chat **el teclado no tapa el campo**
  (la página sube). El teclado numérico sale con `inputmode=decimal`, y la coma funciona.
- **Hoy:** pesaje (80,1 → guardado), comidas hecha, no hecha y cambiada con «¿Qué comiste en su
  lugar?», tipo de día a mano con «Volver a lo del plan», entreno hecho, movilidad y cardio (Trote 30 min
  moderado → 30 de 150). **Todo sigue ahí al recargar.**
- **Check-in:** escalas 1-5, agujetas, cintura, horas (7,5) y alarmas (el resfriado da su aviso). La
  respuesta del readiness sale con su evidencia.
- **Entreno:** MMA (arte, tipo, duración y RPE con +/-, gasto estimado del Compendio, golpe en la
  cabeza), gimnasio en sesión (buscador, última vez y e1RM, copiar la serie anterior, temporizador de
  descanso, RPE y carga), plan de la semana, Mi rutina con progresión por ejercicio, revisión semanal
  rehecha y aceptada.
- **Menús F8:** menú de 7 días comprobado por el motor, lista de la compra agrupada y **PDF**
  (`/api/menu-pdf/1`, 17 KB, 11 páginas, con acentos bien). Captura de la primera página:
  [`18-menu-pdf-pagina1.jpg`](capturas/18-menu-pdf-pagina1.jpg).
- **Importar historial F10**, con archivos inventados (copia JSON de ParteDiario, CSV semanal de
  ParteDiario, `checkins.csv`, una revisión `AAAA-MM-DD.md` y un CSV de gimnasio genérico): la vista
  previa cuenta bien (8 días nuevos y 1 en conflicto), «Conservar lo de FightLab» respeta el dato que
  había, **reimportar no duplica nada** («8 días ya estaban igual», «3 series ya estaban») y los
  archivos malos se explican uno a uno.
- **Coach:** briefing, recomendaciones y chat por reglas con aviso de «IA no disponible».
- **Evidencias:** el popup abre con la regla, su nivel y sus límites.
- **Idioma ES/EN:** el cambio en Editar perfil se aplica a toda la interfaz (Hoy, Plan, Coach y Menú).
  Los nombres de los platos siguen en español porque son datos.
- **Cron de avisos:** `/api/cron/tick` responde 401 sin secreto o con uno malo, y 200 con el bueno
  (`enabled: true`, llega al backend).
- **PWA:** se instala desde el menú de Chrome («Instalar y crear acceso directo» → Instalar, WebAPK) y
  se abre desde el icono a pantalla completa (`display-mode: standalone`) en `/today`.
- **Rendimiento (en local, no representa Render):** cada pantalla carga en 0,8–1,25 s hasta
  `networkidle`, con TTFB de 20–70 ms. No hay texto cortado ni scroll horizontal en 14 pantallas.
- **Logs:** el backend no ha dado ningún 500 fuera del montaje (ver F25). Los 503 del chat son el
  aviso de «IA no configurada», como está previsto.

---

## Lo que no se pudo probar, y por qué

- **Que llegue un aviso push al móvil.** El Chrome del usuario tiene **las notificaciones desactivadas
  en Android** (`POST_NOTIFICATIONS granted=false`). Activarlas es un ajuste del sistema de su móvil y
  no se ha tocado. Para probarlo: Ajustes → Apps → Chrome → Notificaciones → activar; después, en la app,
  Perfil → Avisos → Activar → «Mandar uno de prueba». Además, la ruta del cron solo envía en la hora de
  cada aviso (pesarse a las 8, revisión los martes a las 10, movilidad a las 18 y víspera a las 22, hora
  local), así que lanzarla a mano a otra hora no envía nada, como dice `DEPLOY.md`.
- **Rotación real.** Haría falta cambiar el giro automático del sistema, y la PWA está fijada en
  vertical. Se ha emulado por CDP (ver F21).
- **Pantalla interior del plegable.** El móvil está plegado.
- **Chat con IA y foto de comida:** sin `ANTHROPIC_API_KEY`, a propósito (coste 0 €).
- **Descarga del PDF al móvil.** Para no dejar archivos en su almacenamiento, la descarga se captura en
  la página y el PDF se comprueba desde el PC. El botón sí pide el PDF y le pone su nombre
  (`fightlab-menu-2026-11-09.pdf`).
- **Entorno alojado** (Render dormido, cookies entre Vercel y Render, Neon): fuera del alcance de esta
  prueba local.
- **Tema claro u oscuro:** no hay ajuste de tema; la app solo tiene tema oscuro.
- **Sin probar por tiempo:** Deportes, Biometría, Herramientas (temporizador de asaltos), «Avisar de un
  golpe en la cabeza», cambiar un plato del menú, gustos y búsqueda de productos, «Olvidé mi
  contraseña» y «Contarle a mi coach».

---

## Cómo se montó (para repetirlo)

- Postgres con `pgserver` en `C:\fl\prueba\pgdata` (carpeta nueva). **Ojo:** el binario de `pgserver`
  para Windows no trae `share/postgresql/timezone`, y Django falla con `invalid value for parameter
  "TimeZone": "UTC"`. Se arregla copiando la carpeta `zoneinfo` del paquete `tzdata` en
  `pgserver/pginstall/share/postgresql/timezone` y reiniciando.
- Backend: venv en `C:\fl\prueba\venv` (Python 3.12, `uv`), `PYTHONPATH=vendor/ai-personal-coach`,
  `migrate`, **`createcachetable`**, `sync_knowledge --force`, `seed_demo` y `runserver 127.0.0.1:8765`.
  `.env` en la raíz del worktree: `DEBUG=True`, `EMAIL_PROVIDER=console`, `BETA_ALLOWED_EMAILS`, el
  `BFF_SHARED_SECRET` y un par VAPID de prueba, todo generado en el PC y sin commit.
- Frontend: `pnpm build` + `pnpm start -p 3456` (modo producción, como Vercel), con `DJANGO_API_URL`,
  `BFF_SHARED_SECRET`, `CRON_SECRET` y `NEXT_PUBLIC_VAPID_PUBLIC_KEY` en `frontend/.env.local`.
- Móvil: `adb reverse tcp:3456 tcp:3456`, `adb forward tcp:9222 localabstract:chrome_devtools_remote` y
  Playwright `connectOverCDP`. Las capturas, con `screencap -d <id de la pantalla exterior>`, porque el
  móvil tiene dos pantallas.
- Datos de prueba modificados: solo la cuenta demo y la cuenta `prueba2` de la base local. Un toque de
  `adb` cayó en la PWA en vez de en Chrome y mandó un `POST /coach/today` de la cuenta demo, sin más
  efecto.
- Lo que queda en el móvil: la PWA de prueba «FightLab Pro» (WebAPK de `localhost`, que sin el PC no
  abre nada) y una pestaña de Chrome en `localhost:3456`. No se han quitado para no tocar nada que
  pudiera ser de antes: el usuario puede desinstalar ese icono y cerrar la pestaña.
