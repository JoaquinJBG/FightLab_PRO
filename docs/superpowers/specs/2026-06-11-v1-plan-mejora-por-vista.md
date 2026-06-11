# Plan de mejora por vista — v1 producto

Este documento consolida el benchmarking de las apps de referencia (Whoop, Strava, Hevy, MacroFactor, TrainingPeaks, Boxing Timer Pro, etc.) en un plan accionable por vista. Criterios: **completo sin bloat** (cada mejora respaldada por un patrón probado en producto líder), **profesional** (nunca mostrar datos falsos o pseudo-precisión) y **realista en PWA** (sin GPS background, sin BLE, sin popups OAuth; sí Wake Lock, Web Push, cámara y timestamps). Tipos: `[UI]` solo frontend · `[Backend]` necesita API · `[IA]` necesita IA real.

---

## 1. Auth / Onboarding

**Lo que hacen los mejores**

- **Strava**: onboarding de muchos pasos pero casi todo *skippable*; un solo dato duro (fecha de nacimiento) explicando para qué se usa; optimiza para llegar rápido a la primera acción core.
- **Nike Training Club**: 3-4 preguntas con chips (frecuencia, lugar, nivel) y validación de contraseña positiva en vivo (checklist que se marca al cumplirse).
- **Whoop**: pregunta primero el **objetivo**, pasos cortos que avanzan solos, y gestiona expectativas (te dice desde el día 1 cuándo llegará el valor).
- **Apps de combate (Fight AI, Strike Force)**: disciplinas, nivel y guardia como datos de primera clase; el peso tratado como dato competitivo (categoría), no de salud.
- **OWASP/Postmark**: reset de contraseña con token aleatorio de un solo uso hasheado (exp. 15-60 min), respuesta anti-enumeración e invalidación de sesiones al cambiar.

**Mejoras**

| Mejora | Por qué | Prioridad | Tipo |
|---|---|---|---|
| Recuperación de contraseña completa: `/forgot-password` → token hasheado de un solo uso (30 min) → `/reset-password/[token]`, anti-enumeración y rate limit | Único hueco bloqueante: hoy olvidar la contraseña = perder la cuenta. Implementar según OWASP | Alta | [Backend] |
| Wizard de onboarding en 4 pasos con barra de progreso (físico obligatorio; disciplinas+guardia+experiencia y objetivo+frecuencia *skippables*; unidades), con microcopy de propósito bajo cada pregunta ("tu guardia personaliza el análisis técnico") | Hoy todo el ProfileForm va en una pantalla; Strava/NTC/Whoop trocean en micro-pasos con progreso, lo que sube la finalización | Alta | [UI] |
| Ampliar perfil y API: `goal`, `experience_level`, `disciplines` (multi), `training_frequency` | Es el dato que alimenta toda la personalización posterior (planes, copy, recomendaciones); sin esto los pasos 2-3 del wizard no tienen dónde guardarse | Alta | [Backend] |
| Pantalla de bienvenida única tras verificar email: 3 bullets de valor + un CTA "Configura tu perfil — 2 min" | Strava y Whoop enmarcan el onboarding con una promesa de valor; una pantalla, cero tour multi-slide | Media | [UI] |
| Validación de contraseña positiva en vivo en registro + toggle mostrar/ocultar + `autocomplete="new-password"` | Patrón NTC: convierte la fricción en feedback positivo; el resto es higiene OWASP | Media | [UI] |
| Reenvío de email de verificación con rate limit (1/min, 5/día) y CTA desde el login cuando la cuenta está sin verificar | El error actual "credenciales incorrectas o cuenta sin verificar" deja al usuario sin salida si el email cayó en spam | Media | [Backend] |
| Social login con Google vía Authorization Code + **redirect** (nunca popup), vinculando por email verificado | +20-60% de conversión en registro; en PWA instalada en iOS el popup falla, por eso redirect | Media | [Backend] |
| Sugerir categoría de peso de combate desde el peso introducido (editable) y guardarla en el perfil | Diferenciador de dominio: el peso como dato competitivo; enlaza con el pesaje ya existente en Nutrición | Media | [Backend] |
| Rate limiting y bloqueo progresivo en login/reset (django-axes o throttling DRF) | Estándar de producción contra credential stuffing; barato ahora | Baja | [Backend] |
| Sustituir los 3 selects de fecha por `input type="date"` nativo | Tres selects encadenados es el patrón más lento en móvil; el picker nativo gana siempre en PWA | Baja | [UI] |
| Pantalla final "Tu punto de partida": resumen + primera recomendación de plan por reglas (objetivo × nivel × frecuencia) | Cierra el bucle como NTC; con reglas basta, no requiere IA | Baja | [Backend] |

**No meter**

- Tour de features multi-slide antes de poder usar la app.
- Pedir datos que aún no se usan (foto, ubicación, wearables): cada campo extra cuesta conversión.
- Sign in with Apple en PWA pura (solo obligatorio si se empaqueta para App Store).
- Trial premium o paywall dentro del onboarding.

---

## 2. Home

**Lo que hacen los mejores**

- **Whoop**: un score dominante arriba que responde "¿cómo debo entrenar hoy?"; 3 colores semánticos (verde/ámbar/rojo) consistentes en toda la app; el coaching va incrustado en el dato.
- **Oura**: prioriza UNA cosa grande; cada vital anclado a tu baseline personal, no como número aislado; Daily Highlight de una frase.
- **Garmin Connect v5**: la **próxima acción** (entreno planificado) va primero; tarjetas compactas escaneables; lección: el exceso de personalización confundió a los usuarios.
- **Strava**: separa resumen reciente de histórico; lección del Weekly Snapshot: los módulos motivacionales no descartables generan quejas.

**Mejoras**

| Mejora | Por qué | Prioridad | Tipo |
|---|---|---|---|
| Jerarquía readiness-first: tarjeta hero "Estado de hoy" (score grande color-semántico + recomendación de una frase); el peso pasa a segunda posición | Whoop y Oura abren con la decisión que el atleta toma cada mañana; hoy el hero es el peso y el estado va cuarto | Alta | [UI] |
| `GET /api/dashboard/summary`: ACWR derivado de sesiones reales (7d/28d) y readiness de RHR+HRV vs baseline; si faltan datos, devolver "insuficiente" | Los valores 1.18 y 78 están hardcodeados en `dashboard/page.tsx`; un dashboard profesional nunca muestra datos falsos | Alta | [Backend] |
| Tarjeta peso con distancia al objetivo ("a X,X kg de la categoría"), reutilizando `goal_weight_kg`/`goal_date` del perfil (se definen en Biometría) | Para un atleta de combate la distancia a la categoría es EL dato del peso; diferenciador frente a apps genéricas | Alta | [UI] |
| Tarjeta "Hoy / próxima acción" bajo el hero: próximo entreno del día o CTA "registrar sesión" | Garmin pone Planned Workouts primero; hoy el home solo mira hacia atrás | Alta | [UI] |
| Deltas vs baseline en mini-tarjetas de RHR, HRV y % grasa (flecha + diferencia vs media 7-30 registros) | Patrón Vitals de Oura: "58 bpm, +4 sobre tu media" informa; el número aislado no. Cálculo en cliente con datos ya cargados | Media | [UI] |
| Fila de consistencia semanal: 7 puntos L-D con sesión/medición registrada | Consistencia ligera sin gamificación pesada; los datos ya existen | Media | [UI] |
| Placeholder accionable cuando faltan RHR/HRV: "Añade FC reposo y HRV para activar tu readiness" con CTA | Hoy las tarjetas desaparecen (`return null`) y el usuario nunca sabe qué desbloquean | Media | [UI] |
| Insight del día (estilo Daily Highlight): primero motor de reglas en backend, más adelante redactado por IA | El coaching incrustado convierte el visor de números en asistente; las reglas cubren el 80% | Media | [IA] |
| Mover "Salir" del header a perfil/ajustes y saludo contextual por franja horaria | Ninguna app de referencia expone logout en el home; coste cero | Baja | [UI] |
| Indicador de frescura: "última medición hace X días" siempre visible en la tarjeta de peso | Las apps de referencia siempre fechan el dato | Baja | [UI] |

**No meter**

- Feed social o contenido editorial en el home.
- Dashboard personalizable/reordenable (lección Garmin v5: un buen default vale más).
- Gráficos densos crudos en el home: van a la vista de detalle.
- Gamificación pesada (badges, retos, ligas).

---

## 3. Biometría

**Lo que hacen los mejores**

- **Happy Scale**: suavizado exponencial que separa señal de ruido, hitos intermedios, predicciones ancladas a fechas ("qué pesarás el día X") y reencuadre psicológico ("la báscula es tramposa, la tendencia es la verdad").
- **MacroFactor**: doble serie en la misma gráfica (crudo pálido + tendencia saturada), EWMA que detecta tendencias en 4-5 días e interpolación lineal de días sin pesaje.
- **Withings**: línea de objetivo siempre visible; lección negativa: eliminar los puntos crudos y el zoom (v5.13) incendió su foro.
- **Renpho**: selector de rango en un tap; lección negativa: 13+ métricas de bioimpedancia son pseudo-precisión que diluye la señal.

**Mejoras**

| Mejora | Por qué | Prioridad | Tipo |
|---|---|---|---|
| Vista de histórico: puntos crudos tenues + línea de tendencia EWMA (~0,1) con interpolación de huecos y selector 1S/1M/3M/6M/1A | Patrón canónico de Happy Scale/MacroFactor y el mayor hueco actual (solo existe el sparkline del Home); 100% frontend con `useBiometrics` | Alta | [UI] |
| Cabecera de tendencia: "peso tendencia" protagonista + ritmo semanal (−0,4 kg/sem) + delta vs hace 7 días | La tendencia, no el último pesaje, es la métrica; el ritmo en kg/sem es lo accionable para planificar un corte | Alta | [UI] |
| Editar y borrar mediciones: PATCH/DELETE en `/me/biometrics/{id}` + lista con menú por entrada | Hoy un error de tecleo (75,2 → 752) corrompe la tendencia para siempre; único bloqueante de confianza | Alta | [Backend] |
| Objetivo de peso con fecha: `goal_weight_kg` + `goal_date` en perfil, línea de meta en la gráfica y proyección "a este ritmo llegas el día X" | La predicción de Happy Scale aplicada al caso estrella de FightLab: dar el peso el día del combate. Extrapolación lineal, sin IA | Alta | [Backend] |
| Mensajes anti-frustración: si hoy sube pero la tendencia baja, banner "las subidas de un día son agua y glucógeno" | Diferencial psicológico de Happy Scale; evita abandonos y pesajes compulsivos. Lógica de cliente | Media | [UI] |
| Registro con fecha retroactiva (`recorded_at` en el POST + date picker opcional) | Olvidar un día es el caso más común; sin esto el hueco es permanente | Media | [Backend] |
| Recordatorio inteligente (Web Push): solo si hoy no hay registro, a la hora habitual, desactivable | El recordatorio condicional mantiene los 3+ pesajes/semana que la EWMA necesita, sin spam | Media | [Backend] |
| Hitos intermedios hacia el objetivo, validados contra la tendencia (no contra un pesaje suelto) | Hitos cortos sostienen la motivación en cortes largos; validar por tendencia evita celebrar deshidratación | Media | [UI] |
| Mini-tendencias de RHR y HRV: media 7 días vs media 28 días | Ya se capturan pero nunca se visualizan; son la señal temprana de sobreentrenamiento o corte demasiado agresivo | Media | [UI] |
| Exportar histórico a CSV | Portabilidad de datos barata sin atarse aún a integraciones de salud | Baja | [Backend] |
| Insight semanal narrativo por IA (tendencia, ritmo vs objetivo, RHR/HRV + recomendación) | Consejo de esquina real, pero solo cuando existan tendencias y objetivo | Baja | [IA] |

**No meter**

- BMI prominente: clasifica mal a atletas con masa muscular.
- Métricas de bioimpedancia pseudo-precisas (edad metabólica, grasa visceral…).
- Rachas con castigo: en deportes con categorías de peso fomentan obsesión con la báscula.
- Predicciones a más de ~3 meses presentadas como certeza.

---

## 4. Deportes (tracker en vivo)

**Lo que hacen los mejores**

- **Strava**: al pulsar Finish NO guarda directo — abre pantalla de guardado con título, descripción y RPE 1-10 que alimenta su Relative Effort sin pulsómetro; edición/borrado por actividad desde menú "...".
- **Nike Run Club**: countdown 3-2-1, modo minimalista con 1-2 números gigantes, y doble seguridad para terminar (mantener pulsado el stop).
- **Apple Watch Workout**: máximo 5 métricas, rating de esfuerzo 1-10 post-workout, training load = esfuerzo × duración comparado a 28 días.
- **Patrones PWA (MDN)**: el cronómetro debe derivar de timestamps (`Date.now() − startedAt`), nunca de ticks (se trottlean en background); Wake Lock con re-adquisición en `visibilitychange`; sesión persistida en localStorage para sobrevivir a recargas.

**Mejoras**

| Mejora | Por qué | Prioridad | Tipo |
|---|---|---|---|
| Corregir kcal por tramos de intensidad (segmentos `{intensidad, desde_ts}` sumados por tramo) | Bug actual: `liveKcal` aplica el factor de la intensidad seleccionada AHORA a todo el elapsed (línea 92 de `sports/page.tsx`); cambiar a "Intenso" al final re-tarifica toda la sesión | Alta | [UI] |
| Wake Lock de pantalla con re-adquisición en `visibilitychange` y chip "Pantalla activa" | LA feature que separa un tracker PWA usable de uno que se duerme a los 30 segundos | Alta | [UI] |
| Recuperación de sesión en curso: persistir `{sportKey, startedAt, pausas, segmentos}` en localStorage; al volver, banner "Reanudar / Descartar" | Hoy una recarga pierde la sesión; con timestamps el cronómetro sale correcto aunque el móvil estuviera bloqueado | Alta | [UI] |
| Pantalla de guardado post-sesión: resumen + título editable + slider RPE 1-10 pre-rellenado por intensidad + nota + Guardar/Descartar | Hoy "Parar" guarda automático sin confirmación; el patrón Strava cierra mejor y el RPE alimenta la carga de entrenamiento | Alta | [UI] |
| Hold-to-stop (~1 s con anillo de progreso) tras pausar | Patrón de seguridad de NRC: evita finales accidentales con la mano sudada o el móvil en el bolsillo | Alta | [UI] |
| Editar/borrar actividades individuales + ficha de detalle (métricas, segmentos, RPE, nota) | El historial actual solo permite "Borrar TODO", destructivo y nada profesional; flujo "..." de Strava | Alta | [UI] |
| API Django de actividades: modelo `Activity` (sport, título, started_at, duración, kcal, segments JSON, rpe, nota) con CRUD; frontend offline-first con cola de sincronización | Sin esto no hay historial multi-dispositivo ni datos para el dashboard y la carga; es parte del ActivityLog unificado | Alta | [Backend] |
| Countdown 3-2-1 con vibración y "tocar para saltar" | Ritual estándar de NRC: da tiempo a soltar el móvil y el inicio se siente deliberado | Media | [UI] |
| Carga sRPE 7 vs 28 días como cabecera del historial (mismo motor de carga que el ACWR de Coach y Carga — implementar una sola vez sobre el ActivityLog) | RPE × minutos es la métrica accionable nº1 que se obtiene sin ningún sensor (mismo concepto que Training Load de watchOS) | Media | [Backend] |
| Cabecera de totales semanales: "Esta semana: 3 sesiones · 2h 10m · 1.450 kcal" | Ancla el feed a un agregado como Strava/NRC; calculable en cliente | Media | [UI] |
| Distancia manual opcional al guardar (correr/bici/caminar) → ritmo medio y kcal refinadas | La alternativa honesta al tracking de ruta sin GPS | Baja | [UI] |
| Consejo post-sesión por IA (1-2 frases con RPE, carga y semana como contexto) | Diferenciador frente a un cronómetro tonto; solo con IA real, nunca texto enlatado | Baja | [IA] |
| Compartir tarjeta-resumen (canvas + Web Share API) | El único "social" que merece la pena sin red social; motor de adquisición en NRC/Strava | Baja | [UI] |

**No meter**

- GPS en vivo, mapa y autopausa: en PWA no hay GPS background y la autopausa es frágil hasta en nativo.
- Capa social (kudos, feed, comentarios).
- Sensores BLE/wearables ahora (Web Bluetooth inestable): dejar como integración futura.
- Métricas inventadas sin sensor (FC estimada, VO2max): los datos falsos destruyen confianza.

---

## 5. MMA y Herramientas

**Lo que hacen los mejores**

- **Boxing Timer Pro**: sonidos de gimnasio reales y diferenciados por evento, tiempo de aviso configurable con sonido propio, presets con nombre del usuario, rounds = 0 → modo infinito.
- **Seconds Pro**: text-to-speech que anuncia el intervalo y avisa del siguiente; display gigante de alto contraste.
- **Mattime (BJJ)**: registro en 14 segundos de media; horas de tapiz, heatmap de calendario y frecuencia de técnicas como motor de hábito.
- **My Combat App**: el **tipo de trabajo** (sparring/drilling/pads/saco/sombra/técnica) como campo central de cada sesión + workload semanal.
- **Metodología sRPE** (Foster/Gabbett): carga = duración × RPE, ACWR con zona segura 0,8-1,3, monotonía y alerta si la semana sube >20%.

**Mejoras**

| Mejora | Por qué | Prioridad | Tipo |
|---|---|---|---|
| Presets de timer personalizados: "Guardar config actual" con nombre, lista editable junto a los de fábrica | La feature más universal de los timers top; hoy solo hay presets fijos | Alta | [UI] |
| Aviso de round configurable (10/30/60 s) con sonido propio y parpadeo del anillo | El aviso de 30 s es estándar en boxeo/Muay Thai real; hoy está fijo a 10 s con el mismo sonido | Alta | [UI] |
| Pack de sonidos reales por evento (campana, bocina MMA, gong, clack) con preview en ajustes | Los sonidos sintéticos restan profesionalidad inmediata; deben distinguirse sin mirar la pantalla (con guantes) | Alta | [UI] |
| Formulario de sesión ampliado con modelo y API: chips de tipo de trabajo, nº de rounds, compañero, técnicas, notas y flag de lesión/golpe | Todos los cuadernos de combate giran sobre el tipo de trabajo; duración × RPE a secas no cuenta la historia de la sesión | Alta | [Backend] |
| Pantalla de estadísticas: carga semanal (AU), horas por arte, distribución por tipo de trabajo, heatmap/racha de calendario | Es lo que convierte el registro en hábito (Mattime); ya calculamos AU pero no las mostramos agregadas | Alta | [Backend] |
| Semáforo ACWR 0,8-1,3 + aviso si la semana sube >20% (mismo motor unificado de carga que Deportes y Coach y Carga) | Metodología sRPE estándar; diferencia el producto de un simple diario con datos que ya guardamos | Media | [Backend] |
| Conectar timer y diario: al terminar los rounds, CTA "Registrar esta sesión" con duración y rounds prerrellenados | Cierra el loop entre las dos mitades de la vista y deja el registro en ~10 s | Media | [UI] |
| Anuncios por voz con Web Speech API ("Round 3", "30 segundos", "Descanso"), con toggle | Feature estrella de Seconds Pro; en PWA sale gratis con `speechSynthesis`, sin assets | Media | [UI] |
| Plan sugerido dinámico según arte, modo y carga reciente (en lugar del plan estático) | El plan estático se percibe como relleno a la segunda lectura; con ACWR calculado la sugerencia modula volumen real | Media | [IA] |
| Modo rounds infinitos (∞) hasta que el usuario pare | Patrón Boxing Timer Pro muy usado en sparring abierto y saco libre; trivial | Baja | [UI] |

*Nota: el chat del coach simulado de esta vista se sustituye por el chat acotado con RAG definido en Coach y Carga (una sola implementación).*

**No meter**

- Leaderboards sociales y círculos de gimnasio: exigen masa crítica.
- Integración de música / mirroring a TV: una PWA no controla apps de música de forma fiable.
- Stats por round de sparring (taps, golpes conectados): fricción altísima, nadie lo mantiene.
- Editor de intervalos anidados completo estilo Seconds Pro: para combate basta preparación + rounds + descanso + aviso.

---

## 6. Gimnasio y Mi rutina

**Lo que hacen los mejores**

- **Hevy**: el producto es el registro en sesión — tabla de series con check, **valores de la última vez como placeholder** (registrar = confirmar), rest timer automático al marcar serie y notificación de PR en vivo.
- **Strong**: detalle de ejercicio en pestañas (Historial / Gráficos / Récords con e1RM); plantillas que precargan todo con los valores anteriores.
- **Fitbod / JuggernautAI**: progresión y ajuste por readiness con **sistema de reglas** (expert system, no LLM): predecible, barato, explicable.
- **TrueCoach / TrainHeroic**: sesión asignada completable **por ejercicio** con comentarios asíncronos, compliance rate visible para el coach y RPE de sesión que colorea el calendario de carga.

**Mejoras**

| Mejora | Por qué | Prioridad | Tipo |
|---|---|---|---|
| Modelo de datos en Django: `Exercise`, `Routine` (días → ejercicios → series×reps objetivo), `WorkoutSession`, `SetLog` (peso, reps, tipo, rpe) | Prerequisito de todo: hoy gym usa localStorage y my-routine datos hardcodeados; sin entidades no hay sesión, historial, PRs ni coach real | Alta | [Backend] |
| Pantalla "Entrenar ahora": tabla de series por ejercicio (peso × reps + check), cronómetro de sesión y botón finalizar | El corazón de Hevy/Strong; cierra el bucle plan → ejecución → dato | Alta | [UI] |
| Placeholder "previo" por serie con copia en 1 tap | El patrón de usabilidad más citado de Hevy/Strong: reduce el registro a confirmar | Alta | [Backend] |
| Rest timer automático al marcar serie (default 90 s, configurable por ejercicio) con vibración y notificación local | Estándar en todas las apps investigadas; 100% viable en PWA con Notification API + service worker | Alta | [UI] |
| Biblioteca de ejercicios: seed con free-exercise-db (~800, dominio público) + búsqueda y filtros por músculo/equipo + picker | Sustituye los 4 ejercicios fijos con coste de contenido cero | Alta | [Backend] |
| Detalle de ejercicio con Historial / Récords: mejor peso, e1RM (Epley), gráfico de progresión y badge de PR en sesión | Los PRs son el principal motor de retención de Hevy/Strong y son fórmula determinista, sin IA | Alta | [Backend] |
| Mi rutina completable por ejercicio + RPE de sesión + comentario al coach + % de cumplimiento semanal | Patrón TrueCoach/TrainHeroic: el coach necesita cumplimiento y feedback, no un toggle de día entero; el RPE alimenta la vista de Carga | Alta | [Backend] |
| Constructor manual de rutinas desde la biblioteca + "Aplicar al calendario" | La plantilla editable es la base de todo; el wizard IA debe emitir este mismo formato | Media | [UI] |
| Wizard IA real: nivel/días/split/objetivo/equipamiento → LLM con salida JSON validada contra la biblioteca, editable antes de aplicar, con reglas como fallback | Hoy es un `setTimeout` con 4 ejercicios fijos; con biblioteca + formato definidos el salto es acotado | Media | [IA] |
| Resumen post-sesión: duración, volumen total (kg), series completadas y PRs del día | Refuerzo inmediato presente en Hevy/Strong/TrainHeroic; solo presentación de datos que la sesión ya genera | Media | [UI] |
| Tipos de serie (calentamiento/fallo/drop set) y RPE/RIR opcional por serie | Estándar Hevy/Strong; el calentamiento debe excluirse de PRs y volumen | Media | [Backend] |
| Check-in de readiness pre-sesión (reutiliza el check-in de wellness de Coach y Carga), visible para el coach | Patrón JuggernautAI/TrainHeroic de bajo coste; deja los datos listos para el ajuste de carga futuro | Media | [Backend] |
| Progresión por reglas: si completas todo con RPE ≤ 8 → chip "+2,5 kg / +1 rep" aceptable/rechazable | Versión determinista de Fitbod/JuggernautAI; se explica sola y rechazarla es feedback gratuito | Baja | [Backend] |
| Ajuste de carga del día con IA según readiness y RPE recientes | Diferenciador real para quien llega al gym fatigado del tatami, pero exige meses de datos previos | Baja | [IA] |
| Calculadora de discos y series de calentamiento | Nice-to-have de Strong; no mueve la aguja hasta que el registro exista | Baja | [UI] |

**No meter**

- Capa social tipo Hevy (feed, likes) y leaderboards de equipo: pantallas vacías sin masa crítica.
- Mapa de calor de recuperación muscular estilo Fitbod: exige modelar fatiga con datos que no existen; el check-in simple da el 80%.
- Subida de vídeo para corrección de técnica y chat en tiempo real: caros; bastan comentarios asíncronos.
- Vídeos propios de ejercicios: usar imágenes del dataset público.

---

## 7. Nutrición

**Lo que hacen los mejores**

- **MyFitnessPal**: "Log" abre en recientes/frecuentes de ESA comida (no en buscador vacío), copiar lo de ayer en un gesto, quick add de solo kcal y combos guardados — el grueso del registro diario es repetición.
- **MacroFactor**: TDEE **observado** cruzando pesos reales con kcal registradas (la fórmula solo como semilla); cero números rojos — está documentado que el castigo provoca under-logging.
- **Cal AI**: la foto devuelve una **lista editable** de alimentos con gramos y confianza, nunca un número cerrado; las correcciones alimentan el modelo.
- **Yazio**: agua con objetivo diario y botones rápidos; raciones predefinidas que escalan macros.
- **CUTCHECK / CutCoach**: countdown al pesaje con fecha y hora, plan por fases hacia la báscula; lección de alcance: información por fases sí, prescripción automática de cortes de agua/sodio no.

**Mejoras**

| Mejora | Por qué | Prioridad | Tipo |
|---|---|---|---|
| Pestañas Recientes / Favoritos / Mis comidas al añadir + "copiar de ayer" por sección (persistir logs + endpoint de frecuentes por meal-slot) | El patrón con más impacto de MFP: reduce el registro diario a segundos | Alta | [Backend] |
| Quick add de kcal con macros opcionales | Estándar MFP/MacroFactor para comidas fuera de casa; encaja en la vista add actual sin tocar el modelo | Alta | [UI] |
| Rediseñar el resultado de foto como lista editable multi-alimento (nombre + gramos + macros + confianza; ajustar/sustituir/añadir/eliminar) | UX exacta de Cal AI; rediseñarlo ahora evita romper la UX cuando se conecte IA real | Alta | [UI] |
| Escáner de código de barras: `BarcodeDetector` (fallback zxing-js) + Open Food Facts vía proxy Django con caché | Sustituye de golpe la limitación de los 15 alimentos de ejemplo para producto envasado; viable en PWA | Alta | [Backend] |
| Objetivo calórico adaptativo semanal: TDEE observado (EMA de peso + media de ingesta) con suavizado y tope ±100-150 kcal; Mifflin solo como semilla | El diferencial real de MacroFactor; job semanal de backend puro, sin IA | Alta | [Backend] |
| Pesaje como plan: tendencia suavizada vs línea objetivo hasta la fecha de báscula, kg/semana requeridos, badge on-track y aviso si excede ~1% del peso/semana | Lo que hacen CUTCHECK/CutCoach y ninguna generalista; los datos ya existen, es cálculo y render | Alta | [UI] |
| Tamaños de ración por alimento (`serving_sizes`: pieza/taza/unidad) que escalan macros | Patrón Yazio/MFP; mucha menos fricción que pesarlo todo en gramos | Media | [Backend] |
| Registro de agua con objetivo diario (~35 ml/kg ajustable), chips +250/+500 ml y barra de progreso | En combate la hidratación es parte del pesaje; modelo trivial | Media | [Backend] |
| Periodización de carbos por carga de entreno: proteína fija y carbos alto/medio/bajo según la sesión del día leída del calendario, con etiqueta "día de carga" | "Fuel for the work required" (Impey 2018); ninguna app generalista lo hace — diferencial multideporte de FightLab | Media | [Backend] |
| Conectar visión real foto→alimentos: API multimodal que devuelve JSON de items con confianza + hint "añade el aceite si lo hubo" | Alimenta la UI editable ya rediseñada; documentar la varianza ±10-20% por grasas ocultas | Media | [IA] |
| Checklist informativo de fight week por fases (≤7 días al pesaje), educativo y con disclaimer | Versión segura del enfoque CUTCHECK: información sí, prescripción no; contenido estático sobre el countdown existente | Baja | [UI] |
| Streak discreto de días con diario completo (chip pequeño) | Gamificación mínima estilo Yazio que crea hábito sin sala de trofeos | Baja | [UI] |

**No meter**

- Micronutrientes exhaustivos (eso es Cronometer) y "health scores" morales por alimento.
- Números rojos o avisos al pasarse del objetivo: provocan under-logging y datos peores.
- Recetario/planes editoriales y tracker de ayuno intermitente.
- Prescripción automatizada de cortes de agua/sodio: riesgo de seguridad y responsabilidad.

---

## 8. Coach y Carga

**Lo que hacen los mejores**

- **Whoop**: UN briefing matinal al día (Daily Outlook), nunca goteo de notificaciones; memoria del coach editable y transparente; privacidad explícita (anonimiza antes del LLM).
- **Strava Athlete Intelligence**: insight anclado a un evento, patrón "resumen corto + Say More" y botón "¿Helpful?" en cada insight (80%+ positivo, alimenta la iteración).
- **JuggernautAI**: sistema experto de reglas, no LLM; check-in de readiness de 30 s antes de entrenar; el feedback **modifica el plan**, no solo el texto (readiness <3 → recorta series ese día).
- **TrainingPeaks**: la gráfica canónica PMC (fitness CTL 42d, fatiga ATL 7d, forma TSB) con zonas nombradas y **proyección hacia la fecha objetivo** — planificar el taper para llegar fresco al día D.
- **Oura / AthleteMonitoring**: score desglosado en contribuyentes vs baseline propio; semáforos legibles sin interpretar números; ACWR con EWMA, monotonía >2,0 y subida semanal >10% como alertas.

**Mejoras**

| Mejora | Por qué | Prioridad | Tipo |
|---|---|---|---|
| Check-in matinal de wellness (4 sliders: sueño, fatiga, dolor muscular por zona, estrés) como input principal del readiness — reutilizado como check-in pre-sesión en Gimnasio y MMA | Sin wearable, el input subjetivo es la única fuente honesta de readiness (patrón JuggernautAI y equipos pro); hoy el anillo no tiene origen claro | Alta | [Backend] |
| Desglose del readiness en contribuyentes con barras vs baseline de 14 días (óptimo / presta atención) | Oura/Whoop muestran POR QUÉ el score es el que es; un número solo genera desconfianza y la ventana larga evita scores volátiles | Alta | [Backend] |
| "Aplicar" en tarjetas proactivas modifica el plan real del día (recortar volumen X%, convertir en recuperación, mover sparring) | JuggernautAI cierra el bucle sobre el plan; hoy aplicar/descartar solo persiste un estado sin efecto visible | Alta | [Backend] |
| Motor de reglas determinista para las tarjetas: monotonía >2,0, subida semanal >10%, ACWR fuera de 0,8-1,3, TSB < −30 | Los umbrales de la literatura generan recomendaciones fiables y explicables sin LLM; las reglas deciden, la IA solo redacta | Alta | [Backend] |
| Feedback "¿Te ha sido útil?" (sí/no + motivo opcional) en briefing y tarjetas, persistido | Mecanismo de Strava para medir y reducir ruido; genera dataset propio para iterar | Alta | [Backend] |
| Gráfica PMC (CTL/ATL/TSB) con zonas nombradas y proyección hasta la fecha de pelea/pesaje | LA gráfica del software profesional; para combate el diferencial es proyectar el taper para llegar al día D en zona "fresh" (+10..+25). Complementa al ACWR (riesgo agudo vs forma crónica) | Alta | [Backend] |
| Briefing diario con plantilla fija (estado → plan de hoy → 1 ajuste), generado 1 vez/día por LLM real, cacheado y citando métricas ("tu ACWR está en 1,4") | Whoop valida el formato "un briefing matinal y nada más"; plantilla fija y generación única controlan coste, latencia y ruido | Alta | [IA] |
| Patrón "resumen + Ver más": 2-3 frases visibles, análisis detallado plegado | Patrón Say More de Strava; reduce el muro de texto actual | Media | [UI] |
| ACWR con EWMA + indicador de cambio semanal (%) con semáforo — motor de carga unificado consumido por Deportes, MMA y el dashboard | La literatura reciente prefiere EWMA para anticipar riesgo; el % semanal (>10% ámbar) es la segunda señal simple de los dashboards pro | Media | [Backend] |
| Memoria del coach editable: fecha de pelea, categoría, lesiones, preferencias — visible y borrable por el usuario, alimenta el prompt | Patrón "My Memory" de Whoop: personalización con transparencia y control; además estructura el contexto del LLM | Media | [Backend] |
| Chat acotado con RAG sobre las métricas del usuario y rechazo elegante fuera de alcance (entrenamiento/carga/peso; lo clínico se deriva a médico) — sustituye también al chat simulado de la vista MMA | Whoop Coach responde sobre TUS métricas, no conocimiento general; el guardrail es lo que lo hace producto y no juguete | Media | [IA] |
| Estados "datos insuficientes" en ACWR/monotonía/TSB con menos de 3-4 semanas de histórico | El ACWR es matemáticamente inestable al principio; un gauge con valor falso destruye credibilidad | Media | [UI] |
| Etiqueta de procedencia (introducido / calculado / IA) y nota de privacidad en el chat | Coste casi nulo; la confianza que separa mockup de producto (Whoop/Strava lo comunican) | Baja | [UI] |
| Anotaciones de hitos en las gráficas (sparring duro, inicio de corte, viaje) | Los coaches leen el PMC con contexto; correlacionar picos con eventos del fight camp es el uso real | Baja | [UI] |

**No meter**

- Chat abierto que responde de cualquier cosa: bloat nº1 y riesgo de consejo médico.
- Más de una notificación/briefing proactivo al día.
- Falsa precisión: nada de decimales en scores ni "23% de probabilidad de lesión" — zonas con nombre y color.
- Gamificación en la vista de carga: es una vista clínica, el benchmark pro es sobrio y semáforo.

---

## Orden de implementación sugerido

La pieza estructural es el **ActivityLog/sesiones unificado en backend** (actividades de Deportes + sesiones MMA + WorkoutSession de gimnasio con RPE): de él dependen el dashboard real, las estadísticas MMA, la carga sRPE/ACWR/PMC, la periodización de carbos y todo el Coach. Por eso las fases son: primero quick wins [UI] que no dependen de API, luego ese backend estructural, y la IA al final sobre datos ya reales.

| Fase | Qué entra | Por qué este orden |
|---|---|---|
| **1. Quick wins [UI]** (sin tocar backend) | Deportes: fix kcal por tramos, Wake Lock, recuperación de sesión, hold-to-stop, pantalla de guardado con RPE (a localStorage de momento). Biometría: gráfica EWMA + cabecera de tendencia. Home: hero readiness-first con estado "sin datos" (eliminar el 1.18/78 hardcodeado) + tarjeta próxima acción. Timer MMA: presets, aviso configurable, sonidos reales. Nutrición: quick add + rediseño de la foto como lista editable (mock). Onboarding: wizard de 4 pasos. | Máximo impacto percibido con cero dependencias; corrige el bug de kcal y elimina los datos falsos del dashboard, los dos agujeros de credibilidad actuales. |
| **2. Backend estructural — identidad y datos base** | Recuperación de contraseña + reenvío de verificación. Perfil ampliado (`goal`, `disciplines`, `experience_level`, `goal_weight_kg`, `goal_date`). Biometría: PATCH/DELETE + fecha retroactiva. | Cierra el único bloqueante real de auth y crea los campos de perfil que consumen Home, Biometría y Nutrición (objetivo/categoría/fecha de combate). |
| **3. Backend estructural — ActivityLog unificado** | Modelo `Activity` (deportes) + sesión MMA ampliada (tipo de trabajo) + `Exercise`/`Routine`/`WorkoutSession`/`SetLog` (gimnasio, con biblioteca free-exercise-db) y migración desde localStorage. Encima: motor de carga único (sRPE → ACWR con EWMA + monotonía + PMC), `GET /api/dashboard/summary`, estadísticas MMA, placeholder "previo", PRs/e1RM, cumplimiento de Mi rutina. | Es la pieza que desbloquea más vistas a la vez: Home (readiness/ACWR reales), Deportes (historial multi-dispositivo), MMA (stats), Gimnasio (sesión completa) y Coach y Carga (todas sus gráficas). |
| **4. Backend de hábito diario** | Nutrición persistida: recientes/copiar ayer, barcode + Open Food Facts, raciones, agua, objetivo adaptativo semanal, periodización de carbos (lee el calendario de la fase 3). Check-in de wellness + desglose de readiness + motor de reglas de tarjetas + feedback "¿útil?" + "Aplicar" sobre el plan. Web Push (recordatorio de pesaje, rest timer). | Convierte la app en uso diario; el motor de reglas ya da el 90% del valor del coach sin coste de LLM. |
| **5. [IA] real** | Briefing diario (1/día, plantilla fija, cacheado). Chat acotado con RAG sobre métricas (sustituye los chats simulados de MMA y Coach). Visión foto→alimentos sobre la UI editable de fase 1. Wizard de rutinas con JSON validado contra la biblioteca. Después: insights post-sesión/semanales y ajuste de carga por readiness. | La IA llega cuando hay datos reales que anclar y UI preparada para su salida; antes sería texto enlatado fingiendo ser IA, lo que todos los benchmarks penalizan. |