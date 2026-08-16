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
