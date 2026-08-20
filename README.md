# v0.8.1 — Arregla el bug de pantalla negra / no conecta

**Bug crítico de v0.8.0, ya corregido.** Reporte real jugando en móvil:
"le ha costado conectar al server, al entrar se ve todo negro y no pasa
nada".

## Qué pasaba
Los 63 PNG de decoración de fondo (v0.8.0) se cargaron en el `preload()`
de Phaser, que es **bloqueante**: nada de lo que viene después en
`create()` arranca hasta que el loader entero termina — ni la creación
de la nave, ni la conexión real al servidor (`connectToServer()`). El
loader de Phaser no tiene timeout por defecto, así que una sola petición
que se quedara colgada (dato móvil flojo, no hacía falta que fallase,
bastaba con que no contestara) dejaba el juego entero esperando para
siempre. Con 63 peticiones nuevas de golpe, la probabilidad de que
alguna se atascara subió mucho — de ahí que se notara justo en v0.8.0.

## El fix, dos partes
1. **Timeout global del loader** (15s) en la config de `Phaser.Game` —
   protege cualquier carga futura, no solo esta.
2. **Los fondos se cargan en una segunda pasada, después de conectar.**
   `loadBackdropsDeferred()` se lanza solo tras
   `await this.connectToServer()`, con el jugador ya dentro viendo su
   nave. Si esa carga tarda, falla o se cuelga, ya no bloquea nada — las
   nebulosas simplemente aparecen tarde (o no aparecen). `spawnBackdrops()`
   además queda en try/catch: es decoración pura, no debe poder tirar
   nada más si algo sale mal.

## Principio para el futuro
Cualquier asset que no sea imprescindible para entrar a la partida y ver
la nave (decoración, catálogos opcionales) debería cargarse DESPUÉS de
conectar, no en el `preload()` inicial. `effects.js` (VFX de
explosión/escudo) todavía carga sus 75 imágenes en el preload original —
funciona porque el timeout global ya evita el cuelgue infinito, pero es
buen candidato para el mismo tratamiento si el catálogo de VFX sigue
creciendo.

---

Detalle técnico completo en `CHANGELOG.md` y en `diseno-mmo-espacial.md`
(8.4.16 actualizada con el aviso del bug, 8.4.17 nueva con el fix).

## Archivos de este parche
- `client/src/main.js` — timeout del loader, `loadBackdropsDeferred()`,
  `spawnBackdrops()` con try/catch.
- `client/public/patchnotes/es.json` / `en.json` — historial hasta v0.8.1.
- `CHANGELOG.md` / `client/public/CHANGELOG.md` — historial técnico.
- `diseno-mmo-espacial.md` — 8.4.16 actualizada, 8.4.17 nueva.
