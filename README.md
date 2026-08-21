# v0.8.7 — Torretas visibles en el casco (sistema, placeholder)

Primera entrega del sistema de torretas de verdad. Alcance decidido
explícitamente: **"monta el sistema, que estén, que giren y pon
torretas placeholder, la misma en todos los slots"** — no fitting
todavía, no cambios de daño todavía.

## Qué se ve ahora
Cada nave (propia, jugadores remotos, NPCs) muestra un sprite de
torreta en cada slot calibrado en la Naveteca (v0.8.6) — la misma
torreta placeholder (`kinetic_autocanon_m`, autocañón cinético medium)
en todos los slots, sin distinguir tamaño de slot ni clase de nave, tal
como se pidió. Cada torreta gira hacia el objetivo con velocidad de giro
limitada (140°/s — no un salto instantáneo, se ve girar de verdad).

- **Tu propia nave** apunta a tu objetivo activo bloqueado (el mismo del
  HUD de combate).
- **El resto de naves** (jugadores remotos, NPCs) se quedan alineadas
  con el casco — el cliente no tiene forma de saber a quién le dispara
  cada uno sin que el servidor lo retransmita.

## Bug real encontrado y corregido de paso
El recorte de transparencia que se aplica al sprite de la nave propia al
cargarla (`trimTransparentPadding`) desplaza su centro visual respecto a
la imagen ORIGINAL sin recortar — la misma que usó la Naveteca para
calibrar los slots. Si el recorte quita más margen por un lado que por
otro (casi ningún sprite tiene padding simétrico), el centro se mueve, y
una torreta calculada sobre la imagen original habría aparecido
descuadrada sobre la nave ya recortada. La función ahora devuelve el
rectángulo real recortado en vez de descartarlo, y se compensa al
calcular la posición de cada torreta.

## Puramente visual — cero cambio de combate
El servidor sigue decidiendo acierto y daño con el arma fija de siempre
(`ARMA_MEDIUM_CORTA`), sin mirar hacia dónde apunta el dibujo de la
torreta. Mismo principio que la retícula de bloqueo o los VFX de
explosión: el disparo es matemática, no depende de dónde esté el sprite.

## Verificación
`node --check` + `eslint` (reglas `no-undef`/`block-scoped-var`, la
disciplina añadida tras el bug real de v0.8.4) + `vite build` limpio.
Sin Playwright — el cálculo de offset de recorte y de rotación está
razonado pero no visto en pantalla real.

## Pendiente (ver diseño 8.4.24)
- Fitting real: elegir qué torreta va en cada slot (sin UI todavía).
- Persistencia del loadout — bloqueada por no tener Supabase conectado.
- Que el daño salga de las torretas fijadas de verdad, no de un arma
  fija por nave (necesita stats por familia/tamaño que hoy no existen).
- Torreta según tamaño de slot y clase de nave, no la misma para todas.
- Que las torretas de otras naves también apunten a su objetivo real.

---

Detalle técnico completo en `CHANGELOG.md` y en `diseno-mmo-espacial.md`
(sección 8.4.24).

## Archivos de este parche
- `client/src/main.js` — todo el sistema: carga de catálogos, fix de
  `trimTransparentPadding`, `getTurretMounts`, `createTurretSprites`,
  `updateTurretSprites`, enganchado en creación/destrucción de
  entidades y en el bucle `update()`.
- `client/public/patchnotes/es.json` / `en.json` — historial hasta v0.8.7.
- `CHANGELOG.md` / `client/public/CHANGELOG.md` — historial técnico.
- `diseno-mmo-espacial.md` — sección 8.4.24 añadida.
