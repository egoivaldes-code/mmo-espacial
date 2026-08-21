# v0.8.8 — Arregla las torretas gigantes (bug cómico)

Reportado con captura y bastante humor: cada torreta salía prácticamente
del tamaño de la nave que la llevaba montada.

## Causa
`updateTurretSprites` aplicaba a la torreta la MISMA escala que al
casco — razonable para la posición del montaje (el hueco en el casco sí
escala con la nave), pero no para el tamaño del propio dibujo de la
torreta. `kinetic_autocanon_m` mide 110×176px nativos, casi idéntico al
sprite de la nave (101×175px) — a la misma escala, salían literalmente
del mismo tamaño.

## El fix
El arte de `turrets.json` está pensado a un tamaño tipo "icono/ficha de
fitting", no a la escala real relativa al casco donde se monta — hace
falta encogerlo aparte. Nueva constante `TURRET_RELATIVE_SCALE = 0.15`,
aplicada SOLO al tamaño del sprite de la torreta, dejando intacto el
cálculo de posición del montaje. Deja la torreta en ~15% de la altura
del casco.

**Nota**: es un valor de partida razonado, no medido en pantalla real
(sin Playwright). Si al verlo sigue quedando grande/pequeña, dímelo y lo
ajusto — el número vive aislado en una única constante, fácil de tocar.

---

Detalle técnico en `CHANGELOG.md` y en `diseno-mmo-espacial.md`
(sección 8.4.25).

## Archivos de este parche
- `client/src/main.js` — `TURRET_RELATIVE_SCALE`, aplicada en
  `updateTurretSprites`.
- `client/public/patchnotes/es.json` / `en.json` — historial hasta v0.8.8.
- `CHANGELOG.md` / `client/public/CHANGELOG.md` — historial técnico.
- `diseno-mmo-espacial.md` — sección 8.4.25 añadida.
