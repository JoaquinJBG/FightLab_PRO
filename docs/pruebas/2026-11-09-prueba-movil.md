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
check-in, entrenos, deportes, biometría, temporizador, plan, revisión, menú con PDF, importar
historial, recuperar contraseña y PWA. **Ningún fallo bloquea.** Antes de dejar Entrenador IA conviene
arreglar **F3 y F26** (seguridad: el chat por reglas no tiene en cuenta el dolor, la lesión ni un golpe
en la cabeza), **F2** (datos de gimnasio corruptos) y **F1** (historial que parece borrado).

La prueba se hizo en dos rondas: la primera por la mañana y la segunda, a partir de las 11:15, cuando
el usuario dejó Chrome abierto para seguir (deportes, biometría, herramientas, golpe en la cabeza,
memoria del coach, gustos del menú y recuperar contraseña).

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
- **Segunda ronda:** se guardó en «Contarle a mi coach» la lesión «Rodilla derecha tras sparring» y se
  volvió a preguntar «me duele la rodilla, ¿entreno hoy?». Respuesta: «Hoy no es el día de matarte: FC
  reposo… Técnica de calidad (RPE 5-6) y a dormir». Habla de la FC y la HRV, pero **no menciona ni el
  dolor ni la lesión guardada**.
- Capturas: [`13-coach-reglas-dale-duro.jpg`](capturas/13-coach-reglas-dale-duro.jpg),
  [`33-coach-memoria-y-dolor.jpg`](capturas/33-coach-memoria-y-dolor.jpg).

#### F26. Tras avisar de un golpe en la cabeza con síntomas, el chat y el plan activo no lo tienen en cuenta (seguridad, prioridad alta)
- **Pasos:** Entreno → MMA → «Avisar de un golpe en la cabeza» → síntomas: Sí, alarma: No → Guardar
  aviso. La tarjeta dice bien «CONTACTO BLOQUEADO» y Hoy muestra «El día del golpe, no entrenes».
  Después: Coach → «¿Entreno fuerte hoy?».
- **Resultado:**
  - El chat por reglas contesta «Técnica de calidad (RPE 5-6) y a dormir», sin nombrar el golpe,
    cuando Hoy dice que ese día no se entrena.
  - El briefing del Coach sigue con «Ir a entrenar».
  - El plan de la semana **ya activo** sigue ofreciendo el jueves «Sparring duro, Competición, Rolls
    duros…». Solo al pulsar «Volver a preparar» pasan a «Fuera esta semana: sin contacto hasta el alta
    de un clínico», y eso sí está bien.
- **Esperado:** que el aviso de golpe actualice el plan activo (o avise de que hay que rehacerlo) y que
  el chat por reglas lo ponga por delante de cualquier otra cosa.
- Capturas: [`30-golpe-contacto-bloqueado.jpg`](capturas/30-golpe-contacto-bloqueado.jpg),
  [`31-coach-tras-golpe.jpg`](capturas/31-coach-tras-golpe.jpg),
  [`32-plan-rehecho-tras-golpe.jpg`](capturas/32-plan-rehecho-tras-golpe.jpg).

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
  misma causa: la lista sale de la caché local y no del servidor. Pasa lo mismo en Deportes: «Tu
  actividad» solo enseña la carrera de hoy y no las 5 sesiones de deporte de la demo
  ([`27-deporte-solo-sesion-local.jpg`](capturas/27-deporte-solo-sesion-local.jpg)).
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
  motor (lo que falta para llegar a 150 min repartido) o de `seed_demo`. **Segunda ronda:** con 124 de
  150 min ya hechos, «Volver a preparar» deja esos días en «Descanso». Eso apunta al motor: reparte lo
  que falta hasta 150 en sesiones sueltas, aunque salgan de 5 minutos. Conviene poner un mínimo por
  sesión (por ejemplo 20 min) o juntar lo que falta en menos días.
- Captura: [`06-hoy-demo.jpg`](capturas/06-hoy-demo.jpg).

### Menor

| # | Qué pasa | Dónde |
|---|---|---|
| F10 | Alta: «Paso 3 de 7» sale dos veces («Lo básico» y «Tu peso»), así que hay 8 pantallas para 7 pasos. «← Atrás» es `type=submit`. | [`03-alta-paso-3-repetido.jpg`](capturas/03-alta-paso-3-repetido.jpg) |
| F11 | Fecha «Lunes, 9 **De** Noviembre» (la «de» va en minúscula). | Hoy, todas las capturas |
| F12 | Decimales con punto en la interfaz en español: «92.5 kg», «80.1 KG» (Coach y chat), «610.938» (¿miles o decimales?). Fecha de nacimiento en ISO en Perfil («1990-06-15») y fechas ISO en el PDF. | Gimnasio, Coach, Perfil, PDF |
| F13 | Perfil muestra «ATHLETE» en inglés con la app en español. | Perfil |
| F14 | Error de hidratación de React #418 en la consola en `/training` y `/training/load` (el HTML del servidor no coincide con el del cliente, probablemente la carga leída de `localStorage`). | Consola (CDP) |
| F15 | Tras «Cerrar sesión» a propósito, la pantalla de entrada dice **«Sesión caducada. Vuelve a iniciar sesión para continuar.»** (URL `/login?reason=expired`), y siguen saliendo peticiones a `/me`, `/me/profile` y `/coach/safety` que dan 401. | [`35-cerrar-sesion-caducada.jpg`](capturas/35-cerrar-sesion-caducada.jpg) |
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
| F27 | «Elige una contraseña nueva» no tiene un campo de usuario (oculto, con `autocomplete="username"`). Chrome no sabe de qué cuenta es: sugiere su propia contraseña y después pide «Añade tu nombre de usuario». En la prueba, Chrome puso su contraseña sugerida en los dos campos y fue la que se guardó en la cuenta de prueba. | Recuperar contraseña |
| F28 | Hay dos pesajes el mismo día (el de Hoy a las 8:00 y uno de Biometría a las 11:21) y no queda claro cuál cuenta. Biometría también usa punto decimal («80.3 kg», «IMC 25.4»), y «← Inicio» lleva a `/dashboard`. | [`28-biometria-guardada.jpg`](capturas/28-biometria-guardada.jpg) |
| F29 | Al preparar otro menú con la cena de hoy marcada «No hecha», la marca pasa al plato nuevo (de «Calamar…» a «Solomillo de cerdo…»), un plato que nunca estuvo en el día. | Hoy, tras «Preparar otro menú» |
| F30 | Varios `POST /auth/refresh` seguidos (4 a la vez) al volver a la app: parece que varias peticiones renuevan el token a la vez en lugar de esperar a una sola. | Log del backend |

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
- **Deportes:** el cronómetro de Correr (intensidad, kcal en vivo) **sigue contando con la app en
  segundo plano** (52 s reales, 00:52 en pantalla). «Mantén para parar» funciona con pulsación larga.
  La sesión se guarda con RPE y formato, y suma al cardio de Hoy (vigoroso ×2) junto con el MMA.
  [`26-deporte-cronometro.jpg`](capturas/26-deporte-cronometro.jpg)
- **Biometría:** la nueva medición guarda peso (la coma pasa a punto sin problema), FC en reposo y HRV,
  y activa el estado de readiness («Tómatelo suave»). Tendencia e IMC con su evidencia, gráfica por
  rangos, y borrar pide confirmación en dos toques («¿Borrar?»).
- **Herramientas:** el temporizador de asaltos (preset Tabata 8 × 20 s/10 s) cambia bien entre
  Prepárate, Trabajo y Descanso, va **exacto** frente al reloj (12 muestras cada 2 s) y pide
  `wakeLock` para que no se apague la pantalla.
  [`29-timer-rounds.jpg`](capturas/29-timer-rounds.jpg)
- **Golpe en la cabeza:** la tarjeta «Contacto bloqueado» explica la vuelta al contacto en 6 pasos con
  el CRT6 oficial, y Hoy muestra el aviso de seguridad. «Volver a preparar» el plan saca todo el
  contacto con su motivo (ver F26 para lo que falla).
- **Memoria del coach:** «Contarle a mi coach» guarda la lesión, el objetivo de peso y el tono, y los
  enseña como etiquetas.
- **Menú:** valorar un plato («No lo repetiría»), guardar gustos («No te gusta: calamar») y preparar
  otro menú de 3 días en 5,5 s. **Ni el kéfir ni el calamar vuelven a salir.**
  [`34-menu-nuevo-gustos.jpg`](capturas/34-menu-nuevo-gustos.jpg)
- **Recuperar contraseña:** el email llega (por consola), el enlace abre «Elige una contraseña nueva»,
  la cambia, y se entra con la nueva (ver F27).
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
- **Búsqueda de productos del súper (Open Food Facts):** está apagada sin `COACH_OFF_CONTACT`, como
  dice `DEPLOY.md`.
- **Sonido del temporizador** (aviso de fin de asalto): no se puede oír por adb.
- **Fotos** (de progreso y de tickets): no se han subido para no tocar la galería del móvil.

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
- **Gestor de contraseñas de Google:** Chrome ofreció tres veces guardar contraseñas de `localhost`. Las
  tres se cerraron sin guardar (deslizar, «Cancelar»). Pero en «Elige una contraseña nueva» Chrome puso
  su contraseña sugerida (ver F27), y Chrome a veces guarda solo las contraseñas que sugiere. Conviene
  que el usuario mire en passwords.google.com si hay alguna entrada de `localhost` y la borre: es de una
  cuenta de prueba local, sin valor.

---

## Ronda 3 (9-nov-2026, tarde): `feat/beta-coach` 5301609, arreglos A, F12, F13 y F29

Pasada corta que pidió el jefe de FightLab para comprobar los arreglos. El montaje es el mismo (local,
el móvil por adb, Chrome 156), con una **base de datos nueva** (`fightlab3`, con las migraciones
coaching 0010/0011 y tickets 0001) y `seed_demo` otra vez. Antes de empezar no había ningún lock. Había
un `adb forward tcp:9222` viejo de otra sesión, sin conexiones, y no se tocó: esta ronda usa 9223.

Archivos de prueba: el menú de ejemplo `para-amigo/menu-ejemplo.json` del Entrenador IA (un ejemplo,
no datos del usuario) y dos CSV de catálogo **inventados** de 5 filas (ids `PRB-00x` y EAN falsos).

### Comprobado: arreglado

| Qué | Resultado |
|---|---|
| **F3** dolor sin lesión guardada | «me duele la rodilla después del sparring, ¿entreno hoy?» → «Con un dolor nuevo o una lesión, hoy no cargues esa zona ni entrenes a través del dolor… para y ve a un médico…» ✅ |
| **F3** con lesión guardada | La misma respuesta. «¿Entreno fuerte hoy?» añade «Ojo con tu lesión (Rodilla derecha tras sparring)…» ✅ |
| **F26** golpe con síntomas | El chat pone el golpe por delante («Lo primero es el golpe en la cabeza que avisaste… nada de sparring ni contacto y nada de entrenar duro; el día del golpe, no entrenes»). El briefing dice «Tienes el contacto bloqueado…» con «Ver el bloqueo». Hoy enseña la tarjeta y «Plan del día: Golpe en la cabeza: el día del golpe no entrenes». El **plan ya hecho** y Mi rutina pasan sparring, rolls y competición a «Fuera esta semana: sin contacto hasta el alta de un clínico» **sin «Volver a preparar»** ✅ |
| **F6** | «Hecha» suma al momento en Nutrición (Desayuno 690 kcal, «Del menú: marcada Hecha en Hoy (kcal previstas)»). Quitar la marca vuelve a 0. Al guardar «Cambiada» se restan esas kcal y dice «Apunta en Nutrición lo que comiste» ✅ |
| **F28** | Hoy: «Hoy hay 2 pesajes: cuenta la media del día, 80,15 kg». Biometría marca los dos («Ese día hay 2 pesajes: cuenta la media del día») y el Resumen enseña 80,2 ✅ |
| **F29** | Cena «No hecha» → «Preparar otro menú» (con el calamar en «No te gusta» para forzar el cambio) → la cena nueva sale sin marca, con «Antes, con otro plato: No hecha (Calamar a la plancha…). El menú de hoy ha cambiado» ✅ |
| **F12** importar menú JSON | `schema: 1`: «Importado: Menú 2026-10-27 a 2026-11-09, 14 días, 0 sesiones de batch y 53 cosas en la lista». **Reimportar mantiene lo tachado** (2 de 53, también al recargar) ✅ |
| **F12** Mi cocina | Menaje (ollas, olla exprés, sartenes, fuegos, air fryer, horno y microondas) y el comensal «Pareja: Cena, sin pescado, salvo gambas». Se guarda y sigue ahí al recargar ✅. En el menú nuevo de 7 días ninguna cena lleva pescado ✅ (pero ver R3-1) |
| **F12** batch | «Abrir a pantalla completa» abre `/nutrition/menu/batch` con la sesión: 10 platos, 140 min previstos, cronograma por aparato con lo que hay en Mi cocina (y «Sartén · en lugar de Wok»). Reloj de la sesión exacto (15 s → 00:16), temporizador por paso (25 min → 24:57), `wakeLock`. Los pasos marcados y el reloj siguen al recargar (1 de 31) ✅ |
| **F12** compra y PDF | Casillas que sobreviven a recargar y reimportar. PDF de 29 páginas (menú importado) y de 11 (menú de FightLab), con `[x]` en lo tachado y «Tandas a cocinar» ✅ |
| **F13** catálogo | Vista previa «Tabla puntuada · 5 filas · 5 productos nuevos · Ninguna fila descartada · 4 bueno · 1 evitar», con las galletas en «Evitar» aunque el archivo dijera `top`. La tabla de equivalencias actualiza los 5 sin duplicar («Equivale a: copos de avena»). En la lista de la compra los productos salen por **sección** (Carne, Cereales, Huevos, Lácteos) con envases y coste. Los sustitutos con las mismas kcal funcionan con los alimentos del motor y con tus productos ✅ |
| **F7** | «4 de 5 sesiones del plan»: Gimnasio 1 de 2, MMA 2 de 2 y Cardio 1 de 1 cuadran con la lista, ordenada del 3 al 9 de noviembre ✅ |
| **F9** | El plan activo y el rehecho solo tienen «Cardio moderado · 20 min» ✅ |

### Fallos de la ronda 3, por gravedad

#### R3-1 (molesta). Menú de 7 días con tuppers y batch: de jueves a domingo no hay cena
- **Pasos:** Mi cocina con un comensal «Cena: sin pescado, salvo gambas», y «calamar» en «No te gusta».
  Menú → 7 días, tupper en Comida y Cena, «Cocinar los tuppers en una sesión de batch» → Preparar otro
  menú.
- **Resultado:** lunes a miércoles tienen 4 comidas, pero **jueves, viernes, sábado y domingo solo
  tienen Desayuno, Comida y Merienda**. Aun así salen «COMPROBADO» con 2854–2865 kcal (el motor reparte
  la energía en 3 comidas) y no hay ningún aviso de que falte la cena.
- **Sospecha:** con la cena sin pescado, sin calamar y sin repetir platos en 7 días se acaban las cenas
  posibles y el día se queda sin ella en silencio. Debería avisar o relajar la regla de no repetir.
- Captura: [`40-r3-menu-jueves-sin-cena.jpg`](capturas/40-r3-menu-jueves-sin-cena.jpg).

#### R3-2 (molesta). Compra «por semana» del menú importado: las pestañas no filtran
- **Pasos:** importar `menu-ejemplo.json` (14 días) → Lista de la compra → «Semana 1» o «Semana 2».
- **Resultado:** la pestaña se marca, pero las dos semanas enseñan las mismas 53 cosas con las
  cantidades de los 14 días (por ejemplo, 4460 g de leche en «Semana 1»). El JSON no trae la semana de
  cada producto, pero sí los platos de cada día. Si no se puede repartir, mejor no enseñar las pestañas.
- Todo cae en **«Otros»**: sin un catálogo de la cadena no hay secciones. Con el catálogo de F13 sí
  salen (Carne, Lácteos…), pero solo para los productos con equivalencia.
- Captura: [`41-r3-compra-semana-sin-filtrar.jpg`](capturas/41-r3-compra-semana-sin-filtrar.jpg).

#### R3-3 (molesta, seguridad leve). Tras el golpe, el plan sigue ofreciendo trabajo «Vigoroso»
- **Resultado:** tras avisar del golpe, el plan saca el contacto, pero en «Puedes hacer» siguen «Paos a
  ritmo alto (Vigorosa)» y «Drills a tope (Vigorosa)». El briefing y el chat dicen «nada de entrenar
  duro hasta que un clínico te dé el alta». Además, la cabecera del Coach sigue diciendo **«LISTO PARA
  ENTRENAR»** encima del briefing del bloqueo.
- Capturas: [`42-r3-plan-golpe-vigoroso.jpg`](capturas/42-r3-plan-golpe-vigoroso.jpg),
  [`43-r3-coach-listo-para-entrenar.jpg`](capturas/43-r3-coach-listo-para-entrenar.jpg).

#### Menores
| # | Qué pasa |
|---|---|
| R3-4 | La lista de la compra y el PDF enseñan tal cual la nota en inglés del JSON: «amounts are for the form each name gives (raw, cooked, drained); a batch is bought once at its servings, `left_over` of them…» (con las comillas de código). Captura 41. |
| R3-5 | Precio de un envase por unidades: los huevos («12 ud») salen como «1 envase de 12 ud · unos 0,53 €», que es el precio de los 126 g de la receta y no del envase que se compra. Con los envases en gramos el precio sí es el del envase. Captura 44. |
| R3-6 | En el catálogo, un producto no dice por qué es «Evitar» ni que el archivo lo valoraba distinto (`top`), aunque el backend guarda la valoración del archivo para eso. Tocar el producto no abre detalle. |
| R3-7 | Sustitutos de 50 g de galletas: el primero es «45 g de patatas fritas de bolsa». Los genéricos del motor no tienen valoración, así que un sustituto poco sano sale arriba. Captura 45. |
| R3-8 | Con un menú importado, los objetivos del día salen todos como «Convención de FightLab, sin revisar», cuando en un menú de FightLab llevan su evidencia (moderada o fuerte). |
| R3-9 | Al guardar «Contarle a mi coach», la conversación del chat se vacía (se pierde la pregunta anterior). |
| R3-10 | Siguen los decimales con punto en Biometría («80.4», «IMC 25.4»), Coach («80.4 KG») y sustitutos («34.1 g proteína»): era el F12 de la primera ronda, no este F12. |
| R3-11 | La revisión da por «Hecha el 7 de noviembre» la sesión de cardio prevista el 9: cuenta una sesión de antes del día previsto. Puede ser a propósito. |

### Sin probar en esta ronda
- **Tickets de la compra:** «La subida de fotos de tickets no está configurada en este servidor» (sin
  R2, como se esperaba en local).
- La IA real (sin clave) y los avisos push (Chrome sigue con las notificaciones desactivadas en Android).
