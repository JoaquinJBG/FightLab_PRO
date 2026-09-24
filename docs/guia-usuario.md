# FightLab Pro — Guía de usuario

> Documento **vivo**: se actualiza con cada vista que se mejora. Última actualización: 2026-09-24 (beta cerrada desplegada en Neon + Render + Vercel — ver [`docs/DEPLOY.md`](DEPLOY.md)).
> Al final hay una tabla de **estado de funcionalidades** (real / simulado / pendiente) que sirve de checklist para no dejar nada a medias.

FightLab Pro es una **PWA** (app web instalable) para atletas de combate y multideporte: entrena, mide tu recuperación, controla tu peso y nutrición, y (próximamente) deja que el coach IA ajuste tus planes.

---

## 1. Primeros pasos

### Instalar la app en el móvil
1. Abre la URL de la app en el navegador del móvil.
2. **Android/Chrome:** menú ⋮ → *Añadir a pantalla de inicio* / *Instalar app*.
3. **iPhone/Safari:** botón compartir → *Añadir a pantalla de inicio*.
4. Se abre a pantalla completa con su icono, como una app nativa.

### Crear cuenta
1. **Crear cuenta** → email + contraseña. La contraseña tiene una **checklist en vivo** (8+ caracteres, no solo números, distinta de tu email) y botón *Mostrar/Ocultar*.
2. Te llega un **email de verificación** real a tu bandeja (revisa también spam) → abre el enlace. El enlace **vence en 24 horas**; si caduca, vuelve a registrarte y se reenvía. *(Si el backend no tiene credenciales de email configuradas, el enlace se imprime en su consola en lugar de enviarse.)*
3. **Inicia sesión** → arranca el **onboarding**.

### Onboarding (primera vez)
Wizard de 4 pasos con barra de progreso:
- **Bienvenida** — qué te da la app.
- **Paso 1 · Físico (obligatorio)** — fecha de nacimiento (cajas DD/MM/AAAA con auto-avance), altura y sexo (opcional). Cada dato explica para qué se usa.
- **Paso 2 · Combate (saltable)** — disciplinas que practicas, guardia, experiencia.
- **Paso 3 · Objetivo (saltable)** — qué buscas, días de entreno/semana, unidades.

Al terminar entras en el **Home**. Todo se puede cambiar después en *Perfil → Editar perfil*.

### Sesión
- La sesión se mantiene sola (tokens seguros en cookies; se renuevan en segundo plano).
- **Cerrar sesión:** Perfil → *Cerrar sesión*.
- Si olvidas la contraseña: **Olvidé mi contraseña** en el login → te llega un email con un enlace para poner una nueva. El enlace es de un solo uso.
- Es una **beta cerrada por invitación**: solo puede registrarse quien tenga su email en la lista de invitados. Si te sale "Registro solo por invitación", pide que te añadan.

---

## 2. Home (Inicio)

Tu mañana en una pantalla, de arriba abajo:

| Bloque | Qué hace |
|---|---|
| **Estado de hoy** | Readiness cualitativo (Listo / Día normal / Tómatelo suave) calculado con **tus** FC en reposo y HRV comparadas con tu propia media. Necesita ~4 registros con esas medidas; si faltan, te dice cómo activarlo. |
| **Hoy / próxima acción** | Lee tu calendario de gimnasio y tus sesiones: "Entreno hecho ✓", "Hoy toca: Empuje", "Descanso programado" o "Nada planificado". |
| **Recordatorio de peso** | Si llevas **14+ días** sin apuntar peso, te lo recuerda (cada 2 semanas). |
| **Peso** | Último peso con frescura ("hoy / hace X días"), gráfica de tendencia y **distancia a tu objetivo de pesaje** si lo configuraste en Nutrición. |
| **Métricas de recuperación** | FC reposo, HRV y % grasa con **delta vs tu media** (flecha verde/ámbar). |
| **Tu semana** | 7 puntos L–D: días con medición o entreno registrado. |
| **Carga de entreno (ACWR)** | Tu carga semanal (AU) y tu ACWR **reales**, calculados de tus sesiones con RPE; si aún no hay sesiones, lo dice honestamente. |

---

## 3. Biometría

### Registrar una medición
**Home → Actualizar biometría** (o desde los avisos).

- **Medida típica:** peso (con eso basta).
- **Medidas avanzadas (opcional, plegable):** % grasa, FC en reposo, HRV — cada una con un **ⓘ** que explica qué es y cómo se mide.
- **Perímetros (opcional, plegable):** cintura, cadera, pecho, brazo, muslo y cuello con cinta métrica — progreso que la báscula no enseña.
- La **altura no va aquí**: es un dato de perfil (se pone una vez en onboarding/perfil).
- Al guardar te lleva a la **gráfica de tendencia** para ver tu punto nuevo.

### Historial y tendencia
**Home → tarjeta de Peso** (o `/biometrics`):

- **Peso de tendencia**: media suavizada de tus pesajes (estilo Happy Scale) — ignora las fluctuaciones diarias de agua/glucógeno. *Fíate de la línea, no del punto de hoy* (el ⓘ lo explica).
- **Ritmo semanal**: cuánto sube/baja tu tendencia por semana (kg/semana).
- **Gráfica** con rangos **1M / 3M / 6M / Todo**: puntos = pesajes, línea neón = tendencia. Muestra también la distancia de la tendencia a tu objetivo de pesaje.
- **IMC calculado** (peso de tendencia + altura del perfil) con su ⓘ — ojo: en atletas musculados sobreestima la grasa; es solo orientativo.
- **Historial completo** de mediciones (peso, recuperación, cintura…) con **borrado** en dos toques (✕ → ¿Borrar?).
- **Fotos de progreso**: sube fotos (misma luz, misma pose) y compáralas en el tiempo. Se guardan **en el servidor** (no en el dispositivo), privadas —solo con tu sesión, nadie más puede verlas ni borrarlas— y validadas como imagen real. Más adelante la **IA podrá analizarlas** para evaluar tu progreso.

> Consejo: registra FC en reposo y HRV unos días seguidos para activar el "Estado de hoy" del Home.

---

## 4. Entreno

Hub con resumen **real** de carga arriba (semana en AU + tu banda de carga personal, calculadas con tus sesiones) y 5 secciones:

### 4.1 Deportes — tracker en vivo
1. Elige actividad (correr, caminar, ciclismo, natación, fútbol, cuerda, senderismo, elíptica).
2. **Iniciar** → cuenta atrás **3-2-1** → cronómetro y **kcal en directo** (calculadas con tu peso real y la intensidad elegida; cambiar la intensidad solo afecta hacia delante).
3. La **pantalla no se apaga** durante la sesión. Si cierras la app, al volver verás **"Sesión sin terminar"** → Reanudar o Descartar (hasta 12 h).
4. Para parar: **mantén pulsado** "Mantén para parar" (~1 s).
5. Pantalla **"¿Cómo ha ido?"**: revisa tiempo y kcal, puntúa el **RPE 1-10** (ⓘ explica la escala) → se calcula tu **carga de la sesión (AU = min × RPE)** → Guardar.
6. Pestaña **Actividad**: historial con fecha, intensidad, RPE, AU, tiempo y kcal.

La **intensidad** tiene rangos orientativos: km/h en deportes de ritmo (correr 9–12 km/h = moderado…) o RPE en el resto.

### 4.2 MMA
- Elige **arte marcial** (desplegable) y **tipo de trabajo**: Sparring, Drilling, Pads, Saco, Técnica o Acondicionamiento — cada uno con su descripción.
- **Plan sugerido**, marcado **"Demo · próximamente IA"**, según arte+tipo+duración *(por reglas; pronto lo personalizará la IA con tu historial)* + aviso de protecciones.
- **↻ Repetir última**: rellena arte, tipo de trabajo, duración y compañero con los de tu última sesión, para apuntar rápido sin volver a elegirlo todo.
- **Registrar sesión**: duración + RPE + **compañero** y **notas** opcionales (técnicas trabajadas, sensaciones…) → **carga en AU**.
- **Stats del mes**: sesiones, horas, AU totales y reparto de minutos por arte.
- **Historial** con tipo, compañero y notas de cada sesión.
- **Burbuja del coach** (abajo a la derecha), marcada **"Demo · próximamente IA"**: chat que te prepara la sesión, recuerda calentar/estirar/hidratarte.

### 4.3 Gimnasio
- **▶ Empezar entreno** (con el foco de hoy precargado del calendario) → **registro en sesión** estilo Hevy:
  - Ejercicios con series **kg × reps** y check de serie hecha; "+ Serie" copia la anterior.
  - Al completar una serie arranca el **descanso automático** (60/90/120 s, se recuerda) con chip flotante **+30s / Saltar** y aviso sonoro+vibración al acabar.
  - Cada serie muestra el valor de **tu última vez** en ese ejercicio ("anterior: 80 kg × 8") con un toque para copiarlo a la serie de hoy, y cada ejercicio muestra tu **PR** (kg máximo histórico).
  - **+ Añadir ejercicio** con buscador (biblioteca por grupos: pecho, espalda, pierna, hombro, brazo, core).
  - Reloj de sesión, pantalla siempre encendida y **recuperación** si cierras la app (banner "Entreno sin terminar").
  - Al terminar: resumen (duración, series, **kg totales levantados**) + **RPE** → carga en AU → guardar.
- **Últimos entrenos** en la pestaña calendario. Los entrenos cuentan como "entreno hecho" en el Home.
- **Calendario**: asigna un foco a cada día de la semana (empuje, tirón, pierna, descanso…). El Home lo lee para tu "próxima acción".
- **Crear rutina**: marcado **"Próximamente"** — el generador automático se ha desactivado para no fingir un resultado; llegará con la IA real y tu historial.

### 4.4 Mi rutina
Marcado **"Próximamente"**: aquí verás el plan semanal (gym + MMA) que te asigne tu **entrenador**, con ejercicios por día y marcar como hecho — pendiente del rol de entrenador y su panel.

### 4.5 Herramientas
- **Timer de rounds**: presets (Boxeo 3×3, MMA 5×5, Tabata, HIIT) o configura rounds/trabajo/descanso/preparación — tu configuración **se recuerda**. **Campana de boxeo real** (doble al empezar, triple al acabar), **aviso de fin de round configurable** (Off / 10 s / 30 s con "clack" de tablas), cuenta 3-2-1, anillo con color por fase, **vibración**, pantalla siempre encendida y saltar round.
- **Cronómetro** con vueltas.

### 4.6 Carga y estado
**Calculado con tus datos reales** (sesiones con RPE de Deportes, MMA y Gimnasio + tu biometría):
- **Estado de hoy**: tu recuperación (FC reposo/HRV vs tu media), igual que en el Home.
- **Carga vs tu rango**: tu banda de carga personal (baja / dentro de tu rango / elevada / sobrecarga), calculada con **tu propio historial**, no con un umbral fijo igual para todo el mundo. Necesita ~14 días de sesiones para activarse y se marca **provisional*** hasta acumular 4 semanas.
- **Detalles avanzados** (plegable): el ACWR numérico de toda la vida, para quien quiera verlo — sin semáforo, con su propio aviso de "necesitamos X días más" si aún no hay historial suficiente.
- **Carga semanal**: barras de AU por día (tus sesiones reales).
- **Monotonía y tensión** (fórmulas de Foster) cuando hay datos suficientes.
- Cada métrica con su **ⓘ** explicativo y estados vacíos honestos (nunca números inventados).

**Tus sesiones ya viven en tu cuenta**: al guardar un entreno (Deportes, MMA o Gimnasio) se
sincroniza con el servidor — el historial antiguo del dispositivo se migra solo la primera vez.
Si no hay conexión, queda en cola y se sube al volver. El historial de Deportes y MMA, la carga
semanal, el "última vez"/PR del gimnasio y **tu banda de carga** se calculan y se leen ya del
servidor (misma cuenta en cualquier dispositivo); sin conexión, se calculan en el dispositivo
como hasta ahora.

---

## 5. Nutrición

### Diario del día
- **Kcal de hoy vs objetivo** + barras de **proteína / carbohidratos / grasa**.
- Los objetivos se **calculan de tu perfil** (peso, altura, edad, sexo — fórmula Mifflin-St Jeor) y del selector **Perder / Mantener / Ganar**.
- **Agua 💧**: cuenta tus vasos del día (~250 ml) hacia el objetivo de ~2 L.
- 4 comidas (desayuno, comida, cena, snack) con su subtotal, botón **+** y **borrado** de cualquier alimento en dos toques (✕ → ¿Borrar?).

### Añadir comida
Tres formas, según la prisa:
- **Recientes**: tus alimentos de los últimos 14 días, repetir en **un toque** (✓ al añadir).
- **Buscar**: buscador → gramos → kcal y macros escalados → añadir.
- **Rápido**: ¿sabes las kcal? Apúntalas directas (nombre y macros opcionales).

Además:
- **📷 Hacer foto**: abre la cámara, la foto se comprime y se analiza con **Claude (visión real)**, y devuelve los **alimentos del plato como lista editable** — ajusta los gramos de cada uno (recalcula kcal), quita lo que no sea, y "Añadir todo". Si la IA no reconoce comida, si no está configurada o si se agotó tu límite de fotos del día, te lo dice con un mensaje honesto (nunca inventa un plato de ejemplo) y siempre puedes seguir con la entrada manual de abajo.
- **Copiar de ayer**: si ayer registraste esa comida, un toque la copia entera.

### Pesaje (corte de peso básico)
- Configura **peso objetivo** y **días hasta el pesaje** → countdown grande + comparación objetivo / actual / por bajar (lee tu peso real de Biometría).
- El Home muestra la distancia a ese objetivo en la tarjeta de peso.

---

## 6. Coach

- **Chips de contexto reales**: lo que el coach "ve" de verdad — tu carga (banda personal), tu carga semanal (AU), tu peso, los días al pesaje y tu estado de recuperación.
- **Briefing de hoy**: generado **por reglas con tus datos** (recuperación baja → suave; carga elevada → frena; pesaje cerca → ojo al déficit…), hablando de "tu rango habitual" en vez de un umbral fijo igual para todo el mundo.
- **Recomendaciones por reglas**: carga alta/margen, recuperación baja, pesaje, peso sin apuntar… con **Descartar** (vuelven al día siguiente) y **feedback 👍/👎** que se guarda para entrenar a la IA futura.
- **Memoria del coach**: cuéntale una vez tu lesión actual, tu fase (pretemporada, a X semanas de una pelea…), tu objetivo de peso y qué tono prefieres (más o menos frecuente), y lo tiene en cuenta en el chat y el briefing sin que se lo repitas cada vez. Se guarda en tu cuenta, la puedes editar o vaciar cuando quieras desde la propia pantalla del Coach, y solo se usa para dar mejores respuestas (nunca para nada más).
- **Chat**: pregúntale "¿cómo voy?", por el entreno, tu carga o tu peso. Con la clave de Anthropic configurada responde **Claude de verdad** usando tu contexto real (carga, recuperación, peso, pesaje, memoria) — etiqueta **"IA real"**, con un límite de mensajes por día para que la IA no se dispare de coste. Si la IA no está disponible o agotaste tu límite del día, cae a respuestas **por reglas con tus números** y lo indica.
- ⚠️ El coach es orientativo, **no es consejo médico**.

---

## 7. Perfil

- **Ver**: email, rol y tus datos (nacimiento, sexo, altura, guardia, unidades).
- **Editar perfil**: mismos campos, con las cajas DD/MM/AAAA para la fecha.
- **Cerrar sesión** aquí.

---

## 8. Estado de funcionalidades (checklist)

✅ real · 🟡 funciona pero guarda **solo en el dispositivo** · 🎭 demo (UI lista, motor pendiente — etiquetado como tal en la propia app: "Próximamente" / "Demo") · ⏳ pendiente

| Funcionalidad | Estado | Pendiente |
|---|---|---|
| Registro + verificación email + login + sesión segura | ✅ | — |
| Beta cerrada (registro solo por invitación) | ✅ | Ampliar la lista de invitados o abrir la beta |
| Recuperación de contraseña | ✅ | — |
| Onboarding (físico → perfil) | ✅ | — |
| Onboarding (disciplinas/experiencia/objetivo/frecuencia) | ✅ | Sincronizado con la cuenta (`localStorage` + copia en servidor) |
| Perfil ver/editar | ✅ | — |
| Biometría (peso, % grasa, FC, HRV) | ✅ | — |
| Biometría: tendencia (media móvil) + historial + borrar | ✅ | Editar entradas y fecha retroactiva |
| Biometría: perímetros (cintura…) + IMC calculado | ✅ | Tendencia de cintura en gráfica (futuro) |
| Fotos de progreso (privadas, guardadas en el servidor) | ✅ | Análisis por IA · comparador lado a lado |
| Home: estado de hoy (readiness por recuperación) | ✅ | — |
| Home: próxima acción / semana / objetivo de peso | ✅ | — |
| Deportes: tracker en vivo + RPE + AU + historial | ✅ | Historial y stats ya se leen del servidor (ActivityLog), con cola offline si no hay conexión |
| MMA: sesiones pro (tipo, compañero, notas), "Repetir última" + stats del mes + historial | ✅ | Historial y stats ya se leen del servidor (ActivityLog), con cola offline si no hay conexión |
| MMA: plan sugerido + chat coach | 🎭 Demo | IA real con tu historial |
| Gimnasio: calendario semanal | ✅ | Sincronizado con la cuenta (`localStorage` + copia en servidor) |
| Gimnasio: registro en sesión (series×reps×kg, valor anterior tipo Hevy, rest timer automático, PRs, volumen) | ✅ | Modelos detallados Exercise/SetLog + gráfica de progresión histórica |
| Gimnasio: crear rutina con IA | 🎭 Próximamente | Generador honesto (sin fingir resultado) hasta tener IA real con biblioteca de ejercicios |
| Mi rutina (asignada por coach) | 🎭 Próximamente | Rol entrenador + su panel |
| Herramientas: timer de rounds (campana real, aviso configurable, config recordada) + cronómetro | ✅ | — |
| Carga vs tu rango (banda de carga personal, sustituye al semáforo fijo de ACWR) | ✅ | Calculada en el servidor (misma fórmula, con fallback local sin conexión) · gráfica PMC histórica pendiente |
| ACWR numérico (sección avanzada, sin semáforo) | ✅ | — |
| Nutrición: diario + objetivos calculados + agua + pesaje + borrar items | ✅ | Sincronizado con la cuenta (`localStorage` + copia en servidor) · objetivo adaptativo (futuro) |
| Nutrición: recientes, copiar de ayer y entrada rápida | ✅ | — |
| Nutrición: foto → lista editable de alimentos | ✅* | *Visión real con Claude, con límite diario por usuario; si falla o no hay clave configurada, mensaje honesto (nunca un plato de ejemplo) · escáner de código de barras (futuro) |
| Nutrición: buscador de alimentos | 🟡 | Base real (Open Food Facts, futuro) |
| Pesaje (objetivo + countdown) | ✅ | Aviso push del pesaje (futuro) |
| Coach: briefing y recomendaciones **por reglas con datos reales** + feedback 👍👎 sincronizado con la cuenta | ✅ | Redacción por IA |
| Coach: memoria persistente (lesión, fase, objetivo de peso, tono) | ✅ | — |
| Coach: chat | ✅* | *Claude real con tu contexto y tu memoria si hay `ANTHROPIC_API_KEY`, con límite diario por usuario (si no, por reglas y lo indica) |
| IA: límites de uso diarios por usuario (chat del coach y fotos de comida) | ✅ | — |
| Notificaciones push (recordatorios con la app cerrada) | ⏳ | — |
| Integración con relojes (Xiaomi Watch 2 del usuario, Garmin/Apple/Whoop) | ⏳ | El modelo ya acepta fuente XIAOMI, id externo y payload crudo |

> Hoja de ruta completa: `docs/superpowers/specs/2026-06-11-v1-plan-mejora-por-vista.md`.
> Cómo desplegar esta beta: [`docs/DEPLOY.md`](DEPLOY.md).

---

## 9. Novedades de la beta

Lo que trae esta pasada respecto a la v1 completa:

- **La app vive en internet**: beta cerrada por invitación, con tu cuenta accesible desde cualquier dispositivo.
- **Recuperación de contraseña** de punta a punta, por email.
- **Tus datos te siguen entre dispositivos**: nutrición, agua, pesaje, calendario del gimnasio, perfil extra del onboarding y feedback del coach ya no viven solo en el móvil donde los guardaste — se sincronizan con tu cuenta.
- **Historiales en el servidor**: Deportes, MMA y Gimnasio ya leen su historial, stats y "última vez"/PR de tu cuenta, no del dispositivo.
- **Carga vs tu rango**: se retira el semáforo fijo de ACWR (0.8–1.3 para todo el mundo) en favor de una banda calculada con tu propio historial; el ACWR de siempre sigue disponible en una sección avanzada, sin semáforo. También calculada en el servidor.
- **Memoria del coach**: cuéntale tu lesión, tu fase, tu objetivo de peso y el tono que prefieres, y lo recuerda en el chat y el briefing.
- **Gimnasio más rápido de registrar**: valor de tu última vez por serie (toca para copiar), estilo Hevy.
- **MMA con "Repetir última"**: una sesión igual a la anterior, en un toque.
- **Lo que aún no es real se dice claramente**: el generador de rutina de gimnasio y "Mi rutina" pasan a "Próximamente" en vez de fingir un resultado; el plan sugerido y el chat del coach de MMA quedan marcados como "Demo".
- **IA con límites diarios por usuario**, para que nadie agote sin querer el presupuesto de toda la beta.
