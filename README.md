# v0.8.2 — Pantalla de carga con progreso real

Motivado directamente por la confusión del bug de v0.8.0/v0.8.1: hasta
ahora, entre elegir personaje y ver la propia nave, la pantalla se
quedaba negra sin ningún aviso. Un preload lento y un juego realmente
colgado se veían exactamente igual.

## Qué cambia
- **Pantalla de carga** (`#game-loading-overlay`) con tres fases:
  1. **Cargando recursos** — barra de progreso enganchada al evento
     `progress` real del loader de Phaser (no una animación decorativa).
  2. **Conectando con el servidor** — la barra se oculta (ya no hay un %
     real que enseñar) y el texto lo deja claro.
  3. **Error** — si falla la unión a la sala, mensaje real + botón de
     reintentar, bien visible. Antes ese error solo se veía en una línea
     pequeña arriba a la izquierda, fácil de no ver.
- Se oculta en el momento correcto: cuando la propia nave ya tiene
  posición real confirmada (`this.localEntry` asignado dentro del
  `player.onAdd`), no justo tras el `await connectToServer()` (menos
  fiable — el primer parche de estado podría llegar un instante
  después).

## Nota sobre versiones
Al empezar esta sesión, v0.8.1 (el fix del bug de pantalla negra)
todavía no estaba subido — se subió a mitad de la sesión. Esta build
parte ya de v0.8.1 real, así que **no es acumulativa** de nada que no
esté ya aplicado; solo añade la pantalla de carga.

---

Detalle técnico completo en `CHANGELOG.md` y en `diseno-mmo-espacial.md`
(sección 8.4.18).

## Archivos de este parche
- `client/index.html` — CSS/HTML del overlay de carga.
- `client/src/main.js` — lógica del overlay (mostrar/progreso/conectando/
  error/ocultar), enganchada a `preload()`, `connectToServer()` y la
  confirmación de la nave propia.
- `client/public/i18n/es.json` / `en.json` — claves nuevas bajo `loading`.
- `client/public/patchnotes/es.json` / `en.json` — historial hasta v0.8.2.
- `CHANGELOG.md` / `client/public/CHANGELOG.md` — historial técnico.
- `diseno-mmo-espacial.md` — sección 8.4.18 añadida.
