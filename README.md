# v0.8.4 — Bug crítico real encontrado y arreglado

La instrumentación de v0.8.3 funcionó a la primera: llegó una captura
con el error exacto. Aquí está la causa real, por fin confirmada.

## Bug 1: `ReferenceError: box is not defined` (el de la pantalla negra)
En `updateOffscreenMarkers()` (el rediseño de marcadores de contacto,
v0.7.0), dos variables (`box`, `dot`) se declaraban con `const` dentro
de un bloque `if`, pero se usaban después, fuera de ese bloque, en la
misma función. En JavaScript eso es un `ReferenceError` en tiempo de
ejecución — sintaxis perfectamente válida, así que `node --check` nunca
lo iba a detectar.

Como esa función corre en cada frame desde `update()`, el error cortaba
en seco todo lo que viene después cada vez que había un NPC o jugador
cerca necesitando un marcador — que es casi siempre. Joystick, sonido,
movimiento: todo lo que vive después en el bucle, muerto. El HUD (HTML
aparte, nada que ver con el bucle de Phaser) seguía funcionando con
normalidad, incluido el botón de WARP — que fue justo el dato que
apuntó en la dirección correcta cuando lo describiste.

**Bug real desde v0.7.0** (el rediseño de marcadores). Llevaba activo
varias versiones.

## Bug 2: los fondos cósmicos nunca aparecían
Para buscar más bugs de la misma familia, pasé `eslint` (reglas
`no-undef` y `block-scoped-var`) sobre todo el código — algo que no
había hecho hasta ahora, solo verificaba sintaxis. Apareció un segundo
caso real: en `spawnBackdropsUnsafe()`, la línea que inicializa el
generador aleatorio determinista se perdió sin querer durante el
refactor de carga diferida de v0.8.1 (una edición de texto sustituyó esa
línea junto con la firma de la función).

Con la variable sin definir, la función fallaba en su primer uso real —
pero como está envuelta a propósito en un try/catch (para que un fallo
de decoración pura no pueda tirar nada más), el error quedaba atrapado y
solo visible en la consola. Resultado: **las 63 nebulosas/galaxias de
fondo llevaban desde v0.8.1 sin aparecer nunca**, en ninguna sesión, sin
generar ningún reporte porque el juego seguía "funcionando" — solo que
sin esa parte.

## Lección de proceso
`node --check` valida sintaxis, no lógica de scope en tiempo de
ejecución. A partir de ahora, antes de dar por bueno un parche que toque
`client/src/main.js`, se pasa además:
```
eslint -c <config mínima con no-undef + block-scoped-var> main.js
```
Esto habría pillado los dos bugs de este parche ANTES de publicarse.

---

Detalle técnico completo en `CHANGELOG.md` y en `diseno-mmo-espacial.md`
(secciones 8.4.20 y 8.4.21).

## Archivos de este parche
- `client/src/main.js` — los dos fixes (`updateOffscreenMarkers`,
  `spawnBackdropsUnsafe`).
- `client/public/patchnotes/es.json` / `en.json` — historial hasta v0.8.4.
- `CHANGELOG.md` / `client/public/CHANGELOG.md` — historial técnico.
- `diseno-mmo-espacial.md` — secciones 8.4.20 y 8.4.21 añadidas.
