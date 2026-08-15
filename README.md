# Prototipo — Fase 0

Movimiento de nave sincronizado, minado básico. Un solo chunk fijo, sin
descubrimiento, sin CONCORD todavía. Ver el documento de diseño completo
(`diseno-mmo-espacial.md`) para el contexto.

## Estructura

```
server/   → Colyseum (Node.js). Define la room "chunk", el estado
            sincronizado (jugadores, asteroides) y la simulación.
client/   → Phaser + colyseus.js. Se conecta a la room, dibuja naves y
            asteroides, envía input de teclado.
```

## Cómo desplegarlo (Render + GitHub Pages)

GitHub Pages solo sirve contenido estático — no puede correr el servidor
Colyseum (necesita un proceso Node.js persistente con websockets). Por eso
el servidor va en Render y solo el cliente en Pages.

1. **Servidor en Render**: sube `server/` a tu repo de GitHub. En Render,
   crea un *Web Service* apuntando a ese repo/carpeta:
   - Build command: `npm install`
   - Start command: `npm start`
   Render te da una URL tipo `https://tu-servicio.onrender.com` — la
   versión websocket es `wss://tu-servicio.onrender.com` (con `wss`, no
   `ws`, porque Render sirve por HTTPS). El plan free se "duerme" tras
   inactividad y tarda unos segundos en despertar; para algo más estable,
   plan de pago.
2. **Cliente en GitHub Pages**: sube `client/` a tu repo. Define la
   variable de entorno `VITE_SERVER_URL=wss://tu-servicio.onrender.com` en
   el workflow de build (GitHub Actions) o en un `.env.production` local
   antes de `npm run build`. El build de Vite genera `dist/`, que es lo que
   se publica en Pages.
3. Abre el cliente en dos pestañas/dispositivos distintos — deberías ver
   ambas naves moviéndose en tiempo real y poder minar los asteroides
   (tecla **espacio** cerca de uno, moverte con **WASD**).

## Cómo correrlo en local (alternativa)

```bash
cd server && npm install && npm start
# en otra terminal
cd client && npm install && npm run dev
```

Con `SERVER_URL = "ws://localhost:2567"` (ya viene así por defecto).

## Qué NO está aún (a propósito, es fase 0)

Ver sección 13 del documento de diseño: sin sistema de chunks dinámico,
sin CONCORD, sin crafteo real, sin modo a pie, sin pérdida de nave al
morir. Se va añadiendo iterativamente.
