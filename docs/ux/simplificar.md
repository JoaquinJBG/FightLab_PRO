# Simplificar la beta — decidido 2026-11-24

Sigue a [estructura-app.md](estructura-app.md). Queja del usuario: mucho texto, mucho scroll, la IA ocupa
pantallas enteras, botones grandes, y el generador de entrenos da 3 ejercicios por día con mucho texto.
No se añaden funciones; se recoloca, se recorta y se arregla.

## Reglas de texto (todas las pantallas principales)

1. Por tarjeta: un título, un dato clave y una acción. Las explicaciones van detrás de un toque
   (icono ⓘ o «¿Por qué?» que abre un panel inferior), nunca en un párrafo fijo.
2. Ningún texto fijo de más de ~80 caracteres en una portada o pantalla de registro. Los avisos de
   seguridad (golpe en la cabeza, bloqueos, contacto) se quedan, pero en una línea + ⓘ con el detalle.
3. Estados vacíos: una frase + una acción.
4. Una sola acción principal a todo ancho por pantalla. Las secundarias (Importar, Preparar otro,
   Ajustes) son chips o botones pequeños en la cabecera.

## IA solo en Coach

- `AiMenuCard` (menú «Con tu IA») sale de `/nutrition/menu` y pasa a una pantalla del Coach
  (`/coach/menu-ai`), con acceso desde la cabecera del Coach. Mi IA (`/profile/my-ai`) también se abre
  desde el Coach; sale de Ajustes del menú.
- La narrativa del plan (`plan.narrative`) no se pinta en `/training/plan`.
- Foto → kcal en `/nutrition/add` se queda como un icono de cámara pequeño (es una forma rápida de
  apuntar), sin bloque de texto.

## Entreno

- Hub: «Historial» ya no apunta a `/training/gym`. Va a `/training/history`: calendario + lista de todas
  las sesiones (gimnasio, MMA, deporte), reutilizando lo que ya existe.
- Generador (`backend/coaching/plan.py`): sesiones full body de 5–7 ejercicios según patrones
  (rodilla/sentadilla, bisagra de cadera, empuje horizontal, tracción horizontal, empuje o tracción
  vertical, 1 accesorio/core). Con 3 días, rotación A/B/C con variantes distintas. Compuestos 3–4 series,
  accesorios 2–3. Referencias: Fitbod ~7 ejercicios/h; ACSM 2009 (2–3 días novato); 10–20 series/grupo/sem.
- Vista del plan y rutinas: cada ejercicio es una fila (nombre · series × reps · carga). Motivos, RIR,
  base de series, cambios → detrás de «¿Por qué?». Rotación, descarga y bloques «en vivo» en una línea.

## Nutrición / Menú

- `/nutrition/menu`: cabecera con chips pequeños «Preparar menú» (abre el formulario en un panel
  inferior con los valores por defecto) e «Importar» (elige archivo). Sin `menu.intro`. El menú ocupa la
  pantalla.
- Sin menú: estado vacío de una frase + «Preparar menú».
