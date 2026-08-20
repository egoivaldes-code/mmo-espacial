# v0.5.9 + fix de patch notes — auditoría, físicas reales, y el historial que se veía en el juego estaba congelado en v0.5.3

## v0.5.9 — auditoría completa del proyecto
- **Bug real corregido**: la orientación de la nave (`facing`) se guardaba
  mal — se guardaba un campo que solo se ponía una vez al cargar la
  partida y nunca se volvía a tocar, así que cada personaje reaparecía
  mirando hacia donde miraba dos sesiones atrás, no hacia donde se dejó
  de verdad.
- **Rendimiento**: cuatro búsquedas de cliente que recorrían la lista
  completa de conectados (`this.clients.find(...)`) pasan a un `Map`
  sessionId → Client, O(1) en vez de O(jugadores conectados).
- **Estrellas de fondo** ya no cambian de tamaño en pantalla al hacer
  zoom (antes casi desaparecían con zoom out extremo).
- **Triángulo de referencia** para la propia nave: con la cámara muy
  alejada (más del 50% del recorrido de zoom, en escala logarítmica) el
  sprite se sustituye por un triángulo fijo en el centro de la pantalla
  que señala el rumbo real.
- El **botón de opciones** se muda de junto a los botones de combate a
  la esquina superior derecha.
- Documentado en `diseno-mmo-espacial.md` (14.4) todo lo que la
  auditoría encontró y **no** se tocó todavía (sala única sin sharding,
  sin área de interés, IA de NPCs O(NPCs×jugadores), minado a 20Hz,
  sin límite de mensajes/conexiones) — con el motivo de por qué se
  pospuso cada cosa, para no tener que redescubrirlo.

## v0.5.8 — hotfix de un crash real en producción
Encontrado revisando logs de Render tras un aviso de caída con jugadores
dentro: al destruir tu propio (y único) objetivo fijado de un disparo, el
código seguía leyendo `cs.activeTarget.kind/.id` después de que
`destruirNpc()` ya se lo hubiera puesto a `null` — tumbaba el proceso
Node.js **entero**, no solo ese disparo. Corregido capturando el
objetivo en variables locales antes de la llamada que puede vaciarlo.

## v0.5.7 — físicas reales por clase, joystick 360°, piloto crucero, auto-fijado
- El crucero giraba y aceleraba con las constantes pensadas para la
  lanzadera inicial. Corregido con un catálogo de físicas por clase
  basado en masa real (`server/data/shipStats.js`) — empuje/par fijos
  por clase, giro y aceleración salen de dividir eso entre la masa de
  cada nave.
- Movimiento en 360° reales (antes cuantizado a 8 direcciones): el
  joystick manda ángulo + magnitud, no 4 booleans. Tocar suave solo
  pivota; empujar de verdad acelera, de forma progresiva.
- **Piloto crucero**: gesto de tocar-arrastrar-soltar-y-volver-a-tocar-
  sin-arrastrar deja la nave viajando sola a la última velocidad/rumbo.
- Marcadores de referencia (punto de tamaño fijo en pantalla) para naves
  y objetivos fijados fuera de vista o demasiado lejos de zoom para
  leerse.
- **Auto-fijado de quien te ataca**: si un NPC te elige como objetivo, te
  lo fija automáticamente de vuelta. Activado por defecto, desactivable
  en opciones.

## Fix de patch notes (sin número de versión propio)
El historial que lee el propio juego en la pantalla de inicio
(`client/public/patchnotes/es.json` / `en.json`) es un archivo **distinto**
de `CHANGELOG.md` — y se había quedado congelado en v0.5.3 desde entonces:
nunca se tocó en los parches de v0.5.4 a v0.5.9. Puestas al día las 6
entradas que faltaban, en ambos idiomas, en tono para jugador (no
técnico).

---

Detalle técnico completo de cada versión en `CHANGELOG.md` (raíz y
`client/public/CHANGELOG.md`) y en `diseno-mmo-espacial.md`.

## Archivos de este parche
- `server/rooms/ChunkRoom.js` — físicas por clase, joystick 360°,
  piloto crucero, auto-fijado, fix del crash, fix de `facing`, Map de
  clientes.
- `server/data/shipStats.js` — catálogo de físicas por clase (nuevo).
- `server/schema/Player.js` — campo `cruising` replicado.
- `client/src/main.js` — todo lo anterior reflejado en cliente
  (predicción local sincronizada), estrellas a tamaño constante,
  triángulo de referencia propio.
- `client/index.html` — checkbox de auto-fijado, botón de opciones
  reubicado.
- `client/public/i18n/es.json` / `en.json` — traducciones nuevas.
- `client/public/patchnotes/es.json` / `en.json` — historial del juego
  puesto al día hasta v0.5.9.
- `CHANGELOG.md` / `client/public/CHANGELOG.md` — historial técnico
  completo.
- `diseno-mmo-espacial.md` — secciones 8.4.6.1, 8.4.10.3-.5, 14.4,
  15.4.2-.4 actualizadas/añadidas.
