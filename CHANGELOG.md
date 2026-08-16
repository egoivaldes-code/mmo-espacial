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

## [v0.0.7]

### Corregido
- El pellizco de zoom no funcionaba — el primer dedo se comprometía con
  el joystick de movimiento al instante, así que nunca llegaban a
  coexistir dos dedos "libres" para reconocerse como pellizco. Ahora el
  primer toque espera un margen corto (~120ms) antes de confirmar el
  joystick; si llega un segundo dedo en ese margen, el gesto se
  reinterpreta como pellizco de zoom en vez de arrancar el joystick.

## [v0.0.6]

### Añadido
- **Patch notes reales**: la pantalla 1 ya no muestra el `CHANGELOG.md`
  técnico en crudo — muestra un resumen curado para jugador por versión
  (`client/public/patchnotes/{lang}.json`), con la versión actual
  marcada. Sigue listando todas las versiones, la más reciente arriba.
- **UI anclada arriba** en la pantalla de patch notes: la barra de estado
  de conexión y el botón "Continuar" ahora están fijos arriba (antes
  abajo), siempre visibles al hacer scroll a las notas.
- **Diseño responsive**: tamaños de texto y anchos de ventana (patch
  notes, selección de personaje) escalan con `clamp()` entre móvil
  pequeño y escritorio grande, con contenedor centrado en pantallas
  anchas para no estirar el texto de lado a lado.
- **Zoom de cámara**: rueda del ratón en PC, pellizco con dos dedos en
  táctil. El HUD persistente (versión, botón de menú, menú de opciones)
  se compensa para no cambiar de tamaño con el zoom.
- **Internacionalización**: arquitectura de idiomas lista desde la base —
  todo el texto de la interfaz (HTML y Phaser) sale de diccionarios en
  `client/public/i18n/{lang}.json`, sin cadenas de texto sueltas en el
  código. Selector de idioma en el menú de opciones (guarda preferencia y
  recarga). De momento español e inglés; añadir un idioma nuevo es solo
  crear los dos archivos JSON correspondientes (i18n + patch notes) y
  sumarlo a la lista, sin tocar lógica.

## [v0.0.5]

### Añadido
- La naveteca pasa de visor a **editor**: cada nave se puede editar
  (nombre, clase, descripción, HP, velocidad, carga, tripulación) y se le
  puede sustituir el sprite (.png) o el sonido de motor (.mp3/.wav) desde
  la propia interfaz, con botón "Guardar cambios".
- Guardado en dos niveles, porque GitHub Pages es hosting estático y no
  puede escribir en el repo:
  1. **Local (instantáneo)**: se guarda en `localStorage` del navegador.
     Se refleja al momento en la naveteca y en el juego (mismo
     navegador, misma clave de almacenamiento) — recargar el juego basta
     para verlo, sin necesidad de desplegar nada.
  2. **Exportar parche**: botón que empaqueta todas las ediciones locales
     en un `.zip` (`ships.json` fusionado + sprites/sonidos sustituidos)
     listo para aplicar al repo con el flujo habitual de parches, para
     que el cambio lo vea todo el mundo, no solo quien editó.
- Indicador visual de qué naves tienen ediciones locales sin exportar
  (punto de color en la tarjeta + aviso en la ficha), botón para
  restablecer una nave a su versión original, y botón para borrar todas
  las ediciones locales del navegador.

## [v0.0.4]

### Añadido
- Naveteca: catálogo de 41 naves (Shuttle a Dreadnought) de Fiji Heavy
  Industries, generado a partir de un sprite sheet, con nombre, clase,
  estadísticas y sonido de motor placeholder por nave. Vive en
  `client/public/ships/` (sprites, sonidos, `ships.json`) y se visualiza
  en `client/public/naveteca/` — esta es la MISMA carpeta de assets que
  usa el juego para renderizar las naves, no una copia separada: cambiar
  un sprite o sonido ahí cambia lo que se ve/oye en el juego y en la
  naveteca a la vez. El juego ya usa el sprite real de la nave inicial
  (FHI Wren, `shuttle_01`) en vez del triángulo placeholder, con zumbido
  de motor que suena mientras se acelera.

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
