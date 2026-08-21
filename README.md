# v0.8.3 — Errores visibles en pantalla + fallback de renderer

**Honestidad ante todo**: no pude confirmar la causa exacta del reporte
"todo negro, joystick no responde, sin sonido, pero WARP sí funciona".
En vez de seguir adivinando a ciegas (van tres rondas seguidas de
"pantalla negra"), este parche convierte fallos silenciosos en mensajes
visibles, para que el próximo reporte venga con el error real.

## El dato clave del reporte
El botón de WARP y las barras de HP/escudo/energía son HTML normal,
completamente aparte del canvas de Phaser. Que WARP funcionara (se puso
en enfriamiento) mientras TODO lo que vive dentro del canvas (nave,
estrellas, joystick, sonido) estaba muerto apunta a que **el canvas de
Phaser nunca llegó a arrancar de verdad** — no a un problema de cámara
ni de conexión al servidor.

## Qué se añade
1. **Cualquier error de JS se ve en pantalla.** `window.onerror` y
   `unhandledrejection` fuerzan la pantalla de carga a un estado de
   error visible con el mensaje real (archivo:línea si lo hay) — antes
   un fallo así solo dejaba rastro en la consola del navegador,
   invisible en un móvil normal.
2. **Fallback a Canvas2D si WebGL falla.** El juego fuerza `Phaser.WEBGL`
   desde hace versiones (evita un bug de nitidez de Canvas2D en
   pantallas de alta densidad) — pero si el dispositivo no soporta WebGL
   de verdad, forzarlo sin más deja el juego completamente roto: pantalla
   negra, sin input, sin sonido. Exactamente el síntoma reportado.
   `launchGame()` ahora reintenta con Canvas2D si WebGL falla al crear
   el contexto — peor nitidez, pero un juego que funciona.

## Si vuelve a pasar
Con este parche, la pantalla debería decir por qué en vez de quedarse
negra sin más. Si ves el mensaje de error, mándame una captura — con eso
sí puedo arreglar la causa real en vez de teorizar.

---

Detalle técnico completo en `CHANGELOG.md` y en `diseno-mmo-espacial.md`
(sección 8.4.19).

## Archivos de este parche
- `client/index.html` — CSS del estado de error (texto largo/monoespaciado).
- `client/src/main.js` — `showFatalError()`, manejadores globales de
  error, `buildGameConfig()` + fallback WebGL→Canvas2D en `launchGame()`.
- `client/public/patchnotes/es.json` / `en.json` — historial hasta v0.8.3.
- `CHANGELOG.md` / `client/public/CHANGELOG.md` — historial técnico.
- `diseno-mmo-espacial.md` — sección 8.4.19 añadida.
