# v0.8.5 — Estelas juntas + fondos cósmicos mucho más grandes

## Estelas de motor sin separación
El espaciado lateral entre los chorros de la batería salía de una
fracción del ancho del casco (`displayWidth * 0.6`), lo que dejaba hueco
visible entre ellos — 3 llamas independientes en el crucero, no una sola
ancha. Ahora el espaciado es un valor fijo en píxeles, calibrado al
tamaño visual real de la partícula (no al tamaño de la nave), así que
los chorros contiguos quedan pegados sin importar la clase: 3 en
crucero, 4 en battlecruiser, 2 gruesas en battleship/capital — todos
igual de juntos entre sí.

## Fondos cósmicos, mucho más grandes
Escala de las nebulosas/galaxias "hero" subida de 0.5-1.1x a 2.5-6x; de
las "medium" de 0.35-0.9x a 1.1-3x. Son la capa de ambientación de
verdad — el artefacto visual de fondo, por debajo de todo lo demás — no
un detalle discreto de esquina.

## Bug de profundidad encontrado y arreglado de paso
Desde el fix de carga diferida (v0.8.1), los fondos se crean DESPUÉS de
que la propia nave (y la de cualquiera ya conectado) exista en el mundo.
Por orden de inserción a secas, eso los habría pintado ENCIMA de las
naves — justo lo contrario de "los sprites de naves/estaciones/
contenedores van encima". Ahora llevan profundidad negativa explícita
(`setDepth(-100)`), así que Phaser los ordena siempre detrás de
cualquier cosa con profundidad por defecto (0), sin depender de cuándo
se creó cada elemento.

## Verificación
`node --check` + `eslint` (reglas `no-undef`/`block-scoped-var`) +
`vite build` limpio — la disciplina añadida tras el bug real de v0.8.4.

---

Detalle técnico completo en `CHANGELOG.md` y en `diseno-mmo-espacial.md`
(sección 8.4.22).

## Archivos de este parche
- `client/src/main.js` — espaciado fijo de estelas
  (`ENGINE_TRAIL_SPACING_PX`/`_THICK_PX`), escala mayor de fondos,
  `setDepth(-100)` en `spawnBackdropsUnsafe()`.
- `client/public/patchnotes/es.json` / `en.json` — historial hasta v0.8.5.
- `CHANGELOG.md` / `client/public/CHANGELOG.md` — historial técnico.
- `diseno-mmo-espacial.md` — sección 8.4.22 añadida.
