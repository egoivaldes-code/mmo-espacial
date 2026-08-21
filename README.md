# v0.8.6 — Catálogo de slots de torretas (datos)

Parche de **datos puro** — cero cambios de código. Entregado desde la
Naveteca (pestañas "Slots de torretas" / "Eje de rotación").

## Qué trae
- **`client/public/turrets/turrets.json`** (sustituido entero): mismas
  32 torretas de siempre, 21 con el pivote (centro de rotación)
  recalibrado.
- **`client/public/ships/turret-slots.json`** (nuevo, junto a
  `ships.json`): slots de torreta para 35 de las 41 naves del catálogo
  — posición, grupo de simetría, torreta asignada por defecto. Las 6
  shuttles se quedan sin entrada a propósito (naves utilitarias, sin
  combate). 194 slots en total.
- Sin torretas nuevas esta vez (`turrets/sprites/` venía vacío en el
  zip), así que no hay PNG que copiar.

## Validado antes de aplicar
- Sin ids de torreta duplicados, todos los campos requeridos presentes.
- Los 32 pivotes caen dentro del propio tamaño de su sprite.
- Los 35 `spriteSize` declarados coinciden EXACTOS con las dimensiones
  reales del PNG en disco de cada nave.
- Ningún `turretId` asignado apunta a una torreta inexistente.
- Ningún id de slot duplicado dentro de la misma nave.
- Ningún slot cae fuera del área del sprite.
- Ningún grupo de simetría (`mirrorGroup`) con un solo miembro suelto.

## Importante: esto es preparación, no una función jugable todavía
Ni `turrets.json` ni `turretId` ni `pivot` se leen hoy en `main.js` ni
en `ChunkRoom.js` — el combate en el juego real sigue siendo un único
arma fija (`ARMA_MEDIUM_CORTA`), sin ninguna torreta visible sobre el
casco. Lo único que usa estos archivos ahora mismo es la propia
Naveteca. Construir el sistema de verdad — fitting real, render de
torretas sobre cada slot con su pivote, disparo por torreta en vez de
un arma fija por nave — sigue pendiente y sería su propio parche, bastante
más grande. Este solo deja los datos calibrados y validados, listos
para cuando se aborde.

---

Detalle técnico completo en `CHANGELOG.md` y en `diseno-mmo-espacial.md`
(sección 8.4.23).

## Archivos de este parche
- `client/public/turrets/turrets.json` — sustituido.
- `client/public/ships/turret-slots.json` — nuevo.
- `client/src/main.js` — solo el número de versión (`GAME_VERSION`).
- `client/public/patchnotes/es.json` / `en.json` — historial hasta v0.8.6.
- `CHANGELOG.md` / `client/public/CHANGELOG.md` — historial técnico.
- `diseno-mmo-espacial.md` — sección 8.4.23 añadida.
