# v0.5.5 — Catálogo real de torretas + mejoras en la Naveteca

- 32 torretas recortadas (fondo transparente) de las hojas de
  referencia: cinéticas, iónicas v1, iónicas v2 y radiológicas, en
  S/M/L/C. Nueva carpeta `client/public/turrets/` (`turrets.json` +
  `sprites/`) que la Naveteca carga sola.
- "Slots de torretas": ahora también con ajuste fino por coordenadas
  x/y, y una recomendación orientativa de nº de torretas según la clase
  de la nave elegida.
- "Eje de rotación": las torretas de fábrica se pueden ocultar/mostrar y
  renombrar/reajustar el pivote localmente (overrides), sin perder el
  original; las subidas a mano siguen funcionando igual que antes.
- Probado de extremo a extremo en navegador (Playwright): carga de
  naves y torretas, simetría, asignación con vista previa girada,
  ajuste fino y ocultar/restaurar.

Ver detalle en `client/public/CHANGELOG.md` (v0.5.5) y
`diseno-mmo-espacial.md` (8.4.12, actualizada).

## Archivos de este parche
- `client/public/naveteca/index.html` — Naveteca con catálogo base + overrides.
- `client/public/turrets/turrets.json` y `client/public/turrets/sprites/*.png` — catálogo de 32 torretas.
- `client/src/main.js` — versión subida a v0.5.5.
- `client/public/CHANGELOG.md` — entrada v0.5.5.
- `diseno-mmo-espacial.md` — 8.4.12 actualizada.
