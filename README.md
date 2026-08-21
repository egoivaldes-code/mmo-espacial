# v0.8.9 — Color de la torreta ajustado al casco

Feedback jugando tras v0.8.8 (escala ya arreglada): el amarillo saturado
de la torreta placeholder desentonaba con la iluminación mucho más
neutra/gris del casco — se veía "pegada encima", no montada.

## Proceso
En vez de ajustar a ciegas, se generó una composición fiel (mismos
sprites reales, misma fórmula de posición/escala del código) con 4
tratamientos de color lado a lado — original, desaturado, gris metal, y
tintado hacia el color medio del casco — y se enseñó como imagen antes
de tocar nada. Se eligió **desaturado**.

## Implementación
El PNG oficial del catálogo (`turrets.json`, el que en su día usará una
UI de fitting para mostrar el arma tal cual es) **no se toca**. Se
generó una variante nueva, `kinetic_autocanon_m_ingame.png`, usada SOLO
para el montaje visible en el casco. La metadata (tamaño, pivote) se
sigue leyendo de la entrada real de `turrets.json` — el tratamiento de
color no cambia las dimensiones del sprite, así que no hace falta
duplicar nada más.

## Nota para el futuro (dejada en diseño 8.4.26)
El amarillo no es un capricho de arte — es el color de daño CINÉTICO en
el esquema de combate (cinético=amarillo, térmico=rojo,
radiológico=verde, iónico=azul). Desaturar esta única torreta
placeholder no rompe nada ahora mismo (solo hay un tipo en pantalla),
pero cuando existan varias familias de torreta montadas a la vez, la
desaturación tendrá que revisarse para no perder esa codificación de
color que el propio diseño necesita para leerse de un vistazo.

## Verificación
`node --check` + `eslint` (no-undef/block-scoped-var) + `vite build`
limpio.

---

Detalle técnico en `CHANGELOG.md` y en `diseno-mmo-espacial.md`
(sección 8.4.26).

## Archivos de este parche
- `client/public/turrets/sprites/kinetic_autocanon_m_ingame.png` — nuevo.
- `client/src/main.js` — `TURRET_INGAME_SPRITE_FILE`, usada en `preload()`.
- `client/public/patchnotes/es.json` / `en.json` — historial hasta v0.8.9.
- `CHANGELOG.md` / `client/public/CHANGELOG.md` — historial técnico.
- `diseno-mmo-espacial.md` — sección 8.4.26 añadida.
