# Changelog

Registro de cambios del prototipo. Ver `diseno-mmo-espacial.md` para el
documento de diseño completo y el roadmap.

## Política de versionado

- **v0.0.X** — parches pequeños: fixes, ajustes de UI, mejoras puntuales
  de una mecánica existente. No cambian el alcance del juego.
- **v0.X** — parches gordos: una pieza nueva de gameplay o infraestructura
  (p. ej. sistema de chunks dinámico, crafteo real, modo a pie, CONCORD).
  Cuando se añade uno de estos, el contador de parches pequeños (`.X`)
  vuelve a 0.
- (Más adelante, cuando el juego tenga forma jugable completa según el
  documento de diseño, se planteará qué significa `v1.0`.)

## [v0.0.3]

### Añadido
- Predicción local de movimiento: la propia nave se mueve al instante en
  pantalla según el input, sin esperar confirmación del servidor.
  Reconciliación suave si la predicción se desvía demasiado de la
  posición confirmada por el servidor (en vez de "teletransportar" de
  golpe).
- Interpolación de jugadores remotos: se dibujan con ~100ms de retraso
  interpolando entre las dos últimas posiciones reales recibidas del
  servidor, en vez de saltar bruscamente cada vez que llega un paquete.
- Pantalla de nombre de piloto antes de entrar (ya no todos se llaman
  "Piloto" fijo).
- Indicador de ping/latencia en pantalla, medido con ping/pong real
  contra el servidor cada 2s.
- Reconexión automática si se cae la conexión inesperadamente (hasta 5
  intentos con backoff), usando el token de reconexión de Colyseus. Si
  el jugador cierra el juego a propósito (menú → "Cerrar juego"), no
  intenta reconectar.
- Aviso de "el servidor puede estar dormido" durante la conexión inicial
  si tarda más de 4s (relevante en el plan free de Render, que duerme
  tras inactividad).
- Límite visual del mundo jugable (borde dibujado en el chunk actual),
  con el servidor aplicando el límite real (clamp de posición) — el
  cliente solo lo representa.
- Dos pantallas iniciales antes de entrar al juego:
  1. Changelog scrolleable (entrada más reciente arriba) con una barra de
     estado de conexión fija (no se mueve con el scroll) y un botón
     "Continuar" siempre disponible, aunque el servidor siga
     conectando/despertando de fondo.
  2. Selección/creación de personaje (nombre), hasta 5 personajes
     guardados. Si ya hay personajes creados, se listan con opción de
     crear uno nuevo; si no hay ninguno, se pasa directo a crearlo.
  La conexión al servidor arranca en segundo plano nada más cargar la
  página (antes incluso de que el jugador termine de leer el changelog o
  elegir personaje), así se aprovecha ese tiempo para que el servidor de
  Render despierte si estaba dormido.

### Corregido
- Los jugadores conectados a la vez veían posiciones distintas entre sí y
  movimiento a saltos, por ausencia total de interpolación/predicción en
  el cliente (el sprite se limitaba a "teletransportarse" a la última
  posición recibida del servidor, sin nada entre medias).

## [v0.0.2]

### Añadido
- Control móvil: joystick virtual que aparece donde el jugador toca la
  pantalla, con zona muerta central.
- Botón fijo "MINAR" abajo a la derecha, independiente del joystick
  (soporte multitouch: un dedo mueve, otro mina a la vez).
- Número de versión visible en pantalla (arriba a la derecha) y dentro del
  menú de opciones.
- Menú de opciones (botón "☰" arriba a la izquierda) con un botón "Cerrar
  juego".
- Meta tags anticaché en `index.html` para el HTML shell.

### Corregido
- La nave no se movía visualmente en el cliente aunque el servidor sí
  actualizaba su posición. Causa: `player.onChange = () => {...}` se
  asignaba como propiedad en vez de usarse como método de suscripción
  (`player.onChange(() => {...})`), rompiendo el registro del listener de
  cambios de estado de Colyseum. Corregido.

## [v0.0.1] — Prototipo fase 0

### Añadido
- Servidor Colyseum (`server/`) con una room fija (`chunk`), sin sistema
  de descubrimiento todavía.
- Movimiento de nave sincronizado en tiempo real entre jugadores
  conectados a la misma room.
- Minado básico: asteroides fijos, extracción de recurso simple sin tipos
  todavía, inventario visible en pantalla.
- Cliente Phaser (`client/`) con cámara siguiendo a la nave del jugador.
- Despliegue: servidor en Render, cliente estático en GitHub Pages vía
  GitHub Actions.
