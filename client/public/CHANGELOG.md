# Changelog

Registro de cambios del prototipo. Ver `diseno-mmo-espacial.md` para el
documento de diseño completo y el roadmap.

## Política de versionado

- **v0.0.X** — parches pequeños: fixes, ajustes de UI, mejoras puntuales
  de una mecánica existente. No cambian el alcance del juego.
- **v0.X** — parches gordos: una pieza nueva de gameplay o infraestructura
  (p. ej. sistema de chunks dinámico, crafteo real, modo a pie, CONCORD).
  Cuando se añade uno de estos, el contador de parches pequeños (`.X`)
  vuelve a 0.
- (Más adelante, cuando el juego tenga forma jugable completa según el
  documento de diseño, se planteará qué significa `v1.0`.)

## [v0.8.5]

### Añadido/Arreglado — estelas juntas + fondos cósmicos mucho más grandes
- **Estelas de motor sin separación**: el espaciado lateral salía de una
  fracción del ancho del casco, dejando hueco visible entre los 3
  chorros del crucero. Ahora es un valor fijo calibrado al tamaño real
  de la partícula — los chorros contiguos quedan pegados, formando una
  sola llama ancha en vez de varias independientes, para cualquier clase
  de nave (3 en crucero, 4 en battlecruiser, etc.).
- **Fondos cósmicos mucho más grandes**: escala de las "hero" subida de
  0.5-1.1x a 2.5-6x; de las "medium" de 0.35-0.9x a 1.1-3x. Son la capa
  de ambientación de verdad, por debajo de todo lo demás.
- **Bug de profundidad encontrado y arreglado de paso**: desde el fix de
  carga diferida (v0.8.1), los fondos se crean después de que la propia
  nave ya existe — por orden de inserción, se habrían pintado ENCIMA de
  las naves. Ahora llevan profundidad negativa explícita, siempre detrás
  de cualquier cosa (naves, estaciones, contenedores) sin depender de
  cuándo se creó cada elemento.
- Verificado con `node --check` + `eslint` (no-undef/block-scoped-var) +
  `vite build` limpio — la disciplina de verificación añadida tras el
  bug de v0.8.4.
- Ver diseño 8.4.22 para el detalle completo.

## [v0.8.4]

### Arreglado — bug crítico real: pantalla negra confirmada (ReferenceError) + fondos que nunca aparecían
- La instrumentación de v0.8.3 funcionó a la primera: el reporte llegó
  con el error exacto, `ReferenceError: box is not defined`, en
  `updateOffscreenMarkers()`. Causa: dos variables declaradas con
  `const` dentro de un bloque `if` pero usadas fuera de él, en la misma
  función — sintaxis 100% válida, error solo en tiempo de ejecución, por
  eso `node --check` nunca lo detectó. Como esa función corre en cada
  frame desde `update()`, el error cortaba TODO lo que viene después
  cada vez — joystick, sonido, movimiento — mientras el HUD (HTML aparte)
  seguía funcionando con normalidad. Bug real desde v0.7.0.
- Al pasar `eslint` (reglas `no-undef`/`block-scoped-var`) sobre todo el
  código para buscar más casos iguales, apareció un SEGUNDO bug real de
  la misma familia: en `spawnBackdropsUnsafe()`, la línea que inicializa
  el generador aleatorio se perdió sin querer durante el refactor de
  v0.8.1 — las 63 nebulosas/galaxias de fondo llevaban desde entonces
  sin aparecer NUNCA, en ninguna sesión, fallando en silencio (atrapado
  por un try/catch a propósito) sin que nadie lo notara.
- Ver diseño 8.4.20 y 8.4.21 para el detalle completo, incluida la
  lección de proceso: a partir de ahora se pasa eslint (no solo
  `node --check`) antes de dar por bueno un parche que toque `main.js`.

## [v0.8.3]

### Añadido — errores visibles en pantalla + fallback de renderer
- Tras el reporte de "todo negro, joystick no responde, sin sonido,
  pero WARP sí funciona" (v0.8.2): ese último dato apunta a que el
  canvas de Phaser nunca arrancó de verdad (WARP y las barras de HUD
  son HTML aparte). No se pudo confirmar la causa exacta sin acceso a
  la consola real del dispositivo — este parche instrumenta el juego
  para que la PRÓXIMA vez que pase algo así, se vea el error real en
  pantalla en vez de solo el síntoma.
- Cualquier error de JS (`error`, `unhandledrejection`) ahora fuerza la
  pantalla de carga a un estado de error visible con el mensaje real.
- Sospecha concreta abordada: el juego fuerza WebGL desde hace
  versiones (por nitidez) — si el dispositivo no lo soporta de verdad,
  eso deja el juego completamente roto sin ningún aviso. Ahora se
  reintenta con Canvas2D si WebGL falla al crear el contexto.
- Ver diseño 8.4.19 para el detalle completo.

## [v0.8.2]

### Añadido — pantalla de carga con progreso real
- Hasta ahora, entre elegir personaje y ver la propia nave, la pantalla
  se quedaba negra sin ningún aviso — el preload de Phaser y la conexión
  al servidor eran indistinguibles de un juego colgado de verdad (la
  misma confusión que causó el bug de v0.8.0/v0.8.1).
- Nueva pantalla de carga con progreso REAL (enganchada al evento
  `progress` del loader de Phaser, no una animación decorativa), fase de
  "Conectando con el servidor…" separada, y estado de error visible con
  botón de reintentar si falla la unión a la sala — antes ese error solo
  se veía en una línea pequeña fácil de pasar por alto.
- Se oculta en el momento correcto: cuando la propia nave ya tiene
  posición real confirmada, no en un punto arbitrario antes.
- Ver diseño 8.4.18 para el detalle completo.

## [v0.8.1]

### Arreglado — bug crítico: el juego se quedaba en pantalla negra sin conectar
- v0.8.0 tenía un bug real: los 63 PNG de decoración de fondo se
  añadieron al `preload()` bloqueante, que no tiene timeout por defecto.
  Una sola petición colgada en una conexión móvil floja dejaba el juego
  entero esperando para siempre — no solo la decoración, TODO lo que
  viene después en `create()`, incluida la conexión real al servidor.
  Por eso se sentía como "cuesta conectar" cuando el servidor ni
  siquiera llegaba a intentarse contactar.
- Fix de dos partes: (1) timeout global del loader (15s) que protege
  cualquier carga futura, no solo esta; (2) los fondos se cargan ahora
  en una segunda pasada DESPUÉS de conectar y ver la propia nave, nunca
  antes — si esa carga tarda o falla, el jugador ya está dentro jugando,
  las nebulosas solo aparecen tarde.
- Ver diseño 8.4.17 para el detalle y el principio general que deja
  sentado para futuros assets no imprescindibles.

## [v0.8.0]

### Añadido — PvP de pruebas (targetear/atacar/matar a otros jugadores) + decoración de fondo cósmico
- **PvP de pruebas**: cualquier otro jugador es tocable/fijable igual que
  un NPC. Antes el servidor ya calculaba el daño en la rama `player` de
  `dispararCiclo` pero nunca avisaba a la víctima — ahora recibe `hit`
  con el mismo formato que un golpe de NPC (shieldDamage/structureDamage
  desglosados), así que el HUD, la vida estimada y los VFX de
  escudo/explosión funcionan sin ninguna rama especial. Auto-fijado de
  vuelta también funciona si te dispara otro jugador. Deliberadamente
  solo el mecanismo — sin balance, recompensa ni penalización por matar
  a otro jugador todavía (eso sigue pendiente, ver 8.4.11).
- **Decoración de fondo cósmico**: 63 nebulosas/galaxias recortadas de
  hojas de referencia (mismo pipeline de despill que las torretas y el
  VFX de combate) dispersas por todo el mundo — posición, rotación y
  escala aleatorias pero DETERMINISTAS por semilla fija, así que todos
  los clientes ven el mismo universo sin que el servidor mande ni una
  coordenada. Capa de ambientación, por debajo de estación/naves, con
  parallax y mezcla aditiva para que no compita visualmente con el
  gameplay.
- Ver diseño 8.4.15 y 8.4.16 para el detalle completo.

## [v0.7.0]

### Añadido — HUD de combate rediseñado: contactos, objetivos múltiples, estelas por clase
- **Marcadores de contacto**: fuera el velo naranja permanente sobre los
  NPC y los puntos planos blanco/naranja indistinguibles de las
  estrellas de fondo. Ahora es un punto dentro de una caja de targeting
  (4 esquinas), roja si es hostil de verdad (NPC), blanca si no.
- **Bug real corregido**: la retícula de bloqueo sobre el objetivo no
  compensaba el zoom de cámara — a partir de cierto zoom out se encogía
  hasta desaparecer ANTES de activarse el marcador de "demasiado lejos",
  y el objetivo fijado parecía esfumarse. Ahora mantiene tamaño
  constante en pantalla, igual que los marcadores fuera de vista.
- **Estelas de motor en batería real por clase de nave**: 1 para
  shuttle/frigate, 2 para destroyer, 3 para cruiser, 4 para
  battlecruiser, 2 gruesas y separadas para battleship/carrier/
  dreadnought. Auto-ajustadas al tamaño real del sprite de cada nave (no
  una tabla por modelo), en fila horizontal paralela dentro del casco.
- **Triángulo de referencia propio** (el que sustituye al sprite en zoom
  out extremo) tarda más en aparecer — antes tapaba la propia nave en
  acercamientos que todavía se consideraban normales.
- **Autodisparo, arreglado**: la casilla vivía dentro del contenedor que
  se oculta entero sin objetivo activo bloqueado, así que se volvía
  intocable la mayor parte del tiempo aunque su estado nunca se
  perdiera. Ahora es independiente y solo se oculta sin ningún objetivo
  fijado en absoluto.
- **HUD de objetivos múltiples**: el servidor ya soportaba varios
  objetivos fijados a la vez (subido de 3 a 4); lo que faltaba era
  verlos — cuadrícula de 2 columnas bajo las barras de estado, tarjeta
  propia por objetivo con nombre, vida, y borde de color según si se
  está fijando/bloqueado/con el arma apuntada. Tocar una tarjeta la
  desfija (antes no había forma de hacerlo desde la UI).
- Ver diseño 8.4.14 para el detalle completo y lo que queda pendiente
  (límite de objetivos por clase de casco, sin PvP todavía).

## [v0.6.0]

### Añadido — Explosiones y escudo visual en combate (VFX)
- El combate deja de ser solo barras y un número flotante: ahora las
  naves explotan de verdad (por tamaño según el daño a estructura, hasta
  una explosión grande al morir) y el escudo se ve chispear cuando
  absorbe un golpe, con un anillo circular u ovalado según la silueta
  real de cada casco — sin tabla por nave, se calcula del sprite.
- Material generado a partir de una hoja de referencia (arte IA) con el
  mismo pipeline que las torretas de v0.5.6: chroma-key + despill de
  color (no solo transparencia, para evitar el halo magenta en los
  bordes) y recorte a 75 frames individuales por detección de contenido
  real, no por rejilla fija — varios frames de la hoja original no medían
  lo mismo que sus vecinos y una rejilla equitativa los cortaba por la
  mitad.
- Servidor: `shot` y `hit` ahora llevan `shieldDamage`/`structureDamage`
  desglosados (antes solo el total) — es lo que usa el cliente para
  decidir qué efecto tocar, sin inferir nada de la vida restante.
- Ver diseño 8.4.13 para el detalle de umbrales, heurística de forma de
  escudo y lo que queda pendiente (validación con Playwright, aviso de
  escudo en PvP).

## [v0.5.12]

### Añadido — 5 iconos nuevos de HUD, generados por IA a partir del inventario de prompts
- Nemesis generó los 5 iconos que faltaban (escudo, casco/estructura,
  capacitor, piloto crucero, auto-fijado) con el prompt de estilo
  compartido en el inventario anterior — llegaron los 5 juntos en una
  sola imagen. Recortados automáticamente (detección de componentes
  conexos con dilatación), pasados de blanco-sobre-negro a blanco con
  transparencia real, y reescalados al mismo margen/proporción que los
  16 iconos ya existentes (medido de un icono real del set, no a ojo).
- La hoja de iconos (`ui/icons.png`) crece de 4×4 a 4×6 — quedan 3
  huecos libres para el futuro. Actualizado el CSS del `mask-position`/
  `mask-size`, que dependía del tamaño exacto de la rejilla.
- **Usados de verdad, no solo añadidos a la hoja**:
  - Nuevo indicador «Piloto crucero activado» en el HUD — hasta ahora,
    activar el crucero (v0.5.7) no tenía NINGÚN reflejo visual, solo se
    notaba por tacto.
  - Iconos de escudo/casco/capacitor junto a sus barras de combate
    (propias y del objetivo fijado), teñidos con el mismo color que
    cada barra.
  - El icono de auto-fijado queda en la hoja, reservado para un futuro
    ajuste del panel de opciones.

## [v0.5.11]

### Añadido — primera pasada de arte real en menús (pack Wenrexa Sci-Fi UI)
- Integrado un pack de UI comprado por Nemesis (Wenrexa, "Sci-Fi
  Minimalism"). No todo el pack encajaba — los iconos venían de un
  survival de colonia (población, O2, comida), no de un MMO espacial —
  pero el "cromo" general (fondos, botones, marcos, iconos genéricos) sí
  se integró:
- **Fondo de nebulosa** en las pantallas de intro/login/personaje,
  atenuado con un degradado oscuro para no restar legibilidad al texto.
  Reducido de 134KB a 6,8KB (era un fondo desenfocado, no perdía nada al
  achicarlo).
- **Botones con esquinas en ángulo** (`.btn-scifi`): Continuar, Entrar,
  Crear cuenta, Crear personaje. Implementado con `clip-path` en CSS, NO
  con los PNG del pack tal cual — esos vienen a un ancho fijo, y con
  texto de longitud distinta según el idioma (i18n) un botón raster
  estirado se ve borroso o deformado. El pack aportó la forma y el color
  (el mismo cian que ya usaba el resto del HUD), no el archivo literal.
- **Icono de engranaje real** sustituyendo el emoji ⚙ del botón de
  opciones.
- **Barra metálica decorativa** rematando las cajas de login y selección
  de personaje.
- Quedan reservados sin usar todavía: `hero-card.png`/`hero-card-2.png`
  (marcos de tarjeta en ángulo — mejor candidato: una futura pantalla de
  selección de nave, no la lista de texto actual de personajes) e
  `icon-planet.png`/`icon-reticle.png` (sin hueco claro en la UI de hoy).

### Corregido — el campo de contraseña no tenía estilo propio
- Encontrado de paso al revisar la pantalla de login: `#login-password-input`
  nunca tuvo ninguna regla CSS — solo el de email. Se veía con el fondo
  blanco por defecto del navegador, chocando con el resto del tema
  oscuro. Corregido aplicándole la misma regla que el campo de email.

## [v0.5.10]

### Mejorado — siguiendo la lista de la auditoría (v0.5.9)
- **Minado a 4Hz, no a 20Hz.** `tryMine()` se llamaba en CADA tick del
  servidor mientras alguien mantenía pulsado minar — la ruta más
  caliente del bucle principal con varios mineros a la vez. Ahora se
  resuelve a 4Hz, igual que el escaneo de acción contextual.
  `MINING_RATE_BASE` sube de 5 a 25 para que el ritmo de extracción por
  segundo sea idéntico al de antes — solo cambia la frecuencia de la
  comprobación, no el balance. Verificado: 4 llamadas a 4Hz extraen
  exactamente lo mismo que 20 llamadas a 20Hz.
- **`setTimeout` del respawn ya no queda huérfano.** El timeout de 5s
  tras morir se registra ahora en un `Set`, y `onDispose()` los cancela
  todos si la sala se cierra antes de que disparen — antes, si la sala
  se cerraba con alguien recién muerto, el callback seguía vivo y podía
  intentar tocar `this.state` ya destruido.
- **Válvulas de seguridad nuevas**: `maxClients = 80` en la sala (antes
  no había ningún techo), y un límite de 40 mensajes/segundo por
  cliente (el input legítimo manda ~20/s) — por encima se descarta el
  mensaje en silencio, sin desconectar a nadie por un pico de red
  normal. Ninguna de las dos resuelve el problema de fondo (sala única
  sin sharding, ver 14.4 del diseño) — son un tope para que una
  anomalía no tumbe la partida mientras tanto.
- Sin cambios visibles para quien juega — todo esto es rendimiento y
  robustez del servidor.

## [v0.5.9]

### Corregido — bug de la orientación guardada (auditoría completa del proyecto)
- Se guardaba `player.facing`, un campo que se ponía una única vez al
  cargar la partida (desde el valor guardado la vez anterior) y nunca se
  volvía a tocar durante el vuelo — la orientación real se actualiza en
  `player.rotation`, cada tick. Resultado: cada personaje reaparecía
  mirando hacia donde miraba dos sesiones atrás, nunca hacia donde se
  dejó realmente. No afectaba a posición, HP, escudo ni carga (esos sí
  se guardaban bien).
- Corregido guardando `player.rotation` directamente; se elimina el
  campo `facing` muerto.

### Mejorado — rendimiento de búsquedas de cliente (auditoría)
- Cuatro puntos del servidor (auto-fijar de vuelta, devolver el golpe de
  un NPC, avisar de muerte, avisar de reaparición) buscaban el `Client`
  de un jugador recorriendo la lista completa de conectados
  (`this.clients.find(...)`) — barato con pocos jugadores, pero un
  recorrido lineal que crece con cada persona conectada.
- Sustituido por un `Map` sessionId → Client mantenido en `onJoin`/
  `onLeave` (incluida la ventana de reconexión: durante ese margen el
  Map no encuentra al cliente, igual que antes tampoco lo encontraba
  `this.clients.find`). Búsqueda ahora O(1) en vez de O(jugadores
  conectados).
- Sin cambios de comportamiento — mismo resultado, menos trabajo por
  búsqueda.

### Añadido — estrellas de fondo a tamaño constante
- Las 900 estrellas vivían en el mundo, así que su tamaño en pantalla
  cambiaba con el zoom — casi invisibles con zoom out extremo, manchas
  grandes con zoom in. Ahora contrarrestan el zoom (mismo truco que los
  marcadores de referencia): su tamaño en pantalla es siempre el mismo,
  se muevan o no con el paralaje de la cámara.

### Añadido — triángulo de referencia para la propia nave
- Con zoom muy alejado el sprite de tu propia nave también se vuelve
  ilegible, igual que le pasaba a las demás naves. Ahora, pasado el 50%
  del recorrido de zoom (en escala logarítmica — el zoom se siente
  multiplicativo, no lineal), el sprite se sustituye por un triángulo
  blanco fijo en el centro exacto de la pantalla, apuntando hacia el
  rumbo real. Por debajo del 50% (más cerca) desaparece y vuelve a verse
  el sprite normal.

### Cambiado — el botón de opciones se muda a la esquina
- Antes vivía junto a los botones de combate, abajo a la derecha. Ahora
  está en la esquina superior derecha, con el número de versión
  reubicado justo debajo para que no se solapen.

## [v0.5.8]

### Corregido — crash del servidor entero al destruir tu propio objetivo
- **Bug crítico en producción**, encontrado revisando los logs de Render
  tras un aviso de caída con jugadores dentro. Al disparar el tiro que
  destruye tu ÚNICO objetivo fijado, `destruirNpc()` recorre a TODOS los
  jugadores conectados (incluido el que acaba de disparar) y le pone su
  propio `activeTarget` a `null` si era ese el NPC destruido — pero el
  código de después seguía leyendo `cs.activeTarget.kind`/`.id` sin
  comprobar que siguiera existiendo, y crasheaba el proceso Node.js
  ENTERO: no solo el disparo fallaba, se caía la partida para todos los
  conectados en ese momento (Render lo reinicia solo, pero de golpe).
- Corregido capturando el objetivo del disparo en variables locales
  ANTES de la llamada que puede vaciar `cs.activeTarget`, y usando esas
  variables el resto de la función en vez de releer el estado que puede
  haber cambiado por debajo.
- Confirmado con Supabase que ningún progreso se perdió — el guardado
  automático ya había corrido justo en el momento del crash.
- Bug pre-existente (no introducido en v0.5.7, solo encontrado ahora al
  revisar los logs de producción tras el aviso de caída).

## [v0.5.7]

### Corregido — el crucero giraba y aceleraba como una lanzadera
- Giro y aceleración eran una constante global única para todo el juego
  (180°/s, 300u/s²), literalmente pensada para la lanzadera FHI Wren.
  Vida/escudo ya eran del crucero (Warden/Bastion) pero a mano, sin
  catálogo real detrás.
- Corregido con un catálogo de físicas por clase en el servidor, basado
  en **masa real** (F = m·a): cada clase tiene un empuje/par de motor
  fijo (el diseño del casco), y giro/aceleración salen de dividir eso
  entre la masa de cada nave — no son números sueltos. Así, dentro de la
  misma clase, una nave más pesada gira y acelera un pelín peor que una
  más ligera, y el día que haya carga en bodega o módulos que cambien la
  masa, afectan al manejo automáticamente sin tocar más código.
- Escudo (60% del HP) y firma (proporcional a la raíz del HP) también
  pasan a calcularse por nave individual, con el mismo ratio que ya se
  usaba a mano para el Warden y el Bastion.
- Bug real encontrado probando esto en caliente: pilotos invitados o
  personajes recién creados entraban con 100 HP fijos (el valor por
  defecto del esquema) en vez de los 698 del crucero — la comprobación
  que debía asignar las stats reales nunca disparaba porque 100 ya es un
  valor "verdadero". Corregido.
- De paso, corregido un bug menor: al guardar la partida se escribía
  siempre `shipId: "shuttle_01"` aunque el jugador vuela un crucero.
- **Fix relacionado, mismo parche**: la predicción local del CLIENTE
  tenía sus propias constantes de física de lanzadera, nunca
  sincronizadas con el arreglo de arriba — sin esto, la nave se habría
  visto con tirones (el cliente prediciendo un manejo, el servidor
  aplicando otro). Ya sincronizado con el modelo de masa real.

### Añadido — joystick analógico 360°, pivotar sin acelerar, piloto crucero
- El movimiento ya no se cuantiza a 8 direcciones — el joystick manda
  ángulo real, la nave gira hacia exactamente ahí.
- Tocar el joystick un poco ahora solo pivota la nave (gira sin empuje);
  el empuje entra progresivo pasado cierto desplazamiento, no de golpe.
- **Piloto crucero**: mover el joystick de verdad, soltar, y volver a
  tocar SIN arrastrar (un tap limpio) deja la nave viajando sola a la
  velocidad/rumbo que llevaba, sin fricción ni tener el dedo en
  pantalla — se cancela en cuanto se vuelve a tocar el joystick de
  verdad, o al entrar en warp.

### Añadido — punto de referencia para naves y objetivos fuera de vista
- Con el zoom muy alejado, las naves que se reducen a un par de píxeles
  se sustituyen por un punto de tamaño fijo en pantalla (no se encoge
  con el zoom).
- Los objetivos fijados llevan este mismo tratamiento SIEMPRE, a
  cualquier zoom: si están fuera de la parte de mundo visible, el punto
  aparece en el borde de la pantalla señalando hacia dónde están, sin
  tener que alejar la cámara para encontrarlos.

### Añadido — fijar automáticamente a quien te ataca
- Cuando un NPC te elige como objetivo (contraataque o por acercarte
  demasiado), el servidor te fija automáticamente de vuelta — te ahorra
  el toque manual justo cuando más ocupado estás esquivando.
- Activado por defecto; se puede desactivar desde el menú de opciones
  ("Fijar automáticamente a quien me ataque"). Preferencia de cliente
  (se guarda en el propio dispositivo), pero quien decide fijar de
  verdad sigue siendo el servidor — pasa por las mismas reglas que un
  fijado manual (rango, límite de objetivos simultáneos).

## [v0.5.6]

### Corregido — iónica v1 fuera, halo magenta eliminado
- Se retira del catálogo la variante "iónica v1" (arte con errores);
  solo queda la versión buena, ahora sin el "(v2)" en el nombre.
- Se reprocesaron con un recorte más estricto (umbral de color más alto
  + erosión de 1-2px en el borde) las torretas iónicas y las
  radiológicas, que se veían con un halo magenta residual del fondo
  chroma-key. Ya no queda rastro.

### Añadido — familia térmica (plasma/láser)
- 8 torretas nuevas: Cañón de Plasma (corto) y Láser (largo), en
  S/M/L/C. Con esto ya están las 4 familias de daño del documento de
  diseño (8.4.5) representadas: cinética, iónica, radiológica y
  térmica — 32 torretas en total.

## [v0.5.5]

### Añadido — 32 torretas reales integradas en la Naveteca
- Se procesaron las hojas de referencia de torretas (cinéticas, iónicas
  —dos variantes de arte, v1 y v2— y radiológicas) recortando cada
  modelo individual con fondo transparente: 8 cinéticas (autocañón/
  railgun), 8 iónicas v1, 8 iónicas v2 y 8 radiológicas (proyector de
  neutrones/cañón gamma), en S/M/L/C.
- Nueva carpeta `client/public/turrets/` (`turrets.json` + `sprites/`)
  con este catálogo "de fábrica": la pestaña "Eje de rotación" de la
  Naveteca ya lo carga solo, sin tener que subir nada a mano. Se puede
  seguir subiendo torretas propias además de las de fábrica.
- Las torretas de fábrica no se pueden borrar del repo desde el
  navegador, pero sí **ocultar** de la lista (con botón para
  restaurarlas), y su pivote/nombre se puede reajustar localmente sin
  tocar el original — todo como "overrides" hasta que se exporte el
  parche.
- **Ajuste fino por coordenadas**: cada slot de torreta en una nave
  ahora tiene también dos campos numéricos de x/y, para mover con
  precisión además de arrastrar.
- **Torretas recomendadas por clase de nave**: al elegir una nave en
  "Slots de torretas" se muestra una cifra orientativa (p. ej.
  "recomendado: 5 torretas — crucero"). Es un punto de partida editable,
  no una regla de balance cerrada (pendiente real en 8.4.11).
- Probado de extremo a extremo en navegador: carga de las 41 naves y
  las 32 torretas, simetría al colocar slots, asignación de torreta a
  un slot con vista previa girada, ajuste fino por coordenadas, y
  ocultar/restaurar una torreta de fábrica.

## [v0.5.4]

### Añadido — herramienta de hardpoints en la Naveteca
- Dos pestañas nuevas en la Naveteca (`client/public/naveteca/`), junto a
  la de edición de naves:
  - **Slots de torretas**: sobre el sprite de cada nave, tocar añade un
    slot y arrastrar lo mueve. Simetría opcional en eje X (izquierda-
    derecha) y/o eje Y (arriba-abajo): con ella activada, cada slot que
    se coloca crea a la vez su pareja al otro lado, y moverlo mueve a la
    pareja también. Cada slot puede tener una torreta asignada, que se
    dibuja ya girada/alineada por su pivote sobre la propia nave.
  - **Eje de rotación (torretas)**: se sube el PNG de cada torreta y se
    marca a mano, arrastrando una cruz, el punto exacto sobre el que
    debe girar al apuntar (no siempre el centro de la imagen).
- Botón "Exportar parche de armamento (.zip)" que empaqueta
  `turret-slots.json` (slots por nave) y `turrets.json` + las imágenes
  de torreta (catálogo con pivote). Aún no hay carpeta fija en el repo
  para estos archivos ni código que los lea en combate — ver 8.4.12 del
  documento de diseño. Esta es solo la herramienta de autoría.

## [v0.5.3]

### Corregido — botón "Crear cuenta" invisible
- El CSS del botón de la pantalla de login se escribió para un `id` de
  una versión anterior (`#login-send-btn`, de la era del enlace mágico) y
  nunca se actualizó al reescribir esa pantalla con botones separados de
  Entrar/Crear cuenta. El de Entrar caía en el estilo por defecto del
  navegador (visible, aunque desentonaba); el de Crear cuenta, con fondo
  transparente y sin color de texto propio, quedaba prácticamente
  invisible sobre el fondo negro.
- Corregido dándole a cada botón su estilo explícito, con el secundario
  usando borde y texto claros en vez de los valores por defecto del
  navegador.

### Corregido — flash de español antes de cambiar de idioma
- La pantalla de login no tenía ningún estado oculto por defecto (a
  diferencia de la pantalla de intro), así que en el primer pintado —
  antes de que corriera una sola línea de JavaScript — ya se veía, con el
  texto en español escrito directamente en el HTML. En cuanto la app
  detectaba el idioma real del teléfono y lo aplicaba, ese texto se
  sustituía. En un teléfono con el navegador en inglés, eso se veía como
  "empieza en español y cambia de golpe a inglés" — no era un fallo de
  idioma, era que la pantalla se enseñaba antes de que la app decidiera
  cuál tocaba.
- Corregido ocultando la pantalla de login por defecto, igual que ya
  hacían la de intro y la de selección de personaje.

## [v0.5.2]

### Corregido — "Ese personaje no existe" con sesión recordada
- Al abrir la página, el juego iniciaba una unión a la sala **antes** de
  que el jugador hubiera elegido personaje, para tener la conexión ya en
  marcha (optimización de latencia). Esa unión temprana viajaba con
  `characterId: null`.
- Para quien no tenía sesión guardada, eso fallaba con un error distinto
  y pasaba desapercibido. Para quien SÍ tenía sesión recordada (login con
  la casilla de "mantener sesión" marcada), el token era válido — el
  servidor llegaba a comprobarlo — y fallaba después, buscando un
  personaje con id `null`: exactamente el "Ese personaje no existe o no
  es tuyo" que se veía en pantalla.
- Ese intento fallido quedaba guardado y se **reutilizaba** más tarde, en
  vez de intentar la unión otra vez ya con el personaje real elegido. Por
  eso el error persistía en cada intento, incluso recargando la página.
- Corregido separando las dos cosas: al abrir la página solo se despierta
  el servidor (una petición sin identidad). La unión real a la sala —la
  que necesita saber quién eres y qué personaje quieres— se hace una sola
  vez, cuando ya se ha elegido personaje.

## [v0.5.1]

### Corregido — el juego no arrancaba ninguna partida
- v0.5.0 llegó a producción con un fallo que impedía crear la sala:
  `spawnNpc()` escribía en `this.npcBrains` antes de que ese `Map` se
  hubiera inicializado, porque se llamaba al principio de `onCreate()` en
  vez de al final. El síntoma en pantalla era un "error de conexión"
  genérico que no apuntaba a la causa real.
- Corregido moviendo la creación de asteroides y NPCs al final de
  `onCreate()`, después de que todas las piezas que usan estén listas.
  Verificado con un cliente Colyseus real conectando contra el servidor,
  no solo revisando el código.

## [v0.5.0]

### Añadido — primer combate jugable
- **Nave inicial: crucero** (FHI Warden). El armamento de este parche es
  Medium y probarlo con la lanzadera no habría dicho nada útil.
- **Fijar objetivo**: se toca una nave, tarda 4 s en bloquear, retícula
  girando sobre el blanco mientras dura. Hasta 3 objetivos a la vez.
- **Un arma**: autocañón Medium de corto alcance. El daño se calcula al
  instante en el servidor — no hay proyectiles como objetos (ver 8.4.2 del
  documento de diseño). Cada disparo muestra sus factores por separado
  (ángulo, rango) para poder aprender a colocarse.
- **Botón de disparo y casilla de autodisparo**, ambos aparecen solo con
  un objetivo bloqueado y desaparecen sin él.
- **Escudo, estructura y energía** como tres barras reales en el HUD. La
  energía solo la ve su dueño (mensaje privado, no estado replicado).
- **Dos cruceros enemigos** (FHI Bastion) patrullando el sistema, con IA
  que persigue, orbita y dispara. Piensa 4 veces por segundo, no 20 — el
  coste de tener decenas de estos algún día importa desde ahora.
- Reaparecen 30 s después de destruidos.

### Balance — verificado por simulación, no a ojo
- El daño y la regeneración de escudo se probaron simulando combates
  completos antes de fijar los números. El primer intento hacía que
  orbitar pegado diera inmunidad de facto (162 s sin recibir daño); el
  balance final deja el orbiteo como ventaja real pero no absoluta.

### Muerte — provisional
- Al perder toda la estructura, la nave reaparece a los 5 s en el centro
  con todo lleno. **No se pierde la nave ni la carga.** El diseño (8.4)
  dice que morir cuesta la nave entera, pero eso necesita inventario,
  seguro y equidad de pérdida, que no existen todavía.

## [v0.4.0]

### Cambiado — acceso con contraseña en lugar de enlace por correo
- **Correo y contraseña**, con botones separados de *Entrar* y *Crear
  cuenta*, y casilla de **mantener sesión iniciada** (marcada por defecto).
- Se retira el enlace mágico. Dos motivos: obligaba a salir del juego para
  entrar al juego, y el correo de serie de Supabase **solo envía mensajes a
  los dueños del proyecto**, así que ningún otro jugador habría recibido
  nunca su enlace. Funcionaba en pruebas solo porque el probador era el
  dueño.
- Sin marcar la casilla, la sesión se borra al cerrar la pestaña (móvil
  prestado u ordenador compartido).
- Errores traducidos al idioma del jugador: contraseña incorrecta, cuenta
  ya existente, contraseña corta, demasiados intentos, sin conexión. Se
  detectan por código de error además de por texto, porque la redacción de
  Supabase puede cambiar entre versiones.
- Enter entra, pero no crea cuenta: crear una cuenta sin querer por pulsar
  Enter sería un mal accidente.

### Añadido — login dormido durante el desarrollo
- `LOGIN_ENABLED = false` en `client/src/cuenta.js`. Con el login dormido
  no se pide nada al entrar: el juego crea en silencio una **cuenta
  anónima**, que es una cuenta real de la base de datos sin correo.
- Los personajes siguen en Supabase con todas sus reglas y el progreso se
  sigue guardando. No es un camino paralelo: las pruebas ejercitan
  exactamente el mismo recorrido que usará el juego con login activo, así
  que activarlo no obliga a volver a probarlo todo.
- Si las sesiones anónimas no están habilitadas en Supabase, aparece la
  pantalla de login normal en lugar de una pantalla muerta.
- Para despertarlo: cambiar la constante a `true`.

### Corregido
- Tras identificarse, la pantalla no avanzaba a la selección de piloto: la
  sesión se abría correctamente pero el juego se quedaba en el formulario.

### Pendiente conocido
- **No hay recuperación de contraseña.** Requiere conectar un servicio de
  correo propio, que es requisito previo a abrir el juego a desconocidos.
  Mientras tanto, se recupera a mano desde el panel de Supabase.

## [v0.3.0]

### Añadido — cuentas y progreso guardado (Supabase)
- **Entrada por enlace mágico al correo.** Sin contraseñas: el jugador
  escribe su email, recibe un enlace y al pulsarlo entra.
- **Personajes por cuenta**, no por navegador. Se acabó `localStorage`:
  ahora se puede jugar el mismo piloto desde cualquier dispositivo.
- **El progreso se guarda**: posición, velocidad, orientación, casco y
  carga. Al volver a entrar, la nave está donde se dejó.
- Guardado cada 30 s, al salir, al expirar la ventana de reconexión y al
  cerrarse la sala. No se guarda cada tick a propósito: veinte escrituras
  por segundo y por jugador fundirían la base sin ganar nada.

### Seguridad
- El navegador **no puede escribir** posición, casco ni carga. Solo puede
  crear, listar y borrar sus propios personajes. El estado de vuelo lo
  escribe únicamente el servidor. La base lo impone por sí misma, aunque
  se modifique el código del cliente.
- Al entrar a jugar el servidor verifica el testigo de sesión contra
  Supabase **y** que el personaje pertenezca a esa cuenta. Sin lo segundo,
  conocer el identificador de otro bastaría para jugar con su nave.
- Límite de 5 personajes y unicidad de nombre (ignorando mayúsculas)
  aplicados en la base de datos, no en el navegador.

### Corregido
- El aviso de "límite de personajes alcanzado" no llegaba a mostrarse:
  el cliente buscaba el mensaje por su texto y no coincidía con el que
  emite la base. Ahora se detecta por código de error.
- La clave de servicio se acepta con dos nombres posibles de variable de
  entorno. Si no coincide, el servidor arranca y no guarda nada sin dar
  error — el fallo más difícil de detectar.

## [v0.2.0]

### Añadido — arte e iconografía de interfaz
- **Atlas de 16 iconos** (`client/public/ui/icons.png`, rejilla 4x4 de
  256 px con transparencia). Una sola descarga de ~107 KB en lugar de 16
  peticiones, y el mismo archivo se reutiliza en los dos sitios donde
  hace falta: como máscara CSS en el HUD HTML y como hoja de sprites de
  Phaser para lo que se dibuja dentro del mundo.
- Los iconos son **blancos y se tiñen por código** (`background-color` en
  CSS, `setTint` en Phaser). Un mismo dibujo de nave sirve para amigo,
  enemigo o neutral sin guardar tres imágenes.

### Añadido — botón de acción contextual
- El antiguo botón MINAR pasa a ser **un único botón de acción** cuyo
  significado depende de lo que el jugador tenga a rango: `mine`, `dock`,
  `gate` (punto de salto) o `loot` (pecio). Cuando no hay nada accionable
  el botón desaparece en vez de quedarse apagado.
- **Decide el servidor, no el cliente.** Si lo decidiera el cliente
  bastaría con manipularlo para "atracar" desde fuera de rango.
- El cálculo **no viaja por el estado replicado de Colyseus**: si fuera
  un campo del `Player`, cada cambio se difundiría a todos los jugadores
  de la sala aunque solo le importe a uno. Se manda como mensaje directo
  al cliente afectado, a 4 Hz y **solo cuando el resultado cambia** — en
  vuelo por el vacío no se envía nada.
- Retícula giratoria sobre el objetivo elegido, para desambiguar cuando
  hay varios objetos cerca.

### Cambiado
- Los asteroides usan el icono del atlas (roca irregular) en lugar de un
  círculo gris dibujado a mano.
- Minar depende ahora de dos cosas separadas (ver 8.2.1 del documento de
  diseño): **poder** minar depende del módulo montado, que puede ir en
  cualquier casco y es lo que hace aparecer el botón; **cuánto** extraes
  depende del casco, con las naves mineras dedicadas del orden de ×10 por
  encima. **Provisional:** no existe todavía sistema de módulos ni clase
  minera, así que hoy todos llevan módulo y todos extraen a ×1.
- El contador del HUD muestra carga e integridad del casco con icono en
  lugar de con las palabras "Carga:" y "HP:".

## [v0.1.4]

### Cambiado — arreglo de raíz de la nitidez (los dos intentos anteriores eran parches sobre el síntoma)
- **Toda la interfaz que no es "mundo del juego" pasa de Phaser a HTML/CSS
  normal**: botones de WARP/MINAR, engranaje de opciones, panel de
  opciones (con selector de idioma), insignia de versión, pantalla de
  "juego cerrado". Solo se queda en el canvas lo que de verdad necesita
  vivir ahí — naves, asteroides, estrellas, la estela de plasma, y el
  joystick (tiene que aparecer justo donde se toca, eso sí es "mundo").
- Motivo: el HTML lo renderiza el navegador de forma nativa, que ya sabe
  gestionar pantallas de alta densidad sin configuración — es exactamente
  por lo que el HUD (`#ui`, arriba a la izquierda) siempre se vio nítido
  mientras todo lo dibujado a mano en Phaser (texto, formas) daba
  problemas. En vez de seguir peleando con la configuración de
  resolución/renderer de Phaser (intentos de v0.1.2 y v0.1.3), se quita
  el problema de raíz moviendo esa UI a donde nunca iba a tenerlo.
- Efecto colateral bueno: ya no hace falta la lógica de "zonas de
  exclusión" para que el joystick no se dispare al tocar un botón — un
  botón HTML encima del canvas capta el toque él solo, sin que llegue
  nunca al canvas de abajo. Código de `setupTouchMovementAndZoom` más
  simple.

## [v0.1.3]

### Corregido (intento 2 — el de v0.1.2 lo empeoró)
- El arreglo de nitidez de v0.1.2 (`resolution` en cada texto de Phaser)
  **empeoró el problema** en vez de arreglarlo — según el reporte, tanto
  el texto como las formas de los botones se veían peor. Diagnóstico:
  `type: Phaser.AUTO` puede caer en el renderer de Canvas2D en vez de
  WebGL según navegador/dispositivo, y Canvas2D tiene un historial largo
  de bugs específicamente con `resolution`/nitidez en pantallas de alta
  densidad (varios issues abiertos en el repo de Phaser desde 2018, con
  reportes similares aún en 2025). Además, aplicar `resolution` por
  separado en cada texto ENCIMA del `resolution` general del canvas
  probablemente causaba una escala duplicada, agravando el problema en
  vez de resolverlo.
  - Revertido: ya no se fija `resolution` en cada `Text` individual.
  - Nuevo: `type: Phaser.WEBGL` forzado en vez de `Phaser.AUTO`, para
    garantizar el renderer donde `resolution` funciona de forma fiable
    desde Phaser 3.60+.
  - **Nota de transparencia**: esto no se ha podido verificar en un
    dispositivo real de alta densidad antes de publicarlo (sin acceso a
    ese hardware) — es el intento más fundamentado según la
    documentación y los issues conocidos de Phaser, pero necesita
    confirmación real tras desplegar.

## [v0.1.2]

### Corregido
- **Texto de Phaser borroso** (WARP, MINAR, engranaje, panel de
  Opciones) mientras el HUD en HTML (`#ui`, arriba a la izquierda) se
  veía nítido. Causa: los objetos `Text` de Phaser renderizan su propio
  bitmap interno a resolución 1 por defecto, **independientemente** del
  `resolution` general del canvas que ya se había fijado en v0.0.6 — cada
  texto necesita su propio `resolution` en el estilo. Añadido a los 12
  textos de la escena.
- **Nombre del jugador ya no aparece sobre la propia nave** — solo tiene
  sentido para identificar a los demás, no a uno mismo.

### Cambiado
- **Estela de plasma rediseñada como chorro, no nube**: antes emitía
  partículas en todas direcciones con velocidad aleatoria (efecto puff).
  Ahora usa un ángulo de emisión exacto actualizado cada frame según la
  orientación real de la nave (`setEmitterAngle` con un número, no un
  rango — Phaser tiene un bug conocido con rangos en tiempo de
  ejecución), partículas más finas y la velocidad de cada partícula
  escala con la velocidad real de la nave (`setParticleSpeed`) — el
  chorro se alarga notablemente en warp.

## [v0.1.1]

### Corregido
- **Parpadeo/saltos durante el warp**: el cliente hacía "snap" directo a
  la última posición confirmada por el servidor cada frame, que solo
  llega ~20 veces por segundo — a 1200 u/s eso se notaba muchísimo más
  que en vuelo normal. Ahora el cliente predice la trayectoria del warp
  localmente (línea recta a velocidad fija, igual que hace el servidor)
  en vez de esperar cada paquete de red — movimiento suave, con
  reconciliación de respaldo por si el servidor difiere (p. ej. al topar
  con el borde del mundo).
- **Renderizado borroso/granulado en pantallas de alta densidad**: no
  había ninguna configuración de `resolution` en Phaser, así que en
  cualquier móvil o portátil con `devicePixelRatio` > 1 (la inmensa
  mayoría), el juego renderizaba a resolución de píxeles CSS y el
  navegador estiraba el canvas para llenar los píxeles físicos reales —
  esa ampliación era el "velo" borroso sobre botones y naves. Corregido
  con `resolution: window.devicePixelRatio`.

### Cambiado
- **`WORLD_SIZE` del prototipo sube de 4.000 a 30.000**, el tamaño de
  chunk ya decidido en el documento de diseño (sección 5.5) — antes solo
  se aplicaba al diseño, no al código. Asteroides de prototipo subidos de
  15 a 120 para que el mundo más grande no se sienta vacío (densidad
  provisional, no calibrada). Zoom mínimo bajado a 0.025 y campo de
  estrellas ampliado para poder ver el sistema completo con el zoom al
  mínimo.

## [v0.1.0]

### Añadido
- **Sistema de warp** — nueva mecánica de gameplay, no un ajuste. Botón
  verde "WARP" junto al de minar (tecla `E` en escritorio):
  - Al activarlo empieza una cuenta atrás de carga ("Cargando motor
    warp…Xs"), con la nave todavía bajo control normal durante la carga.
  - Al completarse, si la nave tenía velocidad distinta de cero, se
    vuelve invulnerable y sale disparada en línea recta (en la dirección
    en la que ya iba, no hacia donde apunte el jugador) al 500% de la
    velocidad máxima. Si estaba parada, la carga no tiene efecto.
  - Durante el warp no se puede girar ni acelerar manualmente — viaja en
    línea recta hasta cancelarse (pulsando el botón otra vez, para en
    seco donde esté) o hasta topar con el borde del mundo.
  - Enfriamiento de 30s tras activar la carga (se cuenta desde que se
    pulsa, no desde que termina el viaje).
  - Todo lo decide el servidor (carga, velocidad, colisión con el borde,
    cancelación) — el cliente solo manda el botón y refleja el estado
    sincronizado.
  - Tiempo de carga (10s) calibrado para la única nave del juego ahora
    mismo; debería variar por clase cuando exista selección real de nave.
- Zoom mínimo ampliado mucho más (de 0.5 a 0.08) para poder alejarse
  hasta ver el mapa a escala de sistema, no solo la nave — pensado de
  cara a puntos de interés/salto cuando existan. Campo de estrellas
  ampliado a juego para que no se vea vacío al zoom mínimo.
- Botón de opciones cambiado de hamburguesa arriba-izquierda a engranaje
  abajo-derecha, encima del botón de minar.

## [v0.0.11]

### Corregido
- La estela de plasma del motor salía por el lateral de la nave en vez de
  por la cola. La fórmula de posicionamiento restaba `PI` directamente a
  `sprite.rotation`, pero ese ángulo ya lleva un desfase de `+PI/2` por la
  orientación del arte (el sprite apunta "arriba" por defecto) — restar
  `PI` sin deshacer antes ese desfase dejaba el offset girado 90° de más.
  Corregido a `sprite.rotation + PI/2`. Verificado en las 4 direcciones
  cardinales antes de aplicar.

## [v0.0.10]

### Añadido
- Los 41 sprites del catálogo de naves (`client/public/ships/sprites/`)
  se recortan ahora a partir de una hoja con canal alfa real, en vez del
  umbral de brillo aproximado usado originalmente. De paso se corrigió un
  fallo del propio recorte: cuando dos naves quedaban muy cerca en la
  hoja, el rectángulo de recorte de una podía capturar una esquina de la
  vecina — ahora se enmascara por componente conectado antes de recortar,
  no solo por rectángulo. Mismos IDs/nombres/clases de antes, solo mejor
  arte fuente. No afecta visualmente a la nave en uso ahora mismo
  (`shuttle_01`, que ya estaba limpia) — relevante para cuando exista
  selección real de nave y se usen las demás.

## [v0.0.9]

### Arreglado
- Reconexión: el servidor borraba al jugador de la partida al instante en
  cuanto se cortaba el socket, así que reconectar (p. ej. al minimizar en
  móvil) fallaba siempre, no de forma intermitente. Ahora se reserva el
  asiento 90s antes de borrar al jugador, y el cliente reintenta hasta
  cubrir esa ventana, incluyendo al volver de segundo plano.
- HUD (menú, versión, botón de minar, joystick) ahora vive en una cámara
  propia que nunca hereda el zoom del mundo — antes se desajustaba al
  hacer zoom out porque solo se compensaba a mano el tamaño de algunos
  elementos, no la posición, y el botón de minar no se compensaba en
  absoluto.
- Vibración de la nave con zoom metido: la cámara redondeaba su posición a
  píxel entero en cada frame (`roundPixels`), visible sobre todo con zoom
  alto. Ya no redondea.
- Botón de minar: más margen de exclusión frente al joystick táctil, para
  que un toque no perfectamente centrado no dispare un joystick que tape
  el botón.
- Sprites de nave: se recorta el padding transparente del PNG al cargar,
  para aprovechar mejor la resolución disponible en zoom in. (No resuelve
  aún la diferencia de escala completa entre clases de nave — pendiente
  de trabajo de pipeline de arte.)

### Añadido
- Estela de plasma azul en el motor mientras la nave acelera, para
  orientarse mejor sobre la propia posición y dirección.

## [v0.0.3]

### Añadido
- Predicción local de movimiento: la propia nave se mueve al instante en
  pantalla según el input, sin esperar confirmación del servidor.
  Reconciliación suave si la predicción se desvía demasiado de la
  posición confirmada por el servidor (en vez de "teletransportar" de
  golpe).
- Interpolación de jugadores remotos: se dibujan con ~100ms de retraso
  interpolando entre las dos últimas posiciones reales recibidas del
  servidor, en vez de saltar bruscamente cada vez que llega un paquete.
- Pantalla de nombre de piloto antes de entrar (ya no todos se llaman
  "Piloto" fijo).
- Indicador de ping/latencia en pantalla, medido con ping/pong real
  contra el servidor cada 2s.
- Reconexión automática si se cae la conexión inesperadamente (hasta 5
  intentos con backoff), usando el token de reconexión de Colyseus. Si
  el jugador cierra el juego a propósito (menú → "Cerrar juego"), no
  intenta reconectar.
- Aviso de "el servidor puede estar dormido" durante la conexión inicial
  si tarda más de 4s (relevante en el plan free de Render, que duerme
  tras inactividad).
- Límite visual del mundo jugable (borde dibujado en el chunk actual),
  con el servidor aplicando el límite real (clamp de posición) — el
  cliente solo lo representa.
- Dos pantallas iniciales antes de entrar al juego:
  1. Changelog scrolleable (entrada más reciente arriba) con una barra de
     estado de conexión fija (no se mueve con el scroll) y un botón
     "Continuar" siempre disponible, aunque el servidor siga
     conectando/despertando de fondo.
  2. Selección/creación de personaje (nombre), hasta 5 personajes
     guardados. Si ya hay personajes creados, se listan con opción de
     crear uno nuevo; si no hay ninguno, se pasa directo a crearlo.
  La conexión al servidor arranca en segundo plano nada más cargar la
  página (antes incluso de que el jugador termine de leer el changelog o
  elegir personaje), así se aprovecha ese tiempo para que el servidor de
  Render despierte si estaba dormido.

### Corregido
- Los jugadores conectados a la vez veían posiciones distintas entre sí y
  movimiento a saltos, por ausencia total de interpolación/predicción en
  el cliente (el sprite se limitaba a "teletransportarse" a la última
  posición recibida del servidor, sin nada entre medias).

## [v0.0.8]

### Cambiado
- **Física de vuelo real**, sustituye el movimiento anterior (velocidad
  instantánea en la dirección del input). Ahora es un modelo tipo
  Asteroids/Newtoniano:
  - El input marca el rumbo *deseado*; la nave gira el morro hacia ahí a
    una velocidad angular limitada (`TURN_RATE`), no de golpe.
  - El empuje (`ACCELERATION`) se aplica en la dirección hacia la que la
    nave está físicamente orientada en ese instante, no hacia el rumbo
    deseado — girar rápido a alta velocidad produce deriva real en vez de
    cambio de dirección instantáneo (intentar orbitar algo sin corregir
    constantemente da elipses, no círculos).
  - Fricción suave (`DRAG`) para que la nave frene sola en un par de
    segundos al soltar el input, en vez de derivar para siempre o parar
    en seco.
  - Movimiento libre a 360°, no las 8 direcciones fijas de antes.
  - Simulado en servidor (autoridad) y replicado en el cliente para la
    predicción local — mismas constantes en los dos sitios.
  - Valores actuales calibrados para la única nave que hay en el juego
    (FHI Wren, lanzadera nimble). Cuando exista selección real de nave,
    cada clase debería tener sus propios valores (más grande/pesada =
    giro y aceleración más bajos).

## [v0.0.7]

### Corregido
- El pellizco de zoom no funcionaba — el primer dedo se comprometía con
  el joystick de movimiento al instante, así que nunca llegaban a
  coexistir dos dedos "libres" para reconocerse como pellizco. Ahora el
  primer toque espera un margen corto (~120ms) antes de confirmar el
  joystick; si llega un segundo dedo en ese margen, el gesto se
  reinterpreta como pellizco de zoom en vez de arrancar el joystick.

## [v0.0.6]

### Añadido
- **Patch notes reales**: la pantalla 1 ya no muestra el `CHANGELOG.md`
  técnico en crudo — muestra un resumen curado para jugador por versión
  (`client/public/patchnotes/{lang}.json`), con la versión actual
  marcada. Sigue listando todas las versiones, la más reciente arriba.
- **UI anclada arriba** en la pantalla de patch notes: la barra de estado
  de conexión y el botón "Continuar" ahora están fijos arriba (antes
  abajo), siempre visibles al hacer scroll a las notas.
- **Diseño responsive**: tamaños de texto y anchos de ventana (patch
  notes, selección de personaje) escalan con `clamp()` entre móvil
  pequeño y escritorio grande, con contenedor centrado en pantallas
  anchas para no estirar el texto de lado a lado.
- **Zoom de cámara**: rueda del ratón en PC, pellizco con dos dedos en
  táctil. El HUD persistente (versión, botón de menú, menú de opciones)
  se compensa para no cambiar de tamaño con el zoom.
- **Internacionalización**: arquitectura de idiomas lista desde la base —
  todo el texto de la interfaz (HTML y Phaser) sale de diccionarios en
  `client/public/i18n/{lang}.json`, sin cadenas de texto sueltas en el
  código. Selector de idioma en el menú de opciones (guarda preferencia y
  recarga). De momento español e inglés; añadir un idioma nuevo es solo
  crear los dos archivos JSON correspondientes (i18n + patch notes) y
  sumarlo a la lista, sin tocar lógica.

## [v0.0.5]

### Añadido
- La naveteca pasa de visor a **editor**: cada nave se puede editar
  (nombre, clase, descripción, HP, velocidad, carga, tripulación) y se le
  puede sustituir el sprite (.png) o el sonido de motor (.mp3/.wav) desde
  la propia interfaz, con botón "Guardar cambios".
- Guardado en dos niveles, porque GitHub Pages es hosting estático y no
  puede escribir en el repo:
  1. **Local (instantáneo)**: se guarda en `localStorage` del navegador.
     Se refleja al momento en la naveteca y en el juego (mismo
     navegador, misma clave de almacenamiento) — recargar el juego basta
     para verlo, sin necesidad de desplegar nada.
  2. **Exportar parche**: botón que empaqueta todas las ediciones locales
     en un `.zip` (`ships.json` fusionado + sprites/sonidos sustituidos)
     listo para aplicar al repo con el flujo habitual de parches, para
     que el cambio lo vea todo el mundo, no solo quien editó.
- Indicador visual de qué naves tienen ediciones locales sin exportar
  (punto de color en la tarjeta + aviso en la ficha), botón para
  restablecer una nave a su versión original, y botón para borrar todas
  las ediciones locales del navegador.

## [v0.0.4]

### Añadido
- Naveteca: catálogo de 41 naves (Shuttle a Dreadnought) de Fiji Heavy
  Industries, generado a partir de un sprite sheet, con nombre, clase,
  estadísticas y sonido de motor placeholder por nave. Vive en
  `client/public/ships/` (sprites, sonidos, `ships.json`) y se visualiza
  en `client/public/naveteca/` — esta es la MISMA carpeta de assets que
  usa el juego para renderizar las naves, no una copia separada: cambiar
  un sprite o sonido ahí cambia lo que se ve/oye en el juego y en la
  naveteca a la vez. El juego ya usa el sprite real de la nave inicial
  (FHI Wren, `shuttle_01`) en vez del triángulo placeholder, con zumbido
  de motor que suena mientras se acelera.

## [v0.0.2]

### Añadido
- Control móvil: joystick virtual que aparece donde el jugador toca la
  pantalla, con zona muerta central.
- Botón fijo "MINAR" abajo a la derecha, independiente del joystick
  (soporte multitouch: un dedo mueve, otro mina a la vez).
- Número de versión visible en pantalla (arriba a la derecha) y dentro del
  menú de opciones.
- Menú de opciones (botón "☰" arriba a la izquierda) con un botón "Cerrar
  juego".
- Meta tags anticaché en `index.html` para el HTML shell.

### Corregido
- La nave no se movía visualmente en el cliente aunque el servidor sí
  actualizaba su posición. Causa: `player.onChange = () => {...}` se
  asignaba como propiedad en vez de usarse como método de suscripción
  (`player.onChange(() => {...})`), rompiendo el registro del listener de
  cambios de estado de Colyseum. Corregido.

## [v0.0.1] — Prototipo fase 0

### Añadido
- Servidor Colyseum (`server/`) con una room fija (`chunk`), sin sistema
  de descubrimiento todavía.
- Movimiento de nave sincronizado en tiempo real entre jugadores
  conectados a la misma room.
- Minado básico: asteroides fijos, extracción de recurso simple sin tipos
  todavía, inventario visible en pantalla.
- Cliente Phaser (`client/`) con cámara siguiendo a la nave del jugador.
- Despliegue: servidor en Render, cliente estático en GitHub Pages vía
  GitHub Actions.
