# v0.5.6 — Quita iónica v1, limpia el halo magenta, añade térmica

- Se borran las 8 torretas "iónica v1" (arte con errores, según lo
  confirmado). Solo queda la versión buena (antes "v2"), renombrada sin
  el sufijo.
- Se reprocesaron iónicas y radiológicas con un recorte más estricto
  (umbral de color más alto + erosión de borde) para quitar el halo
  magenta residual que quedaba del fondo chroma-key.
- Se añaden las 8 torretas térmicas (Cañón de Plasma / Láser, S/M/L/C)
  recortadas igual de limpias desde el principio.
- Catálogo final: 32 torretas, 4 familias completas (cinética, iónica,
  radiológica, térmica).

Ver detalle en `client/public/CHANGELOG.md` (v0.5.6) y
`diseno-mmo-espacial.md` (8.4.12, actualizada).

## Archivos de este parche
- `client/public/turrets/turrets.json` — catálogo actualizado (32 torretas).
- `client/public/turrets/sprites/ionico_v2_*.png` — iónicas limpias.
- `client/public/turrets/sprites/radiologico_*.png` — radiológicas limpias (reemplazo).
- `client/public/turrets/sprites/thermal_*.png` — térmicas nuevas.
- `client/src/main.js` — versión subida a v0.5.6.
- `client/public/CHANGELOG.md` — entrada v0.5.6.
- `diseno-mmo-espacial.md` — 8.4.12 actualizada.

El PATCH.json de este zip también borra los 8 archivos de la iónica v1
inválida (`client/public/turrets/sprites/ionico_v1_*.png`).
