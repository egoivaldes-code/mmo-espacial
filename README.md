# v0.6.0 — Explosiones y escudo visual en combate

El combate deja de ser solo barras de vida y un número flotante: ahora
tiene VFX real.

## Qué cambia
- **Explosiones** al recibir daño en el casco (estructura), en 4 tamaños
  según lo fuerte del golpe (pequeña/mediana/grande/crítica), más una
  explosión grande al ser destruida.
- **Escudo visible**: un anillo brilla alrededor de la nave cada vez que
  absorbe un impacto (aparición → mantenido breve → disipación), con
  forma **circular u ovalada** según la silueta real del casco de esa
  nave — no hay tabla por nave, se calcula del sprite en tiempo de
  ejecución, así que una clase de nave nueva no requiere tocar el código
  de efectos.
- El tamaño del anillo también se ajusta al tamaño real de cada casco
  (no es un anillo fijo que se ve enorme en un caza y pequeño en un
  acorazado).

## Material y pipeline
75 frames sueltos (36 de explosión + 39 de escudo) recortados de una
hoja de referencia con arte generado por IA, con el mismo proceso que el
catálogo de torretas de v0.5.6: chroma-key sobre magenta + **despill de
color** (no solo transparencia — sin esto queda un halo rosado visible
en los bordes, sobre todo en el humo) y recorte por **detección de
contenido real**, no por rejilla fija — la hoja original no tenía todos
los frames del mismo ancho, y una rejilla equitativa los cortaba por la
mitad.

## Servidor
Los mensajes `shot` (le pego a algo) y `hit` (me pegan) ahora llevan
`shieldDamage` y `structureDamage` desglosados, no solo el daño total.
`aplicarDano()` (8.4.3) ya calculaba ese reparto internamente; solo
faltaba mandarlo. El cliente lo usa para decidir qué efecto tocar sin
tener que inferir nada de la vida restante.

## Pendiente (ver diseño 8.4.13)
- No se validó end-to-end con Playwright — el sandbox de esta sesión no
  tenía salida de red para instalar el navegador headless. Se validó con
  `vite build` limpio y comprobando que las 75 imágenes responden como
  PNG real bajo el `BASE_URL` del proyecto (no el fallback de Vite).
- El escudo no avisa (`hit`) al jugador golpeado por OTRO jugador en
  PvP, solo por NPC — hueco preexistente del servidor, no de este parche.
- Sin atlas de texturas todavía: 75 peticiones HTTP sueltas. No es
  problema ahora, pero si el catálogo de VFX crece merece la pena
  empaquetarlo.

---

Detalle técnico completo en `CHANGELOG.md` (raíz y
`client/public/CHANGELOG.md`) y en `diseno-mmo-espacial.md` (sección
8.4.13).

## Archivos de este parche
- `client/public/effects/` — 75 PNG (explosiones + escudo) +
  `effects.json` (manifest, nuevo).
- `client/src/effects.js` — carga, animaciones Phaser y disparo de
  efectos, genérico por forma/tamaño real de cada nave (nuevo).
- `client/src/main.js` — enganche de `effects.js` en `preload`/`create`
  y en los `onMessage` de `shot`/`hit`/`destroyed`; nuevo helper
  `resolveEntity()` (reutilizado también por `showDamageNumber`).
- `server/rooms/ChunkRoom.js` — `shot`/`hit` llevan ahora
  `shieldDamage`/`structureDamage`.
- `client/public/patchnotes/es.json` / `en.json` — historial del juego
  puesto al día hasta v0.6.0.
- `CHANGELOG.md` / `client/public/CHANGELOG.md` — historial técnico
  completo.
- `diseno-mmo-espacial.md` — sección 8.4.13 añadida.
