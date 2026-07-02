# FightLab Pro — Guía de usuario

> Documento **vivo**: se actualiza con cada vista que se mejora. Última actualización: 2026-06-11 (tras Coach + Carga v1 — **pasada v1 completa**).
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
- Si olvidas la contraseña: **aún no hay recuperación** (en camino, fase 2).

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
- **Fotos de progreso**: sube fotos (misma luz, misma pose) y compáralas en el tiempo. Privadas (solo con tu sesión) y validadas como imagen real. Más adelante la **IA podrá analizarlas** para evaluar tu progreso.

> Consejo: registra FC en reposo y HRV unos días seguidos para activar el "Estado de hoy" del Home.

---

## 4. Entreno

Hub con resumen **real** de carga arriba (semana en AU + ACWR de tus sesiones) y 5 secciones:

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
- **Plan sugerido** según arte+tipo+duración *(por reglas; pronto lo personalizará la IA con tu historial)* + aviso de protecciones.
- **Registrar sesión**: duración + RPE + **compañero** y **notas** opcionales (técnicas trabajadas, sensaciones…) → **carga en AU**.
- **Stats del mes**: sesiones, horas, AU totales y reparto de minutos por arte.
- **Historial** con tipo, compañero y notas de cada sesión.
- **Burbuja del coach** (abajo a la derecha): chat que te prepara la sesión, recuerda calentar/estirar/hidratarte *(simulado por ahora)*.

### 4.3 Gimnasio
- **▶ Empezar entreno** (con el foco de hoy precargado del calendario) → **registro en sesión** estilo Hevy:
  - Ejercicios con series **kg × reps** y check de serie hecha; "+ Serie" copia la anterior.
  - Al completar una serie arranca el **descanso automático** (60/90/120 s, se recuerda) con chip flotante **+30s / Saltar** y aviso sonoro+vibración al acabar.
  - Cada ejercicio muestra **"Última vez"** y tu **PR** (kg máximo histórico).
  - **+ Añadir ejercicio** con buscador (biblioteca por grupos: pecho, espalda, pierna, hombro, brazo, core).
  - Reloj de sesión, pantalla siempre encendida y **recuperación** si cierras la app (banner "Entreno sin terminar").
  - Al terminar: resumen (duración, series, **kg totales levantados**) + **RPE** → carga en AU → guardar.
- **Últimos entrenos** en la pestaña calendario. Los entrenos cuentan como "entreno hecho" en el Home.
- **Calendario**: asigna un foco a cada día de la semana (empuje, tirón, pierna, descanso…). El Home lo lee para tu "próxima acción".
- **Crear rutina**: wizard (nivel, días/semana, tipo de split, objetivo) → rutina propuesta → **Aplicar al calendario**. *(Generación simulada; la IA real llegará con tu historial.)*

### 4.4 Mi rutina
Plan semanal asignado por tu **entrenador** (gym + MMA) con ejercicios por día y marcar como hecho. *(Datos de ejemplo; el panel del coach llegará más adelante.)*

### 4.5 Herramientas
- **Timer de rounds**: presets (Boxeo 3×3, MMA 5×5, Tabata, HIIT) o configura rounds/trabajo/descanso/preparación — tu configuración **se recuerda**. **Campana de boxeo real** (doble al empezar, triple al acabar), **aviso de fin de round configurable** (Off / 10 s / 30 s con "clack" de tablas), cuenta 3-2-1, anillo con color por fase, **vibración**, pantalla siempre encendida y saltar round.
- **Cronómetro** con vueltas.

### 4.6 Carga y estado
**Calculado con tus datos reales** (sesiones con RPE de Deportes, MMA y Gimnasio + tu biometría):
- **Estado de hoy**: tu recuperación (FC reposo/HRV vs tu media), igual que en el Home.
- **ACWR** con semáforo (zona óptima 0.8–1.3). Necesita ~10 días de sesiones para activarse y se marca **provisional*** hasta acumular 4 semanas de historial.
- **Carga semanal**: barras de AU por día (tus sesiones reales).
- **Monotonía y tensión** (fórmulas de Foster) cuando hay datos suficientes.
- Cada métrica con su **ⓘ** explicativo y estados vacíos honestos (nunca números inventados).

**Tus sesiones ya viven en tu cuenta**: al guardar un entreno (Deportes, MMA o Gimnasio) se
sincroniza con el servidor — el historial antiguo del dispositivo se migra solo la primera vez.
Si no hay conexión, queda en cola y se sube al volver. Las métricas las calcula el servidor
(misma fórmula) y, sin conexión, se calculan en el dispositivo como hasta ahora.

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
- **📷 Hacer foto**: abre la cámara, la foto se analiza con **Claude (visión real)** y devuelve los **alimentos del plato como lista editable** — ajusta los gramos de cada uno (recalcula kcal), quita lo que no sea, y "Añadir todo". La etiqueta dice **"IA real"** o, si la clave de Anthropic no está configurada, **"IA simulada"** con un plato de ejemplo. Si la IA no reconoce comida, te lo dice (sin inventar).
- **Copiar de ayer**: si ayer registraste esa comida, un toque la copia entera.

### Pesaje (corte de peso básico)
- Configura **peso objetivo** y **días hasta el pesaje** → countdown grande + comparación objetivo / actual / por bajar (lee tu peso real de Biometría).
- El Home muestra la distancia a ese objetivo en la tarjeta de peso.

---

## 6. Coach

- **Chips de contexto reales**: lo que el coach "ve" de verdad — tu ACWR, tu carga semanal (AU), tu peso, los días al pesaje y tu estado de recuperación.
- **Briefing de hoy**: generado **por reglas con tus datos** (recuperación baja → suave; ACWR alto → frena; pesaje cerca → ojo al déficit…).
- **Recomendaciones por reglas**: carga alta/margen, recuperación baja, pesaje, peso sin apuntar… con **Descartar** (vuelven al día siguiente) y **feedback 👍/👎** que se guarda para entrenar a la IA futura.
- **Chat**: pregúntale "¿cómo voy?", por el entreno, tu carga o tu peso. Con la clave de Anthropic configurada responde **Claude de verdad** usando tu contexto real (carga, ACWR, recuperación, peso, pesaje) — etiqueta **"IA real"**. Si la IA no está disponible, cae a respuestas **por reglas con tus números** y lo indica.
- ⚠️ El coach es orientativo, **no es consejo médico**.

---

## 7. Perfil

- **Ver**: email, rol y tus datos (nacimiento, sexo, altura, guardia, unidades).
- **Editar perfil**: mismos campos, con las cajas DD/MM/AAAA para la fecha.
- **Cerrar sesión** aquí.

---

## 8. Estado de funcionalidades (checklist)

✅ real · 🟡 funciona pero guarda **en el dispositivo** (pasará a tu cuenta) · 🎭 simulado (UI lista, motor pendiente) · ⏳ pendiente

| Funcionalidad | Estado | Pendiente |
|---|---|---|
| Registro + verificación email + login + sesión segura | ✅ | — |
| Recuperación de contraseña | ⏳ | Fase 2 backend |
| Onboarding (físico → perfil) | ✅ | — |
| Onboarding (disciplinas/experiencia/objetivo/frecuencia) | 🟡 | Columnas de perfil en fase 2 |
| Perfil ver/editar | ✅ | Campos nuevos de fase 2 |
| Biometría (peso, % grasa, FC, HRV) | ✅ | — |
| Biometría: tendencia (media móvil) + historial + borrar | ✅ | Editar entradas y fecha retroactiva (fase 2) |
| Biometría: perímetros (cintura…) + IMC calculado | ✅ | Tendencia de cintura en gráfica (futuro) |
| Fotos de progreso (privadas, con borrado) | ✅ | Análisis por IA (fase 5) · comparador lado a lado |
| Home: estado de hoy (readiness por recuperación) | ✅ | Versión completa con carga de entreno (fase 3) |
| Home: próxima acción / semana / objetivo de peso | 🟡 | Leen datos locales (calendario gym, actividades, pesaje) |
| Deportes: tracker en vivo + RPE + AU | ✅ | Sesiones en tu cuenta (ActivityLog) con cola offline; el historial visible aún lee el dispositivo |
| MMA: sesiones pro (tipo, compañero, notas) + stats del mes | ✅ | Sesiones en tu cuenta (ActivityLog); stats del mes aún sobre datos locales |
| MMA: plan sugerido + chat coach | 🎭 | IA real (fase 5) |
| Gimnasio: calendario semanal | 🟡 | Backend (fase 3) |
| Gimnasio: registro en sesión (series×reps×kg, rest timer, PRs, volumen) | ✅ | Resumen de sesión en tu cuenta (ActivityLog); modelos detallados Exercise/SetLog + gráfica de progresión pendientes |
| Gimnasio: crear rutina con IA | 🎭 | IA real con biblioteca de ejercicios (fase 5) |
| Mi rutina (asignada por coach) | 🎭 | Rol entrenador + backend (post-v1) |
| Herramientas: timer de rounds (campana real, aviso configurable, config recordada) + cronómetro | ✅ | — |
| Carga y estado (ACWR, monotonía, tensión) con tus sesiones | ✅ | Motor de carga en el servidor (misma fórmula; fallback local sin conexión) · gráfica PMC histórica pendiente |
| Nutrición: diario + objetivos calculados + agua + borrar items | 🟡 | Persistencia en cuenta + objetivo adaptativo (fase 4) |
| Nutrición: recientes, copiar de ayer y entrada rápida | 🟡 | Backend (fase 4) |
| Nutrición: foto → lista editable de alimentos | ✅* | *Visión real con Claude si hay ANTHROPIC_API_KEY (si no, ejemplo simulado marcado) · escáner de código de barras (fase 4) |
| Nutrición: buscador de alimentos | 🟡 | Base real (Open Food Facts, fase 4) |
| Pesaje (objetivo + countdown) | 🟡 | Aviso push del pesaje (fase 4) |
| Coach: briefing y recomendaciones **por reglas con datos reales** + feedback 👍👎 | 🟡 | Reglas en backend (fase 4) + redacción por IA (fase 5) |
| Coach: chat | ✅* | *Claude real con tu contexto si hay ANTHROPIC_API_KEY (si no, por reglas y lo indica) |
| Notificaciones push (recordatorios con la app cerrada) | ⏳ | Fase 4 |
| Integración con relojes (Xiaomi Watch 2 del usuario, Garmin/Apple/Whoop) | ⏳ | Post-v1 (el modelo ya acepta fuente XIAOMI, id externo y payload crudo) |

> Hoja de ruta completa: `docs/superpowers/specs/2026-06-11-v1-plan-mejora-por-vista.md`.
