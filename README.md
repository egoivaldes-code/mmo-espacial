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

## Textos de la interfaz (i18n) y patch notes

- `client/public/i18n/{lang}.json` — todos los textos de la interfaz
  (HTML y Phaser). Añadir un idioma: crear el JSON correspondiente y
  sumarlo a `AVAILABLE_LANGUAGES` en `client/src/main.js`.
- `client/public/patchnotes/{lang}.json` — resumen curado para jugador,
  por versión, que se muestra en la pantalla de inicio del juego. Es
  distinto del `CHANGELOG.md` de la raíz del repo (ese es técnico, para
  desarrollo — ya no se muestra dentro del juego).

## Cómo se aplican los cambios (flujo de parches)

El desarrollo va por parches en `.zip`, no por PRs manuales. El propio
repo tiene un workflow que los aplica solo:

**`.github/workflows/apply-patch.yml`** — se dispara automáticamente al
subir un archivo `spacemmo_*.zip` (o `patches/*.zip`) a la raíz de
`main`. Descomprime el zip, crea los archivos nuevos, sobreescribe por
completo los que ya existan, borra el zip, hace commit y push. Si el
cambio toca `client/`, dispara también `deploy-pages.yml` (necesario
porque los pushes hechos con el token automático de Actions no disparan
otros workflows por su cuenta — GitHub lo bloquea a propósito para evitar
bucles).

**Flujo de trabajo:**
1. Se genera un `spacemmo_vX.Y.Z.zip` con los archivos del parche, en sus
   rutas reales dentro del repo (p. ej. `client/src/main.js`,
   `server/rooms/ChunkRoom.js`).
2. El zip incluye un `README.md` en la raíz — son instrucciones para
   humanos, el workflow lo ignora y nunca lo copia sobre el `README.md`
   real del repo.
3. Se sube ese único zip a la raíz de `main` (arrastrando el archivo
   desde el móvil o el ordenador, sin necesidad de git ni terminal).
4. El workflow hace el resto solo. Se puede ver el resultado en la
   pestaña *Actions*.

**Metadatos opcionales dentro del zip** (no se copian al repo, el
workflow los lee y actúa según lo que digan):
- `DELETE.txt` — una ruta por línea, de archivos/carpetas a borrar del
  repo (útil para retirar código obsoleto de un parche anterior).
- `PATCH.json` — control fino: `{"commit_message": "...", "delete": [...], "ignore": [...], "copy_readme": false}`.

**Convención para que el mensaje de commit se deduzca solo:** el primer
encabezado del `README.md` del zip debe seguir el formato
`# spacemmo_vX.Y.Z.zip — Título breve` — el workflow saca la versión del
nombre del propio zip y el título de ese encabezado.

**Requisito de configuración (una sola vez):** en *Settings → Actions →
General → Workflow permissions* del repo tiene que estar activado "Read
and write permissions", si no el workflow no podrá hacer `git push`.

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
