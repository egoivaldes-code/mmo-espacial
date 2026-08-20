# v0.8.0 — PvP de pruebas + decoración de fondo cósmico

## PvP de pruebas
Cualquier otro jugador es tocable/fijable igual que un NPC. El servidor
ya calculaba el daño correctamente en la rama `player` de
`dispararCiclo` desde antes (era genérico por diseño), pero nunca
avisaba a la víctima — ahora recibe `hit` con el mismo formato que un
golpe de NPC, así que el HUD, la vida estimada de las tarjetas de
objetivo y los VFX de escudo/explosión funcionan sin ninguna rama
especial para PvP. Auto-fijado de vuelta también funciona si te dispara
otro jugador (respeta la preferencia, como con los NPC).

**Deliberadamente solo el mecanismo**: sin balance, sin recompensa ni
penalización por matar a otro jugador — es para poder testear combate
real entre jugadores, no un sistema de PvP terminado (sigue pendiente en
diseño 8.4.11: zona segura, CONCORD, etc.).

## Decoración de fondo cósmico
63 nebulosas/galaxias recortadas de dos hojas de referencia de ~160
objetos cada una (mismo pipeline de despill de color que las torretas y
el VFX de combate — chroma-key + recorte por detección de contenido
real, no rejilla fija) dispersas por todo el mundo.

- **Determinista por semilla fija** (mulberry32), no aleatorio de
  verdad: todos los clientes ven el mismo universo en las mismas
  posiciones sin que el servidor mande ni una coordenada — mismo
  principio que ya usan CONCORD y los chunks.
- 22 nebulosas grandes dispersas ralas + 130 instancias medianas
  (reutilizando 56 texturas con distinta posición/rotación/escala cada
  vez — variedad sin cargar cientos de imágenes).
- Capa de ambientación por debajo de estación/naves, con parallax
  (scrollFactor reducido) y mezcla aditiva + alpha bajo para que se lea
  como resplandor de fondo sin competir con el gameplay.
- Imágenes "hero" reescaladas a 700px máx (pesaban ~2.4MB cada una a
  resolución completa) — el set completo curado pesa ~4.7MB.

## Pendiente (ver diseño 8.4.15 y 8.4.16)
- Sin balance de PvP: solo el mecanismo de targetear/atacar/matar.
- El tinte naranja fijo sobre otros jugadores sigue ahí (mismo argumento
  que ya se aplicó a los NPC en v0.7.0 — identificar por marcador, no
  por teñir el sprite entero — pendiente si el PvP deja de ser solo de
  pruebas).
- Blend ADD aplicado por igual a las 63 texturas de fondo, incluidas las
  que parecen planetas — vale para decoración de fondo, no para
  representar un planeta real de un sistema más adelante.
- No se validó con Playwright — misma limitación de red del sandbox de
  las últimas sesiones.

---

Detalle técnico completo en `CHANGELOG.md` (raíz y
`client/public/CHANGELOG.md`) y en `diseno-mmo-espacial.md` (8.4.15 y
8.4.16).

## Archivos de este parche
- `client/src/main.js` — PvP (combatTarget en jugadores, HUD/health
  genérico) + sistema de decoración de fondo (`BACKDROP_FILES`,
  `spawnBackdrops()`, mulberry32).
- `client/public/backdrops/` — 63 PNG + `backdrops.json` (manifest de
  referencia, no lo lee el juego en tiempo de ejecución).
- `server/rooms/ChunkRoom.js` — `hit` a la víctima en PvP,
  `intentarAutoTargetBack` generalizado por `kind`.
- `client/public/patchnotes/es.json` / `en.json` — historial del juego
  puesto al día hasta v0.8.0.
- `CHANGELOG.md` / `client/public/CHANGELOG.md` — historial técnico
  completo.
- `diseno-mmo-espacial.md` — secciones 8.4.15 y 8.4.16 añadidas, 8.4.14
  actualizada.
