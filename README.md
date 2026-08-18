# v0.5.4 — Herramienta de hardpoints en la Naveteca

Añade dos pestañas nuevas a la Naveteca (`client/public/naveteca/`):
"Slots de torretas" (colocar los huecos de armas sobre cada nave, con
simetría en X y/o Y) y "Eje de rotación (torretas)" (marcar el punto de
giro de cada modelo de torreta). Exportan `turret-slots.json` y
`turrets.json` + imágenes desde un botón dedicado dentro de la propia
herramienta — este parche no incluye esos archivos todavía, solo la
herramienta para generarlos.

Ver detalle completo en `client/public/CHANGELOG.md` (v0.5.4) y
`diseno-mmo-espacial.md` (8.4.12).

## Archivos de este parche
- `client/public/naveteca/index.html` — Naveteca con las dos pestañas nuevas.
- `client/src/main.js` — versión subida a v0.5.4.
- `client/public/CHANGELOG.md` — entrada v0.5.4 añadida.
- `diseno-mmo-espacial.md` — nueva sección 8.4.12.
