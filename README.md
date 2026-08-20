# v0.7.0 — HUD de combate: contactos, objetivos múltiples, estelas por clase

**Importante:** el zip anterior (`spacemmo_v0.6.0.zip`, explosiones y
escudo) no se llegó a subir — el repo seguía en v0.5.12 al empezar esta
sesión. Este parche es **acumulativo**: incluye v0.6.0 entero además de
todo lo de abajo. No subas el zip viejo, con este solo basta.

## Qué cambia

**Marcadores de contacto**, a partir de feedback jugando en móvil real:
- Fuera el velo naranja permanente sobre los NPC.
- El punto de contacto se mantiene, pero ahora va dentro de una caja de
  targeting (4 esquinas), **roja si es hostil de verdad** (NPC — no hay
  bandera de hostilidad entre jugadores todavía), **blanca** si no.
- Bug real corregido: la retícula de bloqueo no compensaba el zoom de
  cámara — con zoom out se encogía hasta desaparecer antes de que
  saltara el marcador de "demasiado lejos", así que el objetivo fijado
  parecía esfumarse en una franja intermedia de zoom.

**Estelas de motor en batería por clase real** (no una tabla por
modelo — sale de `ships.json`): 1 para shuttle/frigate, 2 para
destroyer, 3 para cruiser, 4 para battlecruiser, 2 gruesas y separadas
para battleship/carrier/dreadnought. Auto-ajustadas al tamaño real de
cada sprite, en fila horizontal paralela.

**Triángulo de referencia propio** (sustituye al sprite en zoom out
extremo) tarda más en aparecer — antes tapaba la propia nave en
acercamientos normales.

**Autodisparo, arreglado de verdad**: vivía dentro del contenedor que se
oculta entero sin objetivo bloqueado, así que se volvía intocable la
mayor parte del tiempo aunque su estado nunca se perdiera en el
servidor. Ahora es independiente y solo se oculta sin ningún objetivo
fijado en absoluto.

**HUD de objetivos múltiples**: el servidor ya soportaba varios
objetivos fijados a la vez — lo que faltaba era VERLOS. Subido de 3 a 4
objetivos, cuadrícula de 2 columnas bajo las barras de estado (1-2
arriba, 3-4 debajo), tarjeta propia por objetivo con nombre, vida y
borde de color según fijándose/bloqueado/con el arma apuntada. Tocar una
tarjeta la desfija.

## Pendiente (ver diseño 8.4.13 y 8.4.14)
- Límite de objetivos por clase de casco, no un número plano para todos.
- Sin PvP: solo los NPC son tocables/fijables.
- No se validó con Playwright — el sandbox de esta sesión no tenía
  salida de red para el navegador headless. Validado con `vite build`
  limpio y revisión manual de cada bloque de código.

---

Detalle técnico completo en `CHANGELOG.md` (raíz y
`client/public/CHANGELOG.md`) y en `diseno-mmo-espacial.md` (8.4.13 y
8.4.14).

## Archivos de este parche
- `client/public/effects/` + `effects.json` — de v0.6.0, incluido aquí
  porque no se había subido todavía.
- `client/src/effects.js` — ídem, VFX de explosiones/escudo.
- `client/src/main.js` — VFX de v0.6.0 + todo el HUD de combate de
  v0.7.0 (marcadores, estelas, triángulo, autodisparo, cuadrícula de
  objetivos).
- `client/index.html` — CSS/HTML nuevo: `#combat-hud-left`,
  `#target-grid` (4 tarjetas), `#autoshoot-row` independiente.
- `server/rooms/ChunkRoom.js` — `shieldDamage`/`structureDamage` en
  `shot`/`hit` (v0.6.0) + `MAX_TARGETS` 3→4 (v0.7.0).
- `client/public/patchnotes/es.json` / `en.json` — historial del juego
  puesto al día hasta v0.7.0.
- `CHANGELOG.md` / `client/public/CHANGELOG.md` — historial técnico
  completo.
- `diseno-mmo-espacial.md` — secciones 8.4.11 (actualizada), 8.4.13 y
  8.4.14 (nuevas).
