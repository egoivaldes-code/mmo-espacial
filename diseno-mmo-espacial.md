# [Nombre pendiente] — Documento de Diseño

> Documento vivo. Se amplía sesión a sesión. Última actualización: 15 agosto 2026.

## 1. Pitch

MMO espacial 2D con vista cenital, **100% sandbox**: no hay civilización
preexistente, todo lo construyen los jugadores. Universo único y persistente,
dividido en chunks (sectores), con exploración de frontera inexplorada y
dominio territorial por jugadores, corporaciones o alianzas. Referencia
principal: **Avorion** (minería por rareza, sectores en grid, territorio de
facciones, crafteo como núcleo). Referencia estructural: **EVE Online**
(seguridad tipo CONCORD, corporaciones/alianzas).

## 1.1 Premisa narrativa

Se descubre un agujero negro en la órbita de Júpiter que resulta ser un
puente de Einstein-Rosen (wormhole). Al otro lado hay un lugar inalcanzable
desde la Vía Láctea por medios convencionales: el panorama celestial (las
estrellas, todo) no coincide con nada del universo observable conocido. No
se sabe dónde están. La humanidad manda una fuerza de seguridad (tipo
CONCORD de EVE Online) al otro lado del wormhole para ayudar a los primeros
colonos/jugadores a asentarse — es la única facción con la que el jugador
puede jugar (raza jugable única: humana).

### 1.1.1 Los precursores y otras civilizaciones

Los wormholes no son un accidente ni algo exclusivo de la humanidad: fueron
creados por unos **seres muy superiores** (los "precursores"), con un
propósito que no se conoce — ni se pretende revelar del todo, es y debe
seguir siendo ambiguo (en la línea de los Forerunner de *Halo* o el "gran
filtro" de *Mass Effect*: un misterio que da contexto permanente sin
necesidad de una respuesta final y cerrada).

Como consecuencia, la humanidad **no es la única especie** que ha cruzado
uno de estos wormholes a este lugar: hay **otras razas y civilizaciones
distintas haciendo exactamente lo mismo**, colonizando sus propias zonas
del mismo espacio, cerca unas de otras. Son **facciones NPC**, no jugables
— el jugador siempre es humano, pero convive/compite/negocia en un
universo compartido con estas otras civilizaciones, lo cual da profundidad
al dominio territorial más allá de "corps de jugadores contra otras corps
de jugadores": puede haber territorio en disputa con facciones NPC enteras.

Las ruinas y anomalías precursoras (ver 5.1) son el rastro físico de estos
seres superiores — restos de tecnología o estructuras que ni humanos ni las
otras razas NPC terminan de entender del todo.

**Pendiente de definir:** cuántas facciones NPC no-humanas existen y cómo
se comportan (¿territoriales y hostiles por defecto, o hay margen para
diplomacia/comercio?), si hay diferencias de tecnología/estilo visual entre
ellas, si alguna es más hostil que otra según cercanía a su zona de
influencia.

**Decisión tomada:** no tienen zonas fijas reservadas en el mapa — están
**dispersas y se descubren** igual que el resto de la frontera (recursos,
ruinas, fauna). No hay "territorio de la civilización X" predefinido de
antemano; su presencia en un chunk es parte de lo que revela la
exploración, coherente con que el universo entero es desconocido incluso
para ellos.

## 2. Stack técnico

- **Cliente**: Phaser (HTML/JS)
- **Servidor de estado en tiempo real**: Colyseum
- **Persistencia / Auth**: Supabase
- **Cámara**: fija sobre la nave/personaje (sigue al jugador), vista cenital en ambos modos (vuelo y a pie)

## 3. Pilares de diseño

- **Exploración** — el mapa no está todo revelado; se descubre chunk a chunk.
- **Progresión** — minado/comercio → mejoras de nave → naves más grandes/mejores.
- **Riesgo escalonado** — cuanto más lejos del centro, más recompensa y más peligro.
- **Territorio** — el dominio de un chunk es visible, disputable y tiene dueño (jugador, corp o alianza).

## 4. Estructura del universo — zona de entrada y frontera

No hay anillos con lore de facción; la seguridad decae con la distancia al
**punto de entrada del wormhole**, no por una división administrativa
preexistente.

| Zona | Seguridad | PvP | Notas |
|---|---|---|---|
| Entrada (spawn) | Flota CONCORD activa | No / muy penalizado | Alrededor del wormhole. Varios puntos de spawn que rotan según carga de la zona (ver 4.1). |
| Zona intermedia | Vigilancia decreciente al alejarse | Posible, con consecuencias | Transición gradual, no un anillo fijo con nombre. |
| Frontera / espacio abierto | Sin ley | Total | Dominio territorial 100% de jugadores/corps/alianzas. Aquí vive todo el sandbox territorial. |
| Frontera inexplorada | N/A | N/A | Chunks vírgenes, revelados vía descubrimiento (ver sección 5). |

### 4.3 CONCORD — mecánica de respuesta

La seguridad no es una frontera dura (no hay una línea donde "aquí sí,
aquí no") sino un **gradiente continuo según distancia al wormhole de
entrada**:

- **Junto al wormhole**: respuesta instantánea ante cualquier agresión
  (disparar a otro jugador sin motivo, robar carga/mineral ajeno, destruir
  estructuras ajenas — cualquier acto agresivo activa la intervención).
- **A medida que te alejas**: la respuesta se vuelve más lenta y más
  débil — tarda más en llegar y la fuerza que manda es menor (más fácil de
  superar en número por un grupo organizado).
- **Pasado cierto punto**: CONCORD deja de responder por completo. No hay
  una distancia fija anunciada al jugador — se siente jugando, no se lee en
  un mapa con colores.

Esto significa que un grupo de jugadores organizado y numeroso puede, en
teoría, **imponerse a CONCORD por número** en las zonas donde su presencia
ya es débil — no son invencibles en todas partes, solo cerca del punto de
entrada.

**Pendiente de definir:** fórmula exacta de degradación (¿lineal con la
distancia, por zonas escalonadas, dependiente también del número de
atacantes?), qué manda CONCORD exactamente (naves, o algo más letal e
instantáneo tipo EVE), si hay reputación/flag que siga al jugador agresor
más allá del momento del ataque.

### 4.1 Spawn de jugadores nuevos

Los jugadores nuevos no aparecen todos en el mismo punto fijo: aparecen en
**varios puntos de entrada distintos alrededor del wormhole**, y el sistema
rota/asigna el punto de spawn según la carga de cada zona (para no
saturar una sola room de Colyseum con todos los jugadores nuevos del
servidor). Cada punto de spawn tiene su propia presencia CONCORD.

**Pendiente de definir:** cuántos puntos de spawn simultáneos, criterio
exacto de rotación (¿número de jugadores en la room? ¿tiempo?), si CONCORD
patrulla activamente o solo interviene si detecta agresión.

### 4.2 Estación hub inicial (a pie)

En el wormhole de llegada hay una **estación humana ya construida**, NPC,
levantada por la operación de colonización desde el sistema solar — es el
"hub" de inicio del juego. El jugador puede **bajar de la nave y caminar
por dentro de la estación**, también en vista cenital (estilo GTA2): un
segundo modo de juego además del vuelo espacial.

Dentro de la estación, a pie, el jugador puede:
- Interactuar socialmente con NPCs (lore, guía inicial)
- Comprar/vender equipo básico (vendors NPC) — esto resuelve el bootstrap
  del jugador nuevo (ver 8.1): la estación humana es la única fuente de
  equipo no fabricado por jugadores, coherente con la premisa narrativa
  (la trajeron los propios humanos, no es "loot" del mundo sandbox)
- Acceder a hangar y fabricación básica

**A futuro, las estaciones construidas por jugadores también serán
explorables a pie**, no solo el hub NPC inicial — el modo "a pie estilo
GTA2" es una mecánica transversal del juego, no algo exclusivo del tutorial.

**Decisión tomada:** el interior de una estación es una **instancia/room
separada** de Colyseum. El jugador vuela en su nave por el sector (cámara
fija sobre la nave), y al atracar/aterrizar en una estación hay una
**transición** que lo lleva a esa instancia interior — desde fuera, en el
sector, la estación solo se ve como un casco/estructura; lo de dentro
(pasillos, hangar, NPCs, otros jugadores a pie) vive en su propia room,
igual que un chunk pero a escala humana. Aplica tanto al hub NPC inicial
como a futuras estaciones construidas por jugadores.

**Pendiente de definir:** qué pasa con la nave mientras el jugador está
dentro (¿queda "aparcada" visible en el sector, o desaparece hasta que
sale?), si la transición tiene una animación/carga o es instantánea, cómo
se gestiona la instancia si varias personas atracan en la misma estación a
la vez (¿todas comparten la misma room interior, o hay límite de
capacidad?).

## 5. Sistema de chunks

- El universo es una grilla de coordenadas `(x, y)`, en la línea de Avorion.
- **Cada chunk = una Colyseum room.** Se instancia bajo demanda cuando entra
  el primer jugador, se destruye cuando sale el último (guardando su estado
  en Supabase antes de cerrar).
- Los chunks son grandes en **espacio** (scroll libre, miles de unidades),
  no en **densidad de entidades simultáneas** — el límite técnico real de
  Colyseum es cuántas entidades sincronizadas soporta una room sin degradar
  el tickrate, no el tamaño del mapa. Se gestiona con culling: solo se
  simula con detalle lo que está cerca de jugadores; el resto queda dormido.
- **Descubrimiento**: es global, no individual. Al revelarse un chunk queda
  marcado en una tabla de Supabase (`discovered_chunks`) y visible para
  todos los jugadores desde ese momento.
- **Puntos de salto**: pueden ser fijos (conocidos, entre sistemas ya
  descubiertos) o anomalías que solo aparecen escaneando cerca del borde de
  lo explorado — esto incentiva la exploración activa en vez de revelar el
  mapa de golpe.

**Pendiente de definir:** mecánica exacta de escaneo/detección de anomalías,
tamaño en unidades de un chunk, qué pasa con naves/estructuras si un chunk
se destruye sin jugadores dentro (¿se congela el estado o sigue simulándose
en segundo plano, ej. ataques a estructuras offline?).

### 5.1 Contenido de los chunks vírgenes

Cada chunk sin explorar puede combinar tres tipos de contenido (no son
mutuamente excluyentes — un mismo chunk puede tener las tres cosas):

- **Recursos minables** — asteroides con materiales de distinta rareza
  (más raros cuanto más lejos de la entrada, en la línea de Avorion).
- **Ruinas / anomalías precursoras** — restos de los seres superiores que
  crearon los wormholes (ver 1.1.1), con propósito desconocido y que ni
  humanos ni las demás civilizaciones NPC terminan de entender. Es el
  vehículo del misterio narrativo permanente ("quién hizo esto y para qué")
  y una fuente de loot/lore único, no repetible por minería normal.
- **Fauna espacial hostil** — vida alienígena que ataca, no es solo "otros
  jugadores" el peligro de la frontera.

**Pendiente de definir:** cómo se genera la mezcla de estos tres elementos
por chunk (¿tablas de rareza, biomas, aleatorio puro?), si las ruinas dan
pistas progresivas sobre el misterio central o son solo flavor/loot. El
misterio de los precursores está pensado para **no resolverse nunca del
todo** (ver 1.1.1) — evita que se agote como contenido una vez la
comunidad "lo resuelva".

## 6. Territorio y organizaciones

- Jerarquía: `jugador → corporación → alianza` (nombres provisionales).
- El dominio de un chunk en nullsec se marca físicamente con estructuras
  (tipo citadels de EVE / estaciones de Avorion).
- La propiedad puede ser de un jugador individual, una corporación o una
  alianza/coalición.

### 6.1 Corporaciones

- **Roles y permisos configurables**: no es solo "líder + miembros" — se
  puede definir quién dentro de la corp puede minar de las reservas
  comunes, construir/modificar estructuras, gastar de la tesorería, invitar
  o expulsar miembros, etc. Similar en espíritu a los roles de EVE Online.
- **Tesorería compartida**: la corporación tiene fondos propios en créditos
  (independientes de las cuentas personales de cada miembro), alimentados
  presumiblemente por cuotas, ventas de recursos comunes, o impuestos sobre
  actividad de miembros (a definir).
- **Fundar una corporación no es libre desde el minuto uno**: hay algún
  requisito de entrada — dado que no hay niveles de personaje (ver sección
  12), este requisito debe ser económico/social (coste en créditos,
  reputación, o similar), no de progresión de personaje. Evita spam de
  micro-corps vacías y le da peso a la decisión de fundar una.

**Pendiente de definir:** requisito exacto para fundar una corp (coste en
créditos, reputación, u otro criterio no ligado a nivel de personaje),
catálogo completo de permisos configurables, cómo se alimenta la tesorería
común, estructura de alianzas (¿es solo un grupo de corporaciones aliadas,
o tiene su propia tesorería/permisos como las corps?), límite de miembros
por corp o alianza.

### 6.2 Conquista y mantenimiento de territorio

**Pendiente de definir:** mecánica de conquista (¿asedio, ventana de
vulnerabilidad, timers como en EVE?), costes de mantener territorio
(¿upkeep periódico en créditos/recursos, o solo el riesgo de defenderlo?).

## 7. Arquitectura de datos (borrador)

**Supabase (persistente, autoridad global):**
- `players`, `corporations`, `alliances`
- `chunk_ownership` (qué chunk pertenece a quién)
- `discovered_chunks` (qué está revelado)
- Posición/inventario/estado de nave cuando el jugador no está en una room activa

**Colyseum (efímero, por chunk activo):**
- Estado en tiempo real de naves, proyectiles, asteroides, NPCs dentro de ese sector
- Se sincroniza contra Supabase al crear/destruir la room

## 8. Mecánicas

- Minado / recolección de recursos (rareza según distancia a la entrada, tipo Avorion)
- **Fabricación / crafteo — núcleo del juego desde el inicio.** Fuera de la
  estación hub NPC, todo lo que existe (naves, estructuras, mejoras) lo
  construyen los jugadores. Ver 8.1.
- **Modo a pie (estilo GTA2, cenital)** — dentro de estaciones (hub NPC
  inicial y, a futuro, estaciones de jugadores). Ver 4.2.
- Combate (incluye fauna alienígena hostil, no solo PvP)
- Comercio (mercados formales en estaciones con créditos, trato libre entre jugadores fuera de eso — ver sección 9)
- Progresión de nave / construcción de estructuras
- CONCORD como seguridad, no como dador de misiones tradicionales (a
  revisar más adelante)

### 8.2 Minado y recursos

Los recursos se organizan combinando dos ejes: **tipo** (minerales, gases,
componentes orgánicos, etc.) y **rareza** dentro de cada tipo (más raros
cuanto más lejos de la zona de entrada, en la línea de Avorion). No hay
restricción de zona por material del casco de la nave (a diferencia de
Avorion): el material afecta a **estadísticas y estética**, no bloquea
físicamente a qué zonas puede ir un jugador — el riesgo de adentrarse en la
frontera viene de CONCORD/fauna/otros jugadores, no de un límite técnico de
resistencia del casco.

**Pendiente de definir:** listado concreto de tipos de recursos y sus
niveles de rareza, si los gases/orgánicos tienen usos distintos a los
minerales (¿solo crafteo de módulos, o también consumibles/combustible?).

### 8.3 Construcción de naves

Sin decidir todavía si el diseño es libre por bloques/piezas (tipo Avorion
o Space Engineers, más complejo pero más profundo a largo plazo) o por
plantillas fijas mejorables con módulos (tipo EVE, más simple de
desarrollar y balancear). Es una decisión que puede esperar — afecta
mucho al alcance técnico y probablemente conviene decidirla cuando ya haya
un prototipo mínimo jugando con minado y combate básicos.

**Decisión tomada — clases de nave**: se adopta el sistema de clases de
EVE Online como escala de progresión: Shuttle → Frigate → Destroyer →
Cruiser → Battlecruiser → Battleship → Carrier → Dreadnought. Cada clase
sube en HP, carga y tripulación necesaria, y baja en velocidad — la
progresión natural del juego pasa por ir subiendo de clase, no solo de
equipo dentro de una misma nave.

**Fabricante — Fiji Heavy Industries (FHI)**: primer set de cascos base
del juego, uno de los astilleros humanos que trajo planos de construcción
al otro lado del wormhole (encaja con la premisa de 4.2: la estación hub
inicial vende equipo básico porque lo trajeron los propios humanos). Los
jugadores fabrican naves a partir de estos planos con licencia FHI; a
futuro pueden aparecer otros fabricantes (humanos o de las civilizaciones
NPC no-humanas de 1.1.1) con estética y estadísticas propias.

Catálogo actual: 41 modelos de casco (6 lanzaderas, 6 fragatas, 9
destructores, 6 cruceros, 5 cruceroacorazados, 5 acorazados, 3 portanaves,
1 dreadnought), con sprite 2D, estadísticas base y sonido de motor
(placeholder, pendiente de audio final) para cada uno. Los assets viven en
`client/public/ships/` (sprites, sonidos, `ships.json`) — es la misma
carpeta que usa el propio juego para renderizar las naves, no una copia
de referencia separada: cambiar un archivo ahí cambia el juego. Se
visualiza con la herramienta `client/public/naveteca/`. Por ahora todo el
mundo usa la misma nave inicial (FHI Wren, lanzadera) — selección/crafteo
real de nave queda para cuando exista el sistema de fabricación (8.3).

**Pendiente de definir:** armamento y módulos equipables por clase,
diferencias de rol dentro de una misma clase (algunos modelos priorizan
velocidad, otros tanque — ya reflejado ligeramente en las estadísticas
generadas, pero sin mecánica de módulos real todavía), coste de
fabricación de cada clase en recursos.

### 8.4 Combate

**Apuntado**: sistema híbrido — armas de disparo directo (apuntar y
disparar, más habilidad manual, más "arcade") combinadas con armas de
bloqueo/lock (se marca un objetivo y el arma dispara sola mientras el lock
se mantiene, más táctico, tipo EVE). Da variedad de builds/naves según qué
tipo de arma prioricen.

**Pérdida al morir — es punitivo de verdad**: al morir en combate se puede
perder la **nave entera**, no solo la carga transportada. Esto tiene
implicaciones de diseño importantes a tener en cuenta más adelante:
- El coste de fabricar una nave debe estar calibrado contra el riesgo real
  de perderla — si es muy cara de construir y fácil de perder, la fricción
  puede ahuyentar a jugadores nuevos de salir de zona segura.
- Refuerza que la zona de entrada (con CONCORD) sea un espacio real de
  aprendizaje antes de arriesgar naves construidas con esfuerzo.
- Puede (a definir) generar un mercado de "naves desechables" baratas para
  minería/combate arriesgado en frontera, frente a naves de alto valor
  reservadas a zonas más seguras — decisión de balance, no cerrada aún.

**Pendiente de definir:** si queda algo recuperable tras perder la nave
(¿un pod/cápsula de escape, como en EVE, o el jugador simplemente
respawnea en la estación más cercana sin nada?), si hay seguro/reembolso
parcial, cómo funciona el looteo de los restos de una nave destruida por
otros jugadores.



### 8.5 Bootstrap del jugador nuevo

Resuelto en gran parte por la estación hub (ver 4.2): el jugador nuevo
empieza en la estación humana, donde puede conseguir equipo básico de
vendors NPC y acceder a fabricación/hangar antes de salir al espacio
abierto. Esto le da sentido narrativo a por qué existe equipo "no
fabricado por jugadores" sin romper la premisa sandbox del resto del
universo.

**Pendiente de definir:** catálogo exacto de lo que vende la estación hub
(¿solo lo mínimo para sobrevivir, o también naves completas?), si hay más
de un hub NPC o solo uno junto al wormhole de llegada.

## 9. Comercio

- **Mercados formales**: viven dentro de las estaciones (el hub NPC inicial
  y, a futuro, estaciones construidas por jugadores). Usan **créditos**
  como moneda única, con órdenes de compra/venta tipo EVE (asincrónico: se
  publica una orden y se resuelve cuando otro jugador la acepta, no hace
  falta que ambos estén conectados a la vez).
- **Cada estación tiene su propio mercado local**, no hay un mercado
  global único compartido — los precios y la disponibilidad pueden variar
  de una estación a otra según qué se produce/consume cerca. Esto le da
  sentido económico a las rutas comerciales entre estaciones distintas.
- **Trato directo entre jugadores**: fuera del mercado formal, los
  jugadores pueden intercambiar lo que quieran entre ellos sin
  restricciones — trueque, acuerdos informales, regalos, lo que negocien
  cara a cara (o nave a nave) sin pasar por una estación.

**Pendiente de definir:** cómo se originan los créditos en la economía
(¿misiones, venta a NPC, o solo circulan entre jugadores desde el
principio?), si hay algún mecanismo de transporte de mercancía entre
mercados de distintas estaciones (¿un jugador tiene que llevarla
físicamente, o hay logística automatizada?), impuestos/comisiones del
mercado y quién se los queda (¿el dueño de la estación, si es de
jugadores?).

## 10. Referencias

- **Avorion** — sectores en grid, minería por rareza, territorio de facciones, crafteo como núcleo
- **EVE Online** — seguridad tipo CONCORD, corporaciones/alianzas
- **GTA2** — vista cenital para el modo a pie dentro de estaciones
- **Halo (Forerunners) / Mass Effect (Gran Filtro)** — referencia de tono para el misterio de los precursores: presencia permanente, propósito nunca del todo resuelto

## 11. Preguntas abiertas (registro)

- Tamaño exacto de un chunk en unidades de juego
- Mecánica de escaneo para encontrar puntos de salto
- Qué ocurre con un chunk sin jugadores presentes (¿simulación offline?)
- Reglas de conquista territorial
- Cuántos puntos de spawn simultáneos y criterio de rotación por carga
- Si CONCORD patrulla activamente o solo interviene ante agresión
- Cómo se genera la mezcla recursos/ruinas/fauna por chunk
- Si las ruinas cuentan una progresión de misterio o son solo flavor/loot
- Catálogo exacto de la tienda NPC del hub inicial
- Qué pasa con la nave mientras el jugador está dentro de una estación
- Si la transición nave→estación tiene carga/animación o es instantánea
- Capacidad de la instancia interior de una estación (¿todos comparten la
  misma room, o hay límite y se crean varias?)
- Cuántas facciones NPC no-humanas existen y cómo se comportan
  (¿territoriales/hostiles por defecto, o hay diplomacia/comercio posible?)
- Diferencias visuales/tecnológicas entre las distintas civilizaciones NPC
- Si estas facciones pueden establecer territorio propio *a partir* de
  jugarse la partida (p. ej. expandirse tras ser descubiertas), o se quedan
  fijas donde aparecen
- Fórmula exacta de degradación de la respuesta de CONCORD con la distancia
- Qué manda CONCORD exactamente al intervenir (naves normales, algo más letal/instantáneo)
- Si queda reputación/flag en el jugador agresor tras el ataque
- Si hay pod/cápsula de escape al perder la nave, o respawn sin nada
- Si existe seguro/reembolso parcial por pérdida de nave
- Cómo funciona el looteo de restos de una nave destruida
- Calibración coste de fabricación vs. riesgo real de pérdida (naves
  "desechables" para frontera vs. naves de alto valor en zona segura)
- Cómo se originan los créditos en la economía (misiones, venta a NPC, o
  solo circulan entre jugadores)
- Mecanismo de transporte de mercancía entre mercados de distintas
  estaciones (físico vs. logística automatizada)
- Impuestos/comisiones del mercado y quién se los queda

## 12. Progresión del jugador

**Sin sistema de niveles ni experiencia de personaje.** No hay skills que
entrenar ni XP que subir — toda la progresión viene del **equipo y la
nave**: mejores materiales, mejores módulos, naves más grandes o
especializadas. Un jugador nuevo con la nave adecuada puede ser tan
competente como un veterano; lo que cambia con el tiempo jugado es el
*acceso* a mejor equipo (por recursos, créditos, conocimiento del mapa),
no una ventaja de personaje inherente.

**Sin especialización forzada de rol.** No hay clases ni árboles de
habilidad que obliguen a elegir "soy minero" o "soy de combate" de forma
permanente — con el tiempo, cualquier jugador puede llegar a dominarlo
todo, limitado únicamente por qué naves/equipo tiene en cada momento (una
nave de combate no mina bien, una minera no combate bien — la
especialización existe a nivel de **nave**, no de jugador).

Esto refuerza que el foco de progresión a largo plazo esté en la economía,
la fabricación y el territorio (secciones 6, 8 y 9), no en un sistema de
niveles paralelo.

**Pendiente de definir:** si existe algún tipo de reputación o historial
(no XP, pero sí "cuánto confía CONCORD/una facción NPC en ti", por
ejemplo) que sea un tracking de comportamiento más que de poder.

## 13. Roadmap — prototipo mínimo jugable

Objetivo: validar el stack completo (Phaser + Colyseum + Supabase) con la
pieza más pequeña de gameplay real, no una demo técnica aislada.

**Fase 0 — incluido:**
1. Movimiento de nave sincronizado en tiempo real: un jugador se conecta,
   entra en una room de Colyseum (un único chunk fijo, sin sistema de
   descubrimiento todavía), mueve su nave; otro jugador conectado lo ve.
2. Minado básico: asteroides fijos en ese chunk, extracción de un recurso
   simple, inventario persistido en Supabase.
3. Combate mínimo: disparo directo simple (sin el sistema híbrido de
   bloqueo todavía), daño y destrucción de nave, sin pérdida de items aún.
4. Un único punto de entrada al chunk, sin gradiente de CONCORD todavía.

**Fuera del prototipo (fase 1 en adelante):** modo a pie/estaciones,
crafteo real de naves, sistema de chunks dinámico y descubrimiento,
territorio/corporaciones, facciones NPC no-humanas, precursores/ruinas,
gradiente de CONCORD, pérdida de nave al morir.

**Pendiente de definir:** orden exacto de fase 1 en adelante (¿primero
crafteo, primero el sistema de chunks dinámico, o primero el modo a pie?).
