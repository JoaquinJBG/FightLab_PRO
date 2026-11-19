# FightLab Pro — Visión Ampliada v2 (auditoría competitiva)

> Fecha: 2026-07-02 · Estado: borrador, pendiente de revisión del usuario · Tipo: documento marco (amplía [`2026-06-01-fightlab-pro-vision-design.md`](./2026-06-01-fightlab-pro-vision-design.md))

## 1. Objetivo de este documento

Tras completar la "pasada v1" (M1–M4 con datos reales, ver `2026-06-11-v1-plan-mejora-por-vista.md`), el usuario pidió ampliar la visión del producto con el objetivo explícito de aspirar a **"la mejor app de deporte y nutrición"**. Antes de especificar nada nuevo se hizo una **auditoría competitiva** (deep-research con verificación adversarial 3-voto, 108 agentes, 25 fuentes) sobre 4 categorías: entrenamiento/carga, nutrición de precisión y corte de peso, coach IA, y apps específicas de combate.

Este documento traduce esos hallazgos en un **backlog priorizado** para ampliar M2 (Entrenamiento), M3 (Nutrición) y M4 (Coach IA). No reemplaza la visión base, la extiende.

## 2. Hallazgo central: cuál es la ventaja competitiva real

Ninguna app dominante en el mercado combina **logging específico de combate + motor de carga + nutrición periodizada + corte de peso + biometría de recuperación** en una sola herramienta:

- Las apps de combate dedicadas (ej. My Combat App) cubren bien el logging por modalidad (sparring, pad work, técnica...) y un score de carga semanal, pero tienen **cero nutrición y cero corte de peso**.
- Las apps de fitness/nutrición genéricas (Whoop, TrainingPeaks, MacroFactor) no entienden el contexto de combate (pesaje, fases de fight camp, corte de peso).

**FightLab Pro ya está construido sobre ese hueco.** La ampliación no es "inventar una idea nueva", es **profundizar el módulo de corte de peso hasta hacerlo serio** y pulir la UX de lo que ya existe con patrones probados de los líderes de cada categoría por separado.

## 3. Backlog priorizado

### P0 — Pulido de UX sobre módulos ya existentes (bajo riesgo, alto impacto, no requiere investigación adicional)

**3.1 Banda de carga tipo Strava (Home / Coach+Carga)**
Sustituir o complementar el número crudo de ACWR por una **banda de rango de 3 semanas con semáforo** (verde=sostenible, ámbar/rojo=por encima de tu rango habitual → toca recuperación, azul=por debajo → fase de descarga). El ACWR crudo es difícil de interpretar para el usuario; esta metáfora visual sí lo es.
*Depende de:* `lib/load.ts` / motor de carga en servidor (ya existen, PR #21).

**3.2 Logging de fricción mínima estilo Hevy (Gimnasio, MMA)**
- Mostrar el valor de la sesión/serie anterior del mismo ejercicio **inline**, sin salir de la pantalla de registro.
- Timer de descanso automático al marcar una serie como completada (Gimnasio ya tiene rest timer parcial; extenderlo al patrón "un tap = completado").
*Depende de:* loggers actuales de Gimnasio y MMA.

**3.3 Memoria persistente del coach (Coach IA)**
El chat con Claude hoy no conserva contexto entre sesiones de conversación. Añadir una capa de **memoria persistente por atleta** (lesión activa, fase de fight camp, objetivo de peso, preferencias) que se aplique a través de chat, briefing y recomendaciones — no solo dentro de una conversación aislada. Incluir, al estilo Oura Advisor, un ajuste simple de **tono** (directo vs. conversacional) y **frecuencia** de check-ins proactivos.
*Depende de:* app `ai` (PR #20), tabla de perfil del atleta.

### P1 — Diferenciador estratégico: módulo de corte de peso serio (M3, esfuerzo medio-alto)

Hoy M3 solo tiene "corte de peso básico" (peso objetivo vs. actual + countdown). Ampliarlo a un módulo real de **periodización de fight camp**:

- Fases explícitas del campamento (base → pico → water cut → pesaje → recuperación) con macros que cambian por fase.
- Objetivos de macros de referencia por fase (rango orientativo, no prescripción médica) calibrados con literatura deportiva.
- Alertas de **corte anómalamente agresivo** comparado con magnitudes de referencia realistas.
- Protocolo de rehidratación post-pesaje como información educativa (no automatización de dosis exactas).

⚠️ **Importante — verificar antes de codificar:** la investigación encontró cifras específicas (rangos de macros ISSN, umbrales de %RWL por franja horaria, protocolo exacto de rehidratación, magnitudes de corte por disciplina) en fuentes de calidad, pero **varias de esas cifras concretas no sobrevivieron la verificación adversarial** (ver §4). Antes de fijar cualquier número como regla dura o alerta automática de seguridad, hay que **releer directamente la fuente primaria** (ISSN position stand 2025, `tandfonline.com/doi/10.1080/15502783.2025.2467909`) en vez de confiar en el resumen de esta auditoría. Esto es un módulo que toca salud — los umbrales deben ser conservadores y estar bien fundamentados.

### P2 — Investigar más antes de especificar (evidencia débil en esta ronda)

La auditoría dejó dos áreas con **cobertura verificada insuficiente** — se sabe que el patrón existe pero no se pudo confirmar el mecanismo con la misma solidez que el resto:

- **Ajuste dinámico de macros por tendencia real de peso** (estilo MacroFactor): qué algoritmo de suavizado usan, con qué frecuencia recalculan. Relevante para Nutrición (M3) más allá del corte de peso.
- **Generación de rutinas por IA a partir del historial real** (estilo Freeletics/Fitbod): qué señales usan, frecuencia de recálculo. Esto ya estaba en el backlog previo del proyecto (ver memoria `project-fightlab-pro`); la auditoría lo refuerza pero no aporta mecanismo concreto todavía.

Antes de escribir spec para estas dos, hace falta otra ronda de investigación dirigida específicamente a ellas.

## 4. Caveats — qué NO tomar como validado

La verificación adversarial (3 votos independientes, se mata un claim con 2/3 en contra) **refutó explícitamente** estas afirmaciones, ampliamente citadas en la industria del fitness pero sin respaldo sólido en esta ronda:

- Superioridad del TSS basado en potencia sobre HR/TRIMP (irrelevante para combate de todos modos, sin potenciómetro).
- Umbrales fijos de ACWR ("sweet spot" 0.8–1.3, riesgo elevado >1.5) y de Monotonía (>2 = factor de riesgo). Son heurísticas muy repetidas en blogs de fitness, pero no sobrevivieron el voto 3-0 en contra aquí.
- Umbrales exactos de %RWL seguro por franja horaria (6.7%/5.7%/4.4%) y protocolo detallado de rehidratación post-pesaje del ISSN.
- Diferencias de magnitud de corte de peso entre disciplinas de combate y cifras de recuperación de peso post-pesaje.

Esto no significa que sean falsas — significa que **esta auditoría no las confirmó con suficiente solidez** para tratarlas como hechos científicos al implementar reglas automáticas. Si en el futuro se codifican umbrales de seguridad (especialmente en el módulo de corte de peso, P1), hay que verificarlos aparte contra la fuente primaria.

## 5. Próximos pasos sugeridos

1. Revisar y aprobar este documento (o ajustar prioridades).
2. Spec detallada de **P0** (3.1–3.3) — son extensiones de UI/UX sobre módulos que ya funcionan, bajo riesgo, se pueden implementar en la fase 4-5 actual sin bloquear nada.
3. Spec detallada de **P1** (corte de peso serio) como su propio ciclo spec → plan → implementación, con la verificación de fuentes primarias como paso explícito antes de escribir número alguno.
4. Ronda de investigación dirigida para **P2** antes de especificarlo.

Informe completo de la auditoría (hallazgos, fuentes, claims refutados) disponible en el journal del workflow de research de esta sesión si se necesita el detalle completo de nuevo.
