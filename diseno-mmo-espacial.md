# [Nombre pendiente] — Documento de Diseño

> Documento vivo. Se amplía sesión a sesión. Última actualización: 17 agosto 2026.

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

#### 1.1.2 Cuántas facciones y cómo se comportan

**Decisión: tres facciones definidas en el lore, una implementada primero.**

El número está limitado por arte, no por diseño. Cada facción cuesta línea
de naves, arte de estación, IA, tabla de botín y vía de reputación propia —
y la naveteca humana ya lleva 41 naves FHI para dar idea de la escala. Tres
es el mínimo para que existan rivalidades entre ellas (con dos solo hay un
eje) sin que el coste de arte se dispare. Se escriben las tres desde el
principio para que el universo se sienta poblado, pero **el modelo de datos
se hace para N y se construye una entera antes de empezar la segunda**.

Cada una define una **forma distinta de interactuar**, no solo un aspecto
distinto:

| Facción | Postura | Función en el juego |
|---|---|---|
| **Territorial** | Hostil dentro de su radio de influencia, indiferente fuera | El muro: bloquea zonas de botín alto. Peligro puro |
| **Mercante** | Neutral por defecto, con estaciones atracables | La zanahoria: vende tecnología no crafteable, con acceso limitado por reputación |
| **Errante** | Sin territorio fijo, flotas que se desplazan | El clima: no se puede planificar ni farmear con comodidad |

Hay **una rivalidad** entre la territorial y la mercante: subir reputación
con una la baja con la otra. La errante queda fuera del eje, para que no
todo el sistema social sea una única barra con dos extremos.

#### 1.1.3 Diferencias visuales y tecnológicas

Regla: **una silueta, una paleta y un rasgo mecánico** por facción, no
árboles tecnológicos completos. En un top-down 2D con zoom variable (5.7),
lo que hace falta es reconocer de un vistazo quién está disparando.

- **Territorial** — angular y pesada, paleta oscura, mucho blindaje y poca
  velocidad.
- **Mercante** — formas redondeadas y luminosas, escudos y apoyo antes que
  daño bruto.
- **Errante** — siluetas asimétricas u orgánicas, muy rápidas, movimiento
  errático.

#### 1.1.4 ¿Se expanden?

**Decisión: la presión va en un solo sentido — los jugadores empujan, las
facciones no avanzan solas.**

Una expansión real de imperios NPC exigiría simulación de mundo en segundo
plano, que es justo lo que 5.4.1 prohíbe (y es, por sí sola, una
funcionalidad de la escala de *Stellaris*). En su lugar:

- Cada chunk tiene un valor de **influencia** de facción derivado de la
  semilla (5.5.1).
- Destruir sus estructuras y flotas **baja esa influencia**, y la bajada se
  guarda como delta en Supabase. Los jugadores pueden expulsar a una
  facción de una zona.
- La influencia **se regenera con el tiempo**, calculada de forma perezosa
  al despertar el chunk a partir del último timestamp — mismo patrón que la
  regeneración de recursos (5.4.1). Si dejas de presionar, vuelven.

Coste de implementación: prácticamente nulo. Sensación resultante: bastante
parecida a la de un mundo que reacciona.

**Pendiente de definir:** nombres y lore concreto de las tres; cuál se
implementa primero (la territorial es la más barata: no necesita interiores
de estación atracables ni interfaz de comercio); ritmo de regeneración de
influencia; si la reputación con facciones NPC es independiente de la de
CONCORD (4.3.3) o comparten sistema.

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

### 4.1 Spawn de jugadores nuevos

Los jugadores nuevos no aparecen todos en el mismo punto fijo: aparecen en
**varios puntos de entrada distintos alrededor del wormhole**, y el sistema
rota/asigna el punto de spawn según la carga de cada zona (para no
saturar una sola room de Colyseum con todos los jugadores nuevos del
servidor). Cada punto de spawn tiene su propia presencia CONCORD.

#### 4.1.1 Puntos de spawn — cuántos y cómo rotan

**Decisión: 3 puntos activos, rotación por número de jugadores, no por
tiempo.** Rotar por tiempo metería a gente en zonas vacías o las
saturaría según la hora sin motivo real; rotar por carga es la misma
lógica que ya rige toda la escalera de 5.4 — la ocupación es la señal, no
el reloj.

- **3 puntos simultáneos** — el mínimo para repartir sin fragmentar en
  exceso el onboarding, y coherente con que solo hay una facción humana
  (1.1.2): tres puntos NPC humanos, no tres por facción.
- **Umbral de asignación: ~15 jugadores por punto.** Por debajo, todo
  spawn nuevo va al punto con menos gente; al llegar al umbral, el
  siguiente jugador se reasigna al próximo punto con hueco. Mismo
  disparador que la tabla de 5.4, así que se recalibran juntos.
- Cada punto es su **propia room** de Colyseum, con su propia presencia
  CONCORD — no son sub-zonas de una room compartida. Es lo que evita
  saturar una sola room con todo el onboarding del servidor.
- **No rotan geográficamente.** Son 3 ubicaciones fijas en el chunk de
  entrada, no puntos que se mueven. "Rotar" es a qué punto fijo se asigna
  al jugador nuevo, no que los puntos cambien de sitio.

**Pendiente de definir:** si el umbral de 15 se ajusta por telemetría real
una vez haya jugadores; si un jugador puede elegir manualmente su punto de
spawn (p. ej. para reunirse con amigos que ya están dentro) o es siempre
automático.

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

#### 4.2.1 La nave mientras estás a pie — depende del tamaño de estación

**Decisión:** no hay una regla única. El tamaño de la estación determina
cuán segura queda tu nave, y eso convierte "dónde atraco" en una decisión
táctica real en vez de un trámite.

| Tamaño | Dónde queda la nave | Seguridad |
|---|---|---|
| Pequeña | Fuera, a la vista en el chunk | Vulnerable — atracar aquí es asumir riesgo |
| Mediana | Fuera, en el perímetro de la estación | Protegida parcialmente |
| Grande | Dentro, en hangar interior | Invulnerable, no existe como objeto en el chunk |

Consecuencias de diseño que esto abre:

- Las estaciones grandes son **puerto seguro** de verdad. Eso las convierte
  en objetivo estratégico y da sentido a construirlas en territorio propio
  (sección 6).
- En la frontera, si solo hay estaciones pequeñas, bajar a pie es
  arriesgado — coherente con el gradiente de riesgo del resto del juego.
- **Desconexión:** la vulnerabilidad aplica solo con el jugador conectado.
  Al desconectar, la nave pasa a estado guardado en esa estación sea cual
  sea su tamaño. Es lo coherente con 5.4.1 (nada se simula sin jugadores
  delante) y evita el destrozo de reputación que supone perder la nave
  estando offline.

**Pendiente de definir:** qué clasifica una estación como pequeña, mediana
o grande (¿coste, módulos, tamaño construido?); qué significa exactamente
"protegida parcialmente" en las medianas — la propuesta es **torretas de
la propia estructura** que disparan al agresor, en vez de una reducción
abstracta de daño: es legible, se puede equipar/mejorar, y un grupo
suficientemente grande puede superarlas (coherente con la filosofía del
gradiente de CONCORD, 4.3). Falta también decidir qué pasa con las naves
guardadas dentro de una estación grande si esa estación es destruida o
conquistada (¿se pierden, hay custodia de activos tipo EVE?).

#### 4.2.2 Transición y capacidad

**Transición nave → estación: fundido corto (~1s).** Sin secuencia de
atraque jugable ni pantalla de carga explícita. Matiz técnico: el fundido
de salida dura ~1s fijo, pero la entrada **espera a que el join a la room
interior se complete**. Si tarda más de la cuenta (Render free tier
despertando, ver 14.1), se mantiene el fundido con un texto discreto de
"atracando" en vez de dejar la pantalla congelada sin explicación.

**Capacidad: una sola room por estación, con cola si se llena.** No se
instancian copias del interior. La cola no bloquea al jugador en una
pantalla de espera: sigue volando en el chunk con un indicador de
"solicitando acceso" y entra cuando se libera plaza.

**Pendiente de definir:** capacidad numérica de una room interior (empezar
por un valor de trabajo e instrumentar, igual que en 5.4). Y una excepción
a valorar: el **hub inicial** es donde aparece todo jugador nuevo (4.1);
si se llena y encola, el bloqueo cae justo en el peor momento posible del
onboarding. Como el hub no tiene territorio en juego, entra dentro de lo
que 5.4 sí permite instanciar — conviene decidir si se le aplica esa
excepción.

#### 4.2.3 Clases de estación

**Decisión: tres clases discretas por plano de construcción**, no tamaño
libre ni derivado del número de módulos.

| Clase | Nave al bajar a pie | Interior | Rol |
|---|---|---|---|
| **Puesto** (pequeña) | Fuera, vulnerable | Mínimo: hangar + un par de salas | Avanzadilla barata, desechable, frontera |
| **Estación** (mediana) | Fuera, con torretas | Medio | Base operativa de un grupo pequeño |
| **Bastión** (grande) | Dentro, invulnerable | Amplio, varias zonas | Puerto seguro y ancla de territorio |

El motivo de que sean discretas y no libres es técnico y decisivo: **cada
interior es una room con un mapa que hay que autorizar y construir**. Con
tres clases se diseñan tres interiores; con tamaño libre habría que generar
interiores proceduralmente para cada estructura del universo, que es un
proyecto en sí mismo.

La sensación sandbox se mantiene con **módulos como mejoras dentro de la
clase** (torretas, mercado, refinería, capacidad de hangar, fabricación),
no como algo que cambie la clase. Una estación mediana bien equipada puede
ser más útil que un bastión pelado, pero nunca dará hangar interior.

El hub NPC inicial (4.2) es, por definición, un bastión.

**Pendiente de definir:** si un puesto puede *ascender* a estación pagando
la diferencia, o hay que construir una nueva desde cero (lo primero es más
amable, lo segundo hace que la elección inicial pese más).

#### 4.2.4 Pérdida de una estación — custodia de activos

Qué pasa con las naves y la carga guardadas dentro cuando una estación es
destruida o conquistada:

- **Una parte se pierde como botín.** Un porcentaje de lo almacenado (valor
  de partida a calibrar, del orden del 20%) cae como restos saqueables por
  el atacante. Sin esto, atacar una estación no compensa y nadie ataca.
- **El resto entra en custodia.** Reaparece en la estación amiga o NPC más
  cercana tras una demora en tiempo real y pagando una comisión. No se
  pierde, pero recuperarlo cuesta tiempo y dinero.
- **La custodia es dato con fecha**, no simulación: una fila en Supabase
  con destino y timestamp de disponibilidad, evaluada al abrirla (5.4.1).

Esto es viable *porque* la destrucción de una estación no es instantánea:
con ventanas de vulnerabilidad y timers de refuerzo (ver 6.2 y 5.4.1) el
defensor tiene aviso y ventana para evacuar. Perderlo todo sin previo aviso
sería otra cosa; perder un 20% tras haber tenido oportunidad de sacar lo
importante es riesgo asumible.

Efecto lateral útil: la comisión de custodia es un **sumidero de créditos**
natural, que ayuda con la pregunta abierta de la economía (sección 9).

**Pendiente de definir:** porcentaje exacto de botín, duración de la demora
y cuantía de la comisión; si la custodia aplica igual en conquista pacífica
(cambio de dueño sin destruir) que en destrucción total.

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

#### 4.3.1 Fórmula de degradación

**La distancia se mide en saltos, no en unidades.** El universo son chunks
discretos conectados por puntos de salto (5.1): dos coordenadas contiguas
de la grilla pueden no estar conectadas entre sí. Lo que importa es
`d` = número de saltos desde el chunk del wormhole de entrada.

Dos variables degradan de forma distinta, y a propósito:

| Variable | Curva | Valores de partida |
|---|---|---|
| **Retardo** de llegada | Lineal con `d` | `2s + 8s × d` |
| **Fuerza** enviada | Geométrica con `d` | `F0 × k^d`, con `F0` = 8 naves y `k` = 0.6 |

Con esos valores la fuerza cae 8 → 4.8 → 2.9 → 1.7 → 1.0 → 0.6, es decir
**CONCORD deja de responder alrededor del quinto salto**, sin que en ningún
momento se le anuncie al jugador dónde está esa línea. El retardo lineal se
percibe como "la ayuda viene, pero tarda"; la caída geométrica de la fuerza
hace que la burbuja segura tenga un borde práctico nítido aunque no
declarado. Todo el radio de seguridad del juego se calibra con dos números,
`F0` y `k`.

**La respuesta no escala con el número de atacantes.** Es deliberado: si
CONCORD siempre iguala a quien agrede, es invencible en todas partes y se
rompe la premisa ya tomada de que un grupo organizado puede superarla. Con
fuerza fija por distancia, un grupo puede *calcular* cuántas naves necesita
— y eso es contenido emergente, no un fallo.

#### 4.3.2 Qué manda CONCORD

**Naves NPC reales que llegan, combaten y pueden ser destruidas.** No un
golpe instantáneo e inevitable tipo EVE. Esto no es preferencia estética:
viene forzado por la decisión ya tomada de que CONCORD es superable por
número. Un instakill no se puede superar por número, solo evitar.

Ventaja práctica: reutiliza el sistema de combate existente (8.4) en vez de
exigir una mecánica aparte.

**Nota de rendimiento:** las naves de CONCORD son entidades NPC dentro de
la room, justo lo que la escalera de degradación de 5.4 intenta limitar. Un
tumulto grande en un chunk lleno es el peor caso posible. Hace falta un
**tope absoluto de naves CONCORD simultáneas por room**, independiente de
lo que diga la fórmula.

#### 4.3.3 Flag y reputación

Dos capas, con horizontes temporales distintos:

- **Flag de combate** — corto, del orden de minutos. Se activa al cometer
  un acto agresivo. Mientras dura: CONCORD y las torretas de estructuras
  (4.2.1) disparan a la vista, y no se puede atracar en estaciones NPC. Se
  enfría solo. Implementado como timestamp (5.4.1), no como tick.
- **Reputación** — persistente. Baja rápido al agredir y sube muy despacio.
  Efectos: precios y acceso en el hub NPC (4.2), y **pasado cierto umbral
  el jugador es proscrito**: CONCORD le dispara sin necesidad de que agreda,
  con lo que la zona de entrada deja de ser habitable para él.

La reputación tiene que ser **recuperable, pero lentamente**. Si es
irreversible es un baneo encubierto; si se recupera fácil no significa
nada.

Efecto emergente que conviene aceptar como diseño y no como problema: el
umbral de proscrito **empuja a los agresores reincidentes hacia la
frontera**, generando de forma natural una población de forajidos en el
exterior sin necesidad de facciones asignadas.

#### 4.3.4 CONCORD no patrulla

**Decisión:** CONCORD solo responde a agresiones; no hay patrullas
recorriendo chunks. Motivos: unas patrullas permanentes serían entidades
NPC ardiendo CPU en cada chunk de la zona de entrada, justo contra 5.4; y
además hacen que la zona segura se sienta *vigilada* en vez de
*cubierta*, que es un tono distinto del que busca el juego.

Única excepción: el chunk del hub tiene presencia estática visible, como
ambientación y señal de que ahí la respuesta es inmediata.

**Pendiente de definir:** calibración fina de `F0`, `k` y el retardo con
jugadores reales; qué clase de naves manda CONCORD y si varía con `d`;
duración exacta del flag de combate; umbral de proscrito y ritmo de
recuperación de reputación; si robar carga pesa igual que disparar.

## 5. Sistema de chunks

### 5.1 Modelo espacial — sistemas discretos, no mosaico continuo

**Decisión:** la grilla `(x, y)` es **metadato del mapa**, no una superficie
jugable continua. Cada chunk es un espacio cerrado del que se sale por un
punto de salto; no se cruza el borde navegando.

Razones:

- **El borde es lo caro.** En un mosaico continuo, un jugador cerca del
  límite tendría que ver a los del chunk vecino. Eso obliga a replicar
  entidades entre rooms (proxies fantasma, sincronía room↔room, autoridad
  ambigua sobre quién simula un proyectil que cruza) o a poner una pared
  invisible — y con la pared ya no hay continuidad, con lo que no se gana
  nada frente a un salto explícito. EVE usa puertas exactamente por esto.
- **Fragmentar va contra el objetivo de población.** Las rooms de Colyseum
  son objetos dentro del mismo proceso Node: 40 rooms con 2 jugadores
  rinden peor que 4 con 20 (cada room paga su coste fijo de simulation
  loop, diffing y encoding) y además el juego *parece* vacío. Con población
  baja, concentrar es rendimiento **y** sensación de mundo vivo.

La grilla no se pierde: sigue dando coordenadas reales para el mapa
estelar, cálculo de distancias, semillas de generación procedural y el
gradiente de CONCORD (ver 4.3). Lo que cambia es que el espacio entre
chunks no es transitable a motor — es un salto.

### 5.2 Granularidad — qué merece room propia

Criterio: se separa en room propia cuando **la simulación es distinta**, no
cuando el espacio es distinto.

| Elemento | ¿Room propia? | Motivo |
|---|---|---|
| Chunk / sistema espacial | Sí, 1:1 | Unidad base de simulación |
| Interior de estación (a pie) | Sí | Otro tickrate, otra física, pocas entidades → barato, y saca jugadores del sim espacial |
| Planeta, cinturón de asteroides, ruina precursora | No | Misma simulación y mismo espacio: son POIs *dentro* de la room del chunk |

### 5.3 Ciclo de vida de las rooms

- Se instancia bajo demanda al entrar el primer jugador.
- **No se destruye al salir el último.** Se aplica histéresis: `autoDispose`
  desactivado y temporizador propio de **3 minutos**. Sin esto, dos
  jugadores cruzándose en un punto de salto provocan un ciclo
  crear → volcar a Supabase → destruir → recrear que cuesta más que
  mantener la room viva.
- **El volcado a Supabase no espera al temporizador.** Se persiste en el
  momento en que la room se queda vacía. Motivo: en Render free tier el
  servicio entero se duerme por inactividad y puede llevarse por delante
  una room dormida sin avisar; la histéresis solo sirve para no recrear el
  objeto en memoria, nunca como ventana de persistencia.
- Mientras está vacía, la room **duerme**: simulation interval parado del
  todo (no reducido). Una room dormida es prácticamente gratis.
- Al expirar el temporizador, se destruye. El estado ya está guardado.

### 5.4 Carga: degradar, no instanciar

**Decisión:** no se crean copias de un chunk lleno. Instanciar espacio
disputable rompe el sandbox territorial — si un chunk con 150 jugadores se
parte en dos, bloquear un punto de salto deja de significar nada, y lo
mismo con emboscadas y asedios. Todo el dominio de territorio (sección 6)
depende de que **haya un solo lugar físico**. EVE prefiere degradar el
tiempo antes que duplicar el espacio, por esta razón exacta.

Instanciar sí es legítimo donde no hay territorio en juego: interiores de
estación, misiones cerradas, anomalías personales.

Escalera de degradación cuando un chunk satura, en este orden:

1. **Bajar `patchRate` progresivamente** con la ocupación. Requiere primero
   **desacoplar simulación de patch**: hoy `TICK_RATE = 20` hace de las dos
   cosas. La simulación se queda fija en 20 Hz y el patch arranca en 15.
   Con la interpolación de 5.7 apenas se nota y es donde más CPU se
   recupera.
2. **Estrechar el radio de AoI** (área de interés): con 150 naves alrededor
   no hace falta ver a 3000 unidades.
3. **Congelar lo no crítico**: asteroides y NPCs pasan a dormidos; solo
   naves y proyectiles siguen a tick completo.
4. **Cola en el punto de salto**, presentada de forma diegética
   ("esperando autorización de salto"), no como error.

Valores de partida, por ocupación de la room:

| Jugadores | `patchRate` | Radio AoI | Extra |
|---|---|---|---|
| ≤ 20 | 15 Hz | 3000 u | — |
| 21-50 | 12 Hz | 2000 u | — |
| 51-100 | 10 Hz | 1200 u | Asteroides y NPC dormidos fuera de AoI |
| > 100 | 8 Hz | 900 u | Cola en el punto de salto |

Son valores de arranque, no definitivos: hay que **instrumentar el tiempo
real de tick** del servidor y recalibrar con datos. El número de jugadores
es el disparador porque es simple y predecible, pero el coste real depende
también del número de entidades activas.

**Nota técnica:** partir una room en dos solo aporta CPU si se puede crear
en **otro proceso u otra máquina**. En el hosting actual (Render free tier,
un único proceso Node — ver 14.1) no la aporta: añade overhead. El escalado
real por rooms exige multi-proceso + proxy, y eso implica salir del free
tier. Hasta entonces las palancas son AoI y `patchRate`, no el número de
rooms.

**Filtrado por interés — decisión: migrar a Colyseum 0.16 antes de
construir el AoI.** El servidor usa hoy `0.15.x` con `@colyseus/schema`
2.x, donde el filtrado por cliente son decoradores `@filter`, evaluados por
cliente y por campo — justo lo que interesa que sea barato. Construir el
AoI sobre 0.15 significaría rehacerlo al migrar. La migración se hace como
**bump aislado** (`v0.1`, sin ningún otro cambio dentro), para que si algo
se rompe se sepa exactamente qué lo rompió.

### 5.4.1 Estado offline — todo es dato con fecha, no simulación

**Regla general: nada se simula en segundo plano.** Un chunk dormido está
congelado; su estado se recalcula al despertar a partir de marcas de tiempo
guardadas en Supabase.

- **Ataques a estructuras offline:** la pregunta se disuelve sola. Si
  alguien ataca una estructura, ese alguien está dentro del chunk, luego la
  room existe y está viva. No hay caso "combate en chunk vacío".
- **Asedios largos / timers de refuerzo** (tipo EVE): no requieren
  simulación. Se guardan como timestamps (cuándo empezó, cuándo vence la
  ventana de vulnerabilidad) y el resultado se evalúa al cargar la room.
- **Regeneración de recursos:** tiempo transcurrido × tasa, calculado en el
  momento de despertar el chunk.

Esto vale también como criterio para mecánicas futuras: si algo tiene que
"ocurrir" sin jugadores delante, se modela como fecha y evaluación
perezosa, nunca como tick en segundo plano.

### 5.5 Descubrimiento y puntos de salto

- **Descubrimiento**: es global, no individual. Al revelarse un chunk queda
  marcado en una tabla de Supabase (`discovered_chunks`) y visible para
  todos los jugadores desde ese momento.
- **Puntos de salto**: pueden ser fijos (conocidos, entre chunks ya
  descubiertos) o anomalías que solo aparecen escaneando cerca del borde de
  lo explorado — esto incentiva la exploración activa en vez de revelar el
  mapa de golpe.
- Los chunks son grandes en **espacio** (scroll libre, miles de unidades),
  no en **densidad de entidades simultáneas**. El límite técnico real es
  cuántas entidades sincronizadas soporta una room sin degradar el
  tickrate. Se gestiona con culling: solo se simula con detalle lo que está
  cerca de jugadores; el resto queda dormido.

#### 5.5.1 Universo determinista por semilla

**Decisión previa y necesaria:** el contenido de un chunk no se genera al
descubrirlo — se **deriva de una semilla global + sus coordenadas
`(x, y)`**. El chunk existe matemáticamente desde el día uno; descubrirlo
solo lo revela.

Por qué no hay alternativa razonable:

- Dos jugadores escaneando en la misma dirección tienen que encontrar lo
  mismo. Con generación en el momento del descubrimiento, el resultado
  dependería de quién llegó primero.
- No hay que guardar en Supabase los chunks no descubiertos: son función
  pura de la semilla. Solo se persisten los **deltas** (asteroides ya
  minados, estructuras construidas, propiedad, nombre).
- Es la misma filosofía de 5.4.1: evaluación perezosa a partir de un dato
  fijo, en vez de estado precalculado y almacenado.

#### 5.5.2 Escaneo — cómo se encuentran los puntos de salto

**Mecánica: pulso direccional y triangulación.** Un solo botón, pensado
para funcionar igual en teclado y en táctil (ver 13):

1. La nave lleva un **módulo de escáner** que ocupa slot. Ese es el coste
   real: quien explora renuncia a armas o a minería, lo que hace del
   explorador un rol especializado y vulnerable — bueno para el sandbox.
2. Al pulsar, emite un pulso con cooldown. Devuelve **dirección y distancia
   aproximada** de la firma no descubierta más cercana del chunk, dibujada
   como arco/blip en el HUD. Nunca una posición exacta.
3. El jugador se desplaza y vuelve a pulsar: los arcos se cortan y la
   posición se estrecha. Es triangulación clásica, sin minijuego ni UI
   propia.
4. Tras varios pulsos acertados la firma **se estabiliza** y el punto de
   salto pasa a ser un objeto permanente y visible del chunk **para todos**
   (el descubrimiento es global, ver 5.5).

Dos reglas que le dan sentido al conjunto:

- **La dificultad de la firma escala con la distancia a la entrada.** Los
  chunks profundos exigen mejores módulos de escáner. Da una razón concreta
  de progresión que no es "más daño".
- **No todos los chunks tienen salida sin descubrir.** Hay callejones sin
  salida. Sin esto la frontera se expande de forma trivial e infinita y
  deja de sentirse como frontera.

**Recompensa al descubridor: el nombre del chunk.** Quien estabiliza el
punto de salto bautiza el chunk de destino, y ese nombre queda en el mapa
para todos, con su autoría. Es barato de implementar, no desequilibra nada
y genera lore de comunidad — el tipo de recompensa que sobrevive años.

Al descubrirse, la fila que se escribe en Supabase es mínima: coordenadas,
descubridor, fecha y nombre. El contenido del chunk ya estaba en la semilla
(5.5.1).

**Tamaño de chunk: 30.000 × 30.000 u.** No lo decide el aburrimiento de
cruzarlo — eso lo resuelve el warp (5.8), en el que un cruce en diagonal
son ~13s. Lo decide que quepan varios puntos de interés separados por más
que el AoI máximo (3000u, tabla de 5.4) y que el radio de un futuro
scrambler de interdicción, para que un enganche en un punto no arrastre a
los vecinos.

**Pendiente de definir:** cuántos pulsos acertados hacen falta para
estabilizar una firma; si el escáner ocupa slot alto o medio (ver 8.3);
proporción de callejones sin salida; si los nombres puestos por jugadores
pasan por algún filtro o moderación.

### 5.6 Contenido de los chunks vírgenes

#### 5.6.0 El centro del chunk es siempre la estrella

**Decisión: cada chunk tiene una estrella (o dos, sistema binario) fija en
el centro exacto de la grilla de 30.000×30.000u.** No es solo lore — es la
referencia geométrica de la que cuelga todo lo demás:

- Es el **punto de origen natural para el resto de coordenadas** del chunk:
  planetas, campos de asteroides y estaciones se generan a distancias
  orbitales de la estrella, no en posiciones sueltas — coherente con que
  todo sale de la semilla (5.5.1).
- **Sistema binario:** dos estrellas orbitándose cerca del centro en vez de
  una sola. Se decide por semilla igual que cualquier otro rasgo del chunk
  — no hace falta una tabla nueva, es una probabilidad más dentro de la
  generación ya existente.
- La estrella **no es navegable ni destructible**, es geometría de fondo y
  referencia — no ocupa slot de contenido de los tres tipos de 5.6.
- Efecto de diseño colateral bueno: le da a cada chunk una **identidad
  visual instantánea** en el minimapa y en el mapa estelar, sin coste de
  arte extra por chunk — es la misma estrella reescalada/recoloreada según
  semilla, no un asset por sistema.

**Pendiente de definir:** proporción de sistemas binarios frente a
estrella única; si el tipo de estrella (color/tamaño) influye en algo
mecánico (p. ej. radiación que afecta a escudos) o es puramente visual.

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

#### 5.6.1 Cómo se mezclan los tres elementos por chunk

**Decisión: tablas de rareza ponderadas por distancia, con la semilla
(5.5.1) como única fuente de aleatoriedad.** No biomas con nombre propio —
son más trabajo de diseño (definir y ilustrar cada bioma) para el mismo
resultado funcional, y en un juego de descubrimiento progresivo por
triangulación (5.5.2) nadie ve el chunk completo de golpe para apreciar un
bioma como conjunto.

El peso de cada elemento se deriva de `d` (saltos desde el wormhole, ya
usado en CONCORD, 4.3.1) y de un valor de aspereza propio del chunk
(también determinista por semilla):

- **Recursos minables**: presentes en casi todo chunk, con la rareza
  máxima disponible escalando con `d` — misma curva de progresión que ya
  gobierna CONCORD y el escáner (5.5.2), coherencia entre sistemas gratis.
- **Ruinas**: raras y con probabilidad plana, no creciente con `d`. Si
  solo aparecieran lejos, el misterio se convertiría en otra recompensa de
  final de progresión en vez de en algo que se puede tropezar temprano.
- **Fauna hostil**: probabilidad creciente con `d`, y ella sí ligada al
  valor de aspereza del chunk — así hay chunks profundos tranquilos y
  chunks intermedios ya peligrosos, evitando que "peligro" sea 1:1 con
  "lejos".

#### 5.6.2 Las ruinas dan pistas, nunca la respuesta

**Decisión: sí dan pistas progresivas, con dos reglas que protegen el
misterio permanente ya decidido en 1.1.1:**

- Cada ruina explorada entrega un **fragmento** — imagen, dato o
  artefacto — que se archiva en un **compendio de servidor compartido**
  entre todos los jugadores, no una barra de progreso individual. Encaja
  con la filosofía de "descubrimiento global" ya usada en puntos de salto
  (5.5) y facciones (1.1.4).
- **Los fragmentos generan más preguntas de las que cierran.** Nunca
  convergen hacia una explicación única y verificable. Es la única forma
  de que la mecánica sea compatible con la decisión ya tomada de que el
  misterio no se resuelve nunca del todo (1.1.1) — si los fragmentos
  sumaran a una respuesta completa, la comunidad acabaría por completarla
  y el contenido se agotaría, que es justo lo que se quería evitar.

**Pendiente de definir:** valores exactos de las tablas de rareza; cadencia
de publicación de fragmentos nuevos (¿generados de antemano y liberados por
hitos de la comunidad, o descubribles desde el día uno?); si hay algún tipo
de recompensa mecánica (no solo lore) por fragmento.

### 5.7 Warp — desplazamiento intra-chunk

**Velocidad de warp: 15× la velocidad sublight**, es decir 220 × 15 =
**3.300 u/s** sobre el `SHIP_SPEED` ya fijado en código (`server/rooms/ChunkRoom.js`,
`client/src/main.js`). A 30.000u de lado (5.5), cruzar el chunk en
diagonal en warp son ~13s.

**Solo se puede saltar a un destino reconocido**, no a cualquier
coordenada libre: punto de salto, estación, campo de asteroides, ruina, o
una nave sobre la que ya tengas lock. Es una simplificación deliberada
frente al "warp a cualquier celestial" de EVE — con un universo generado
por semilla y POIs discretos (5.5.1, 5.6.1) no existe "espacio vacío" al
que merezca la pena saltar, así que no hace falta soportarlo.

**Secuencia de warp:**

1. **Alineación.** Unos segundos acelerando hacia el rumbo del destino
   elegido, a velocidad sublight normal (220u/s). Durante este tramo el
   jugador es un blanco legítimo — es la ventana de vulnerabilidad que le
   da sentido a interceptar a alguien.
2. **Duración de alineación por clase de nave**, no un valor fijo:
   cazadores/interceptores ~1,5-2s, naves grandes ~5-8s. Diferenciación de
   rol gratuita dentro de la naveteca FHI (41 naves ya catalogadas), sin
   tocar armamento — mismo principio que ya se aplicó con el tamaño de
   estación (4.2.1): la elección de nave pesa antes de que empiece el
   combate.
3. **Warp.** Una vez completada la alineación, la nave es intocable e
   inintervenible hasta llegar al destino (como en EVE). Interrumpir el
   viaje solo es posible **antes** de que la alineación termine, nunca
   durante el warp en sí.

**Pendiente de definir — interdicción.** Sin nada que impida iniciar la
alineación, la ventana de vulnerabilidad del punto 1 es la única
oportunidad de CONCORD (4.3) o de un perseguidor: puede ser suficiente
para el diseño, pero es una decisión pendiente, no una omisión. Falta
decidir si existe un módulo tipo scrambler/disruptor de corto alcance que
impida entrar en warp dentro de su radio, y si ese radio se calibra contra
el tamaño de chunk (5.5) para que un enganche no arrastre a los POIs
vecinos.

**Otras pendientes:** valores exactos de tiempo de alineación por clase de
nave; si hay algún coste (combustible/energía) por salto o es gratuito una
vez alineado; si se puede cancelar un warp ya en curso desde el propio
piloto (p. ej. para abortar si el destino resulta hostil) o es siempre
hasta llegar.

### 5.7.1 Estado actual del prototipo — versión simplificada, no el diseño final

Lo que hay implementado en el código ahora mismo **no es** el modelo de
"lock a un destino reconocido + alineación" descrito arriba — es una
versión mucho más simple, pensada como peldaño intermedio mientras no
existen POIs/destinos reconocibles en el chunk fijo de fase 0:

- No hay destino elegido. El warp es un **impulso en la dirección actual
  de vuelo** (el vector velocidad en el momento de completarse la carga),
  no un viaje dirigido a un punto.
- **Carga por tiempo fijo** (10s en la única nave que existe ahora, FHI
  Wren) en vez de alineación proporcional a la distancia al destino — no
  hay destino del que calcular una distancia todavía.
- Requiere velocidad ya distinta de cero para activarse (si la nave está
  parada al completarse la carga, no pasa nada — sin dirección de vuelo no
  hay hacia dónde impulsarse).
- Al activarse: invulnerabilidad + velocidad = 500% de la máxima, sin
  control manual (ni giro ni empuje) hasta cancelar a mano o topar con el
  borde del mundo.
- Enfriamiento de 30s tras iniciar la carga (no tras completarla).
- Botón dedicado en el HUD (verde, junto al de minar) + tecla `E`.

**Por qué esta diferencia es temporal, no una decisión definitiva:** el
modelo de destino+alineación necesita POIs reconocibles (5.5.1/5.6.1) que
todavía no existen como objetos en el chunk fijo del prototipo. En cuanto
haya destinos reales a los que apuntar, este impulso direccional debería
evolucionar hacia (o convivir con) el modelo completo de esta sección —
no se ha descartado nada, solo se ha aplazado por dependencia técnica.

### 5.8 Sincronización cliente-servidor (decidido en el prototipo)

El servidor es siempre la autoridad — el cliente nunca decide la posición
real de nadie, solo la predice/interpola visualmente:

- **Predicción local**: la propia nave se mueve al instante en pantalla
  según el input, sin esperar confirmación del servidor. Si la posición
  predicha se desvía demasiado de la última confirmada por el servidor
  (paquete perdido, lag puntual), se corrige suavemente en vez de
  teletransportar de golpe.
- **Interpolación de jugadores remotos**: se dibujan con un pequeño
  retraso (~100ms) interpolando entre las dos últimas posiciones reales
  recibidas del servidor, en vez de saltar bruscamente cada vez que llega
  un paquete de red (que llega más lento que el framerate de render).
- **Límite del mundo**: se aplica por clamp de posición en el servidor
  (autoridad real); el cliente solo dibuja el borde visual.
- Este enfoque nació resolviendo un bug del prototipo (jugadores viendo
  posiciones distintas entre sí) pero es la técnica estándar de netcode
  para cualquier MMO en tiempo real — se mantiene como decisión de
  arquitectura para cuando exista el sistema de chunks dinámico, no es
  algo exclusivo del chunk fijo de fase 0.
- Es además el requisito que hace viable bajar `patchRate` bajo carga
  (5.4): sin interpolación, menos parches se notarían como tirones.

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

### 7.1 Persistencia real — implementada en v0.3.0

El sustituto de `localStorage` queda retirado. Hay cuentas de verdad,
personajes por cuenta y progreso guardado en servidor.

**Identificación: correo y contraseña** (v0.4.0), con casilla de mantener
la sesión iniciada.

Se probó primero con enlace mágico al correo, sin contraseñas, y se
descartó por dos razones:

1. **Obliga a salir del juego para entrar al juego.** El jugador tiene que
   irse a su aplicación de correo, buscar el mensaje y volver. En un juego
   eso es una barrera desproporcionada, y peor aún en móvil, donde salir de
   la pestaña puede costar recargar toda la partida.
2. **No escala más allá del desarrollador.** El servicio de correo que
   Supabase trae de serie solo envía mensajes a los dueños del proyecto y
   con un límite de unos pocos por hora. Funcionaba en las pruebas
   únicamente porque el probador era el dueño; ningún otro jugador habría
   recibido nunca su enlace.

**Consecuencia asumida:** sin correo saliente propio no hay recuperación de
contraseña. Si un jugador la olvida, la cuenta se recupera a mano desde el
panel. Es aceptable en fase cerrada y **deja de serlo antes de abrir el
juego a desconocidos**: conectar un servicio de correo propio es requisito
previo a la apertura, y con él la recuperación funciona sola.

**Dónde se guarda la sesión.** La casilla elige entre un almacén que
sobrevive a cerrar el navegador (por defecto) y otro que se borra al cerrar
la pestaña, para dispositivos prestados o compartidos.

#### 7.1.1 Login dormido durante el desarrollo

**El login está construido pero desactivado** (`LOGIN_ENABLED = false` en
`client/src/cuenta.js`). Durante la fase de pruebas, pedir credenciales en
cada sesión de prueba cuesta más de lo que aporta.

**No se desactiva saltándose el sistema.** Con el login dormido, el juego
crea al vuelo una **cuenta anónima**: una cuenta real en la base de datos,
sin correo asociado. Los personajes siguen viviendo en Supabase, con su
límite de 5, sus nombres únicos, sus reglas de escritura y su progreso
guardado por el servidor.

Esto importa más de lo que parece. La alternativa —volver a guardar
personajes en el navegador mientras dure el desarrollo— crearía **un
segundo camino que nadie prueba**: todo funcionaría en pruebas por una vía
distinta de la que usarán los jugadores, y el día de activar el login
habría que volver a probarlo entero, con los fallos apareciendo justo
cuando hay gente mirando. Con cuentas anónimas, las pruebas diarias
ejercitan exactamente el mismo recorrido que el juego final; lo único que
desaparece es la pantalla.

**Degradación:** si las sesiones anónimas no están habilitadas en el panel
de Supabase, el juego enseña la pantalla de login normal en lugar de
quedarse en blanco.

**Coste asumido:** una cuenta anónima vive en el navegador. Borrar los
datos del navegador la deja huérfana junto con sus personajes. Es
aceptable en pruebas y es precisamente la razón de que exista el login.

**Cuándo despertarlo:** cuando haya contenido y jugadores reales, es decir,
cuando perder una cuenta empiece a doler. Se cambia una constante a `true`
y nada más. Antes de ese momento hay que resolver el correo saliente (7.1),
o no habrá recuperación de contraseña.

**Tablas:**

| Tabla | Contiene |
|---|---|
| `auth.users` | Cuentas (lo gestiona Supabase) |
| `characters` | Personajes: nombre, cuenta propietaria, fechas. Máx. 5 por cuenta |
| `character_state` | Estado de vuelo: nave, posición, velocidad, orientación, casco, carga |

**Quién puede escribir qué — la regla que sostiene todo lo demás.** El
navegador puede crear, listar y borrar sus propios personajes, y nada más.
**No tiene permiso para escribir en `character_state`.** Posición, casco y
carga solo los escribe el servidor del juego, que usa una clave de
servicio guardada en una variable de entorno.

Esto no es una precaución de más: si el navegador pudiera escribir su
propio estado, cualquiera podría declararse 50.000 unidades de mineral en
bodega sin haber minado nunca. La base de datos lo impide por sí misma,
aunque alguien modifique el código del cliente.

**Cadena de comprobación al entrar a jugar.** El cliente manda dos cosas al
servidor: el testigo de sesión que le dio Supabase y el identificador del
personaje elegido. El servidor, antes de dejarlo entrar:

1. Verifica contra Supabase que el testigo es auténtico y no ha caducado
   → obtiene de quién es la cuenta.
2. Comprueba que ese personaje pertenece a esa cuenta.

Sin el paso 2, bastaría con conocer el identificador del personaje de otro
para jugar con su nave. El identificador no es un secreto; la propiedad
sí se comprueba.

**Reglas aplicadas en la base, no en el cliente.** El límite de 5
personajes y la unicidad del nombre (ignorando mayúsculas) viven en la
base de datos. Cualquier regla que solo viva en el navegador es una
sugerencia, porque el navegador es del jugador. Además, crear un personaje
crea automáticamente su estado inicial, de forma que no puede existir un
personaje sin estado aunque el servidor falle justo después del alta.

**Ritmo de guardado.** No se escribe cada tick: veinte escrituras por
segundo y por jugador fundirían la base sin aportar nada. Se guarda:

- cada 30 segundos mientras se juega,
- al salir de forma explícita,
- al expirar la ventana de reconexión sin que el jugador vuelva,
- al cerrarse la sala.

Perder los últimos segundos de vuelo si el servidor cae es irrelevante;
perder la sesión entera no lo es. Los dos últimos casos son los que de
verdad importan, porque cerrar el móvil de golpe es la forma habitual de
terminar una partida en este juego.

**Degradación deliberada.** Si faltan las variables de entorno, el
servidor arranca igual y el juego funciona sin guardar, avisando por
consola. Una configuración incompleta deja el juego jugable en vez de
tirarlo abajo.

**Pendiente:** conectar un servicio de correo propio antes de abrir el
juego (bloquea la recuperación de contraseña y cualquier aviso por email);
guardar la nave elegida cuando existan varias (hoy todos
los personajes vuelan la lanzadera inicial); mover a la base la bodega de
mineral separada (8.2.2) cuando exista; copias de seguridad, que el plan
gratuito de Supabase no incluye (ver 14).

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

#### 8.2.1 Quién puede minar — módulo abierto, rendimiento muy desigual

**Minar requiere un módulo que ocupa ranura, y ese módulo puede montarse
en cualquier casco.** No hay una lista blanca de naves autorizadas: si
sacrificas una ranura, minas.

**Pero las naves mineras dedicadas extraen muchísimo más**, no un poco
más. La diferencia es de orden de magnitud, no de porcentaje. Esa
magnitud es lo que hace que la decisión signifique algo:

- Si la diferencia fuera pequeña (×2), lo óptimo sería minar siempre con
  nave de combate: minas casi igual y encima puedes defenderte. La nave
  minera no existiría en la práctica.
- Con una diferencia grande (~×10 como cifra de trabajo), minar con un
  casco genérico es **un apaño**: sirve para rascar un asteroide de paso,
  para salir de un apuro o para empezar. Extraer en serio obliga a sacar
  la nave minera, que es lenta, frágil y va cargada.

Ese es justamente el objetivo de diseño. La nave minera es **un blanco**:
el jugador que quiere producir de verdad tiene que exponerse, y eso crea
por sí solo la necesidad de escolta, la tentación del robo y el motivo
para tener territorio seguro. Es contenido social que sale gratis de una
sola decisión numérica — al contrario que un sistema donde todo el mundo
mina cómodamente en su nave de combate, que no genera ninguna
interacción entre jugadores.

Consecuencias que esto obliga a respetar en el resto del diseño:

- **La bodega acompaña al bonus.** Una minera que extrae ×10 pero
  transporta lo mismo que una fragata no gana nada: haría diez viajes.
  Bodega y rendimiento de extracción van juntos.
- **El bonus vive en el casco, no en el módulo.** El mismo módulo montado
  en una minera rinde mucho más que en un crucero. Si el bonus estuviera
  en el módulo, bastaría con comprar el módulo bueno y montarlo donde
  fuera.
- **Ocupar ranura tiene que doler.** Si un acorazado puede llevar el
  módulo sin renunciar a nada relevante, la restricción es decorativa.

**Pendiente de definir:** el multiplicador exacto por clase de casco
(~×10 es cifra de trabajo, no medida); si hay varios niveles de módulo
minero.

#### 8.2.2 Dos arquetipos de nave minera — autónoma e industrial

No hay una sola "nave minera", hay **dos roles distintos**, y la
diferencia entre ellos no es de potencia sino de si puedes jugar solo:

**Minera autónoma** — extrae bastante y lleva **bodega de mineral
propia**, separada del pequeño espacio de carga general de la nave.
Está pensada para el **minero solitario**: sales, llenas, vuelves, vendes.
Es autosuficiente. No es la forma más eficiente de extraer, pero es la
única que funciona sin depender de nadie.

**Minera industrial** — extrae **muchísimo más**, pero con bodega
ridícula. Se llena en poco tiempo y entonces deja de servir. Es
deliberadamente **inviable en solitario**: obliga a montar una operación
con **hauleres y cargueros** que retiren el mineral mientras la minera
sigue extrayendo.

La lógica de diseño es que el eje de progresión no sea "nave mejor" sino
**"organización mejor"**. La industrial no es un upgrade de la autónoma
que se compra y ya: es una nave que solo rinde si tienes gente. Un jugador
solitario con la nave industrial extrae peor que con la autónoma, aunque
la industrial mine el triple. Eso convierte a la corporación (§6) en algo
que sirve para producir, no solo para pelear por territorio.

**La bodega de mineral es un inventario aparte.** No es "más espacio de
carga": es un compartimento que solo acepta mineral bruto, y convive con
la bodega general pequeña donde caben módulos, munición y demás. Se
separan porque si fueran el mismo saco, el jugador podría vaciar la
bodega general para minar más, y la restricción de la industrial —que es
todo el punto de su diseño— se esquivaría llevando la nave vacía.

**Pendiente de definir:** cifras concretas de extracción y bodega para
cada arquetipo; cuántas naves del catálogo de 41 se reasignan a estos
roles (hoy ninguna es minera); si los gases y los orgánicos usan el mismo
módulo y la misma bodega o requieren los suyos.

#### 8.2.3 Consecuencia obligatoria — mover mineral entre naves

La minera industrial **no puede existir sin una forma de pasar el mineral
a otra nave en pleno espacio**, y esa mecánica no existe todavía. Es una
dependencia dura, no un adorno: sin ella, el arquetipo industrial es
simplemente una nave peor.

Tres formas posibles, con consecuencias distintas:

| Opción | Cómo funciona | Qué implica |
|---|---|---|
| **Contenedor flotante** | La minera suelta el mineral en un bulto que queda en el espacio; el carguero lo recoge | Lo más simple de implementar y ya encaja con la acción `loot` (15.4). **Cualquiera puede robarlo**, incluido un tercero que pase por ahí |
| **Transferencia directa** | Minera y carguero acercados, el mineral pasa de bodega a bodega | Sin riesgo de robo, pero obliga al carguero a quedarse quieto al lado — se convierte en blanco junto a la minera |
| **Bodega de flota compartida** | El carguero ofrece un compartimento al que la minera vuelca directamente | Lo más cómodo y lo menos interesante: elimina el momento de vulnerabilidad, que es justamente lo que hace la operación tensa |

El contenedor flotante es el candidato natural porque **reutiliza piezas
que ya están decididas**: la acción contextual `loot` y su icono ya
existen, y el robo de carga ajena ya es un acto agresivo definido que
dispara CONCORD (4.3). Introduce riesgo sin introducir sistemas nuevos.

**Pendiente de decidir:** cuál de las tres, o combinación; si el
contenedor flotante caduca con el tiempo; si volcar a un contenedor
propio y que otro se lo lleve cuenta como robo o hay concepto de
propiedad sobre el bulto.

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
de referencia separada: cambiar un archivo ahí cambia el juego. Por ahora
todo el mundo usa la misma nave inicial (FHI Wren, lanzadera) —
selección/crafteo real de nave queda para cuando exista el sistema de
fabricación (8.3).

**Herramienta `client/public/naveteca/` — editor, no solo visor.** Cada
nave se puede editar desde la propia interfaz (nombre, clase,
descripción, stats) y se le puede sustituir el sprite o el sonido de
motor subiendo un archivo. El guardado tiene dos niveles, porque GitHub
Pages es hosting estático y no puede escribir en el repo por sí solo:
1. **Local (instantáneo)** — se guarda en `localStorage` del navegador y
   se ve reflejado al momento tanto en la naveteca como en el juego real
   (misma clave de almacenamiento, mismo navegador).
2. **Exportar parche** — genera un `.zip` con el catálogo fusionado y los
   archivos sustituidos, para aplicarlo al repo (ver sección 14) y que lo
   vea todo el mundo.

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



### 8.4.1 Automatización y tareas offline

**Decisión: tres niveles de la misma mecánica, con el modelo matemático
puro (no simulación física) como base de los tres.**

| Nivel | Cuándo | Eficiencia | Requiere |
|---|---|---|---|
| Manual | Jugando activamente | 100% | Nada nuevo |
| Piloto automático online | Conectado, sin intervenir | ~65% | Nada nuevo — corre en el `update()` que ya existe |
| Tarea offline | Desconectado | ~40% | Persistencia real (Supabase, ver 14) |

**El modelo es siempre el mismo: orden persistente + evaluación
perezosa, nunca una nave simulándose sola en segundo plano.** El jugador
da una orden ("minar en el cinturón X hasta llenar bodega y volver") y el
servidor guarda `orden`, `nave usada`, `hora de inicio` y las stats
relevantes de esa nave en ese momento. No hay nada moviéndose de verdad
mientras tanto — es el mismo patrón ya usado para regeneración de
recursos y asedios (5.4.1): al jugador reconectar (o al consultarse la
orden), el servidor calcula cuánto tiempo ha pasado y resuelve el
resultado de golpe (viaje + minado + vuelta, con los tiempos de la propia
simulación existente).

**Por qué el piloto automático online no necesita nada nuevo.** A
diferencia de la tarea offline, la room ya está viva y el bucle de
simulación del servidor (`update()` en `ChunkRoom.js`) ya corre a tick
completo. Automatizar es sustituir el origen del input: en vez de leer el
input del jugador, la nave sigue una pequeña máquina de estados (ir a
destino → minar → volver) que empuja por ese mismo `update()`. Es, con
diferencia, la pieza más barata de las tres — se puede construir **antes**
de tener Supabase, y de hecho conviene por ese orden: sirve como el primer
tramo de la máquina de estados que luego reutiliza la tarea offline
completa.

**Los tres niveles no son un ajuste fino, son la palanca central de todo
el sistema** — mismo principio que ya rige `F0`/`k` en CONCORD (4.3.1) o
la estrella central del chunk (5.6.0): un número pequeño de parámetros
controla toda la sensación de balance. Aquí concretamente protege el
incentivo de jugar activamente sin quitarle progreso a quien no puede
estar pendiente de la pantalla — que es exactamente el público de un
juego pensado también para móvil.

**Descartado para esta fase: materializar la tarea offline como nave
física, interactuable/atacable, cuando un jugador real entra en el
chunk.** Se consideró como capa visual — un "fantasma" calculado por
posición + tiempo, dibujado solo cuando la room ya está despierta por
otro motivo — y ahí el coste adicional es casi cero, porque la room ya
está pagada por quien la despertó. El problema no está en pintarlo, está
en hacerlo interactuable: eso obliga a construir de golpe tres piezas que
hoy no existen —

- **Combate contra un jugador ausente**, con hitbox y resolución de daño
  reales, reutilizando el sistema de CONCORD (4.3.2) pero contra una
  nave que su dueño no puede defender ni ver.
- **Persistencia en caliente**: un impacto tiene que escribirse en el
  momento en que ocurre, no esperar a que el dueño se reconecte para
  resolver la tarea de una vez — rompe justo el patrón de escritura
  diferida que sostiene 5.4.1.
- **Equidad de pérdida**, del mismo tipo que ya existe para estaciones
  (custodia parcial, 4.2.4): sin ella, desconectarse para trabajar puede
  significar perder la nave sin haber podido reaccionar ni consentirlo.

Ninguna de las tres es un interruptor — son subsistemas enteros. Se deja
como expansión futura posible, no descartada para siempre, pero fuera del
alcance de la primera versión de esta mecánica.

**Pendiente de definir:** catálogo de órdenes disponibles por clase de
nave (¿una lanzadera solo admite una orden simple, una minera dedicada
encadena varias?); si existen mejoras (módulos, tripulación, skills) que
suban la eficiencia offline por encima del 40% base; tope de fantasmas
visuales simultáneos por chunk al despertar, mismo patrón que el tope de
naves CONCORD (4.3.2); si el piloto automático online se puede activar
con el jugador mirando otra pantalla del juego (mercado, fabricación) o
exige minimizar/salir del modo vuelo.

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

- ~~¿Mosaico continuo o sistemas discretos?~~ — resuelto: sistemas
  discretos con puntos de salto, grilla como metadato del mapa (5.1)
- ~~¿Instanciar chunks llenos?~~ — resuelto: no, se degrada bajo carga (5.4)
- ~~Tamaño exacto de un chunk en unidades de juego~~ — resuelto: **30.000
  × 30.000 u** para el sistema de chunks completo (5.5). Ya aplicado
  también al prototipo (`WORLD_SIZE = 30000` en el código, antes era
  `4000` de marcador temporal) — mismo tamaño en ambos ahora.
- ~~¿Hay velocidad de warp dentro del chunk?~~ — resuelto: sí, 15× la
  velocidad sublight (3.300 u/s), con alineación previa y solo a destinos
  reconocidos (5.7)
- ~~Estructura del centro del chunk~~ — resuelto: siempre hay una estrella
  (o dos, binario) fija en el centro exacto de la grilla (5.6.0)
- Interdicción del warp: ¿existe scrambler/disruptor que impida alinear?
  (5.7)
- Valores exactos de tiempo de alineación por clase de nave (5.7)
- Coste (combustible/energía) del warp, y si se puede cancelar en curso (5.7)
- Proporción de sistemas binarios frente a estrella única (5.6.0)
- ¿Existe un overview textual tipo EVE, o el HUD se queda solo con
  marcadores gráficos? (15.6)
- Cómo se muestran escudo/armadura/casco cuando sean tres capas separadas
  (15.6)
- ~~Qué naves llevan capacidad de minado~~ — resuelto: **módulo que ocupa
  ranura en cualquier casco**, pero las naves mineras dedicadas extraen
  del orden de ×10 más (8.2.1)
- Multiplicador exacto de extracción por clase de casco (8.2.1)
- ¿Gases y orgánicos usan el mismo módulo minero o uno propio, y la misma
  bodega de mineral? (8.2.1, 8.2.2)
- **Cómo se mueve el mineral de la minera industrial al carguero**:
  contenedor flotante, transferencia directa o bodega de flota (8.2.3) —
  bloquea el arquetipo industrial por completo
- Cifras de extracción y bodega de cada arquetipo minero (8.2.2)
- ¿Hay propiedad sobre un contenedor soltado en el espacio, o recogerlo es
  siempre legítimo? (8.2.3)
- Si el tipo de estrella influye mecánicamente (radiación, escudos) o es
  solo visual (5.6.0)
- ~~Mecánica de escaneo para encontrar puntos de salto~~ — resuelta: pulso
  direccional + triangulación, con módulo que ocupa slot (5.5.2)
- ~~¿El mundo se genera al descubrirlo o está pregenerado?~~ — resuelto:
  determinista por semilla + coordenadas, solo se persisten deltas (5.5.1)
- Cuántos pulsos acertados estabilizan una firma (5.5.2)
- ~~Cuántos puntos de spawn y criterio de rotación~~ — resuelto: 3 puntos
  fijos, rotación por ocupación (~15 jugadores/punto), no por tiempo (4.1.1)
- ~~Mezcla de recursos/ruinas/fauna por chunk~~ — resuelto: tablas de
  rareza ponderadas por distancia y aspereza, sin biomas con nombre (5.6.1)
- ~~¿Las ruinas dan pistas o son solo flavor?~~ — resuelto: pistas vía
  compendio compartido que nunca converge en respuesta (5.6.2)
- Si el umbral de spawn (15) se ajusta con telemetría real (4.1.1)
- Si el jugador puede elegir su punto de spawn manualmente (4.1.1)
- Valores exactos de las tablas de rareza por chunk (5.6.1)
- Cadencia de publicación de fragmentos de ruinas (5.6.2)
- Si el escáner ocupa slot alto o medio (5.5.2)
- Proporción de chunks sin salida sin descubrir (5.5.2)
- Si los nombres de chunk puestos por jugadores se moderan (5.5.2)
- ~~Qué ocurre con un chunk dormido~~ — resuelto: congelado, estado como
  timestamps y evaluación perezosa al despertar (5.4.1)
- ~~Duración de la histéresis antes de destruir una room vacía~~ —
  resuelto: 3 minutos, con volcado a Supabase al vaciarse (5.3)
- ~~Umbrales de la escalera de degradación~~ — resueltos como valores de
  partida, pendientes de recalibrar con tiempo de tick medido (5.4)
- ~~¿Migrar a Colyseum 0.16?~~ — resuelto: sí, como bump aislado y antes de
  construir el AoI (5.4)
- Reglas de conquista territorial
- Cuántos puntos de spawn simultáneos y criterio de rotación por carga
- Catálogo de órdenes de automatización por clase de nave (8.4.1)
- Mejoras que suben la eficiencia offline por encima del 40% base (8.4.1)
- Tope de fantasmas visuales offline simultáneos por chunk (8.4.1)
- Si el piloto automático online exige salir del modo vuelo o no (8.4.1)
- ~~¿CONCORD patrulla o solo responde?~~ — resuelto: solo responde, salvo
  presencia estática en el chunk del hub (4.3.4)
- Cómo se genera la mezcla recursos/ruinas/fauna por chunk
- Si las ruinas cuentan una progresión de misterio o son solo flavor/loot
- Catálogo exacto de la tienda NPC del hub inicial
- ~~Qué pasa con la nave mientras el jugador está dentro de una estación~~
  — resuelto: depende del tamaño de la estación (4.2.1)
- ~~Transición nave→estación~~ — resuelto: fundido corto de ~1s (4.2.2)
- ~~Capacidad de la instancia interior~~ — resuelto: una sola room con
  cola, sin instanciar (4.2.2)
- ~~Qué clasifica una estación como pequeña, mediana o grande~~ —
  resuelto: tres clases discretas por plano (Puesto / Estación / Bastión),
  con módulos como mejora dentro de la clase (4.2.3)
- Qué es exactamente la "protección parcial" de una estación mediana
  (propuesta: torretas de la estructura) (4.2.1)
- ~~Qué pasa con las naves guardadas si destruyen la estación~~ —
  resuelto: ~20% cae como botín, el resto entra en custodia con demora y
  comisión (4.2.4)
- Si un puesto puede ascender de clase o hay que reconstruir (4.2.3)
- Calibración de la custodia: % de botín, demora, comisión, y si aplica
  igual en conquista pacífica que en destrucción (4.2.4)
- Capacidad numérica de la room interior, y si el hub inicial es excepción
  y sí se instancia (4.2.2)
- ~~Cuántas facciones NPC y cómo se comportan~~ — resuelto: tres
  (territorial / mercante / errante), una implementada primero (1.1.2)
- ~~Diferencias visuales y tecnológicas~~ — resuelto: silueta + paleta +
  un rasgo mecánico por facción, sin árboles completos (1.1.3)
- ~~¿Se expanden las facciones NPC?~~ — resuelto: no avanzan solas; los
  jugadores bajan su influencia y ésta se regenera de forma perezosa (1.1.4)
- Nombres y lore de las tres facciones, y cuál se implementa primero (1.1.2)
- Ritmo de regeneración de influencia de facción (1.1.4)
- Si la reputación con facciones NPC es independiente de la de CONCORD (1.1.4)
- ~~Fórmula de degradación de CONCORD~~ — resuelta: distancia en saltos,
  retardo lineal y fuerza geométrica, sin escalar con nº de atacantes (4.3.1)
- ~~Qué manda CONCORD al intervenir~~ — resuelto: naves NPC reales y
  destruibles, con tope por room (4.3.2)
- ~~¿Queda flag/reputación tras agredir?~~ — resuelto: flag de combate
  corto + reputación persistente con umbral de proscrito (4.3.3)
- Calibración de `F0`, `k` y retardo con jugadores reales (4.3.1)
- Qué clase de naves manda CONCORD y si varía con la distancia (4.3.2)
- Duración del flag, umbral de proscrito y ritmo de recuperación (4.3.3)
- Si robar carga pesa lo mismo que disparar en la reputación (4.3.3)
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

## 13. Roadmap — estado del prototipo

Objetivo original: validar el stack completo (Phaser + Colyseum +
Supabase) con la pieza más pequeña de gameplay real. El prototipo ha ido
bastante más allá de la fase 0 original en pulido de cliente, aunque
sigue siendo un único chunk fijo sin las piezas grandes de mundo/economía
todavía.

**Ya implementado:**
1. Movimiento de nave sincronizado en tiempo real, con predicción local e
   interpolación de remotos (ver 5.2) — resuelve el desajuste visual
   entre jugadores conectados a la vez.
2. Minado básico: asteroides fijos en el chunk, extracción simple,
   inventario visible en el HUD.
3. Combate mínimo: disparo directo, daño y destrucción de nave (sin el
   apuntado híbrido de 8.4 ni pérdida de items todavía).
4. Un único chunk fijo con borde/límite real (30.000 unidades, tamaño de
   diseño definitivo — ver 5.5), sin sistema de descubrimiento ni
   CONCORD todavía.
5. Control completo: teclado (WASD) y táctil (joystick que aparece donde
   tocas + botón de acción contextual), pensado para jugarse desde el
   móvil.
6. Cliente robusto: indicador de ping real, reconexión automática si se
   cae la conexión, aviso de "servidor despertando" (Render free tier).
7. Dos pantallas antes de entrar: changelog scrolleable con barra de
   estado fija, y selección/creación de personaje (nombre, hasta 5 —
   placeholder en `localStorage`, ver sección 7).
8. Naves reales: 41 modelos catalogados por clase EVE-style con
   fabricante Fiji Heavy Industries (ver 8.3), con sprite y sonido de
   motor real en el juego (todavía una única nave inicial para todos).
   La naveteca (`client/public/naveteca/`) es editor, no solo visor.
9. Menú de opciones con "Cerrar juego", versión visible en pantalla.
10. Iconografía propia y botón de acción contextual (ver 15): atlas de 16
    iconos compartido entre HUD y mundo, un único botón que cambia de
    significado según lo que haya a rango, decidido por el servidor y
    enviado por mensaje privado solo al cambiar.

**Todavía fuera del prototipo:** modo a pie/estaciones, crafteo real de
naves (más allá de usar el sprite/stats ya catalogados), selección de
nave por el jugador, sistema de chunks dinámico y descubrimiento,
territorio/corporaciones, facciones NPC no-humanas, precursores/ruinas,
gradiente de CONCORD, pérdida de nave al morir, persistencia real en
Supabase (sustituir el placeholder de `localStorage`).

**Pendiente de definir:** orden exacto de lo siguiente — candidatos
fuertes son Supabase (para que los personajes no dependan del navegador)
y crafteo real, antes de abrir el sistema de chunks dinámico.

Dos tareas técnicas ya decididas que encajan aquí: **desacoplar
simulación de `patchRate`** (5.4) y el **bump a Colyseum 0.16** (5.4),
este último obligatorio antes de construir el AoI.

## 14. Infraestructura de desarrollo

Decisiones prácticas sobre cómo se despliega y se itera el prototipo —
no son diseño de juego, pero condicionan cómo de rápido se puede iterar.

### 14.1 Hosting

- **Servidor (Colyseum)**: Render, plan free, servicio `mmo-espacial-server-eu`,
  región **Frankfurt** (antes Oregon — se migró por latencia: ~190ms desde
  España bajaron a ~60ms). Se "duerme" tras inactividad (de ahí el aviso de
  "servidor despertando" en el cliente). Render no permite cambiar la
  región de un servicio existente — mover de región siempre implica crear
  uno nuevo y migrar la URL, no hay otra forma.
- **Cliente (Phaser)**: GitHub Pages, construido con Vite y publicado vía
  GitHub Actions (`deploy-pages.yml`) en cada cambio dentro de `client/`,
  con `VITE_SERVER_URL` apuntando al servidor de Render de arriba.
- Repo: `egoivaldes-code/mmo-espacial` (público).

### 14.2 Flujo de parches

El desarrollo va por parches en `.zip`, no por edición manual del repo.
Un workflow propio (`.github/workflows/apply-patch.yml`) aplica el parche
solo: se sube un `spacemmo_*.zip` a la raíz de `main`, el workflow lo
descomprime, crea/sobreescribe archivos en sus rutas reales, borra el
zip, hace commit y push, y dispara el deploy de Pages si el cambio tocó
`client/`. Detalle completo del mecanismo (incluida la protección contra
zip-slip/symlinks y los metadatos opcionales `PATCH.json`/`DELETE.txt`)
en el `README.md` del repo.

**Limitación conocida — archivos dentro de `.github/workflows/`.**
GitHub bloquea por diseño que el `GITHUB_TOKEN` automático de un workflow
modifique otros archivos de workflow (así un workflow nunca puede
ampliarse permisos a sí mismo sin que quede a la vista) — no depende de
los permisos que se activen en Settings, es una restricción de
plataforma. Por tanto `apply-patch.yml` **no puede aplicarse a sí mismo
ni a `deploy-pages.yml`**: cualquier cambio a un archivo dentro de
`.github/workflows/` hay que subirlo a mano vía "Add file → Upload
files" en la propia web de GitHub (funciona bien en móvil, evita el
editor de código en el navegador).

### 14.3 Política de versionado

- **`v0.0.X`** — parches pequeños: fixes, ajustes de UI, mejoras
  puntuales de una mecánica existente.
- **`v0.X`** — parches gordos: una pieza nueva de gameplay o
  infraestructura de mundo (sistema de chunks dinámico, crafteo real,
  modo a pie, CONCORD). Al llegar uno de estos, el contador de parches
  pequeños vuelve a 0.
- Historial completo en `CHANGELOG.md` (raíz del repo y
  `client/public/CHANGELOG.md`, esta última es la copia que lee el propio
  juego en la pantalla de inicio).

---

## 15. Interfaz

Sección añadida al final para no renumerar las anteriores: hay
referencias cruzadas por todo el documento ("ver 5.7") que se romperían.

### 15.1 Principio — el mundo es el juego, la interfaz estorba

El juego se juega **en móvil, en vertical, con un pulgar**. Esa es la
restricción que manda sobre todo lo demás: cada elemento permanente de
interfaz es superficie de pantalla que deja de ser espacio. Por tanto:

- **Nada permanente que no se use constantemente.** Un botón que solo
  sirve a veces no se queda apagado ocupando sitio: desaparece.
- **Iconos antes que palabras.** Se leen de un vistazo, ocupan menos y no
  hay que traducirlos.
- **Ningún menú anidado en el HUD de vuelo.** Si algo necesita submenús,
  es un panel aparte (inventario, mapa, gestión de corporación), no parte
  de la interfaz de pilotar.

### 15.2 Separación mundo / interfaz

Dos capas con tecnologías distintas, decidido en v0.1.4 y confirmado
aquí:

| Capa | Tecnología | Qué contiene |
|---|---|---|
| Mundo | Phaser (canvas) | Naves, asteroides, estrella, estelas, retículas, marcadores sobre objetos |
| Interfaz | HTML/CSS nativo | Botones, paneles, menús, contadores, texto |

El motivo es la nitidez: el navegador dibuja HTML a la resolución real de
la pantalla sin configurar nada, mientras que el texto y las formas
dibujadas dentro del canvas hay que corregirlas a mano y aun así se
degradan con el zoom. Regla práctica: **si tiene coordenadas en el
espacio, es Phaser; si está pegado al borde de la pantalla, es HTML.**

### 15.3 Iconografía — un solo archivo, teñido por código

Los iconos viven en **un único atlas** (`client/public/ui/icons.png`,
rejilla 4×4 de celdas de 256 px, fondo transparente). Dos razones:

1. **Una descarga en vez de dieciséis.** En móvil con conexión mala, esa
   es la diferencia entre ver el HUD entero de golpe o verlo aparecer a
   trozos.
2. **El mismo archivo sirve a las dos capas.** En HTML se usa como
   *máscara* CSS; en Phaser como hoja de sprites. El navegador lo
   descarga una sola vez y lo reutiliza.

**Los iconos se dibujan en blanco y se colorean por código**
(`background-color` en CSS, `setTint` en Phaser). Un solo dibujo de nave
sirve para amigo, enemigo, neutral y apagado. Guardar una imagen por
color multiplicaría el peso sin ganar nada, y ataría el color a la
imagen: los colores de facción y de estado cambiarán mucho durante el
desarrollo, la forma de una nave no.

Contenido del atlas v0.2.0 (índices 0-15, orden de lectura):

| # | Icono | Uso |
|---|---|---|
| 0 | Warp | Botón de warp |
| 1 | Escanear | Módulo de escaneo direccional (5.5.2) — reservado |
| 2 | Atracar | Acción contextual: estación |
| 3 | Mapa | Mapa del sistema / grilla — reservado |
| 4 | Carga | Contador de bodega en el HUD |
| 5 | Objetivo | Fijar blanco — reservado |
| 6 | Minar | Acción contextual: asteroide |
| 7 | Arma | Combate (8.4) — reservado |
| 8 | Nave | Integridad del casco en el HUD; marcador de nave |
| 9 | Estación | Marcador de estación (§3) — reservado |
| 10 | Punto de salto | Acción contextual: activar salto (5.5) |
| 11 | Asteroide | Sprite de asteroide en el mundo |
| 12 | Contenedor | Acción contextual: abrir pecio |
| 13 | Ruina precursora | Marcador de anomalía (5.6.2) — reservado |
| 14 | Retícula fijando | Bloqueo en curso |
| 15 | Retícula fijado | Objetivo de la acción contextual |

Los marcados "reservado" están dibujados pero sin uso hasta que exista la
mecánica correspondiente. Están de antemano a propósito: el estilo
gráfico sale coherente cuando los iconos se generan de una tirada, no de
uno en uno a lo largo de meses.

### 15.4 Botón de acción contextual

**Hay un único botón de acción**, y su significado lo determina lo que el
jugador tenga a rango:

| Acción | Objeto | Pulsación |
|---|---|---|
| `mine` | Asteroide, y solo con módulo de minado montado | Mantener |
| `dock` | Estación atracable (§3) | Un toque |
| `gate` | Punto de salto reconocido (5.5) | Un toque |
| `loot` | Pecio / contenedor | Un toque |

Reglas:

- **Gana lo más cercano.** Sin menús, sin listas, sin desambiguación por
  parte del jugador. Si hay varias cosas cerca, una **retícula sobre el
  objeto elegido** dice cuál es; para cambiar de objetivo, te acercas al
  otro.
- **Si no hay nada a rango, el botón no existe** — no aparece apagado.
- **El equipamiento filtra la acción.** Una nave sin módulo de minado
  montado sencillamente no ve el botón junto a un asteroide (ver 8.2.1).
  Lo que decide es la ranura ocupada, no la clase de casco: cualquiera
  puede montar el módulo, pero la clase determina cuánto extrae, y la
  diferencia es de orden de magnitud.
- **El botón no comunica el rendimiento.** Un crucero con módulo minero
  ve exactamente el mismo botón que una minera dedicada; lo que cambia es
  la velocidad a la que sube el contador de bodega. La interfaz no tiene
  que avisar de que estás minando mal — el número lo dice solo.

**Qué NO es este botón:** no es una barra de acciones que se vaya
llenando. Si un objeto admite varias cosas (atracar en una estación y
además repararse), la acción contextual es solo la principal —
"atracar" — y el resto vive dentro del panel de la estación, no en el
HUD de vuelo.

### 15.5 Quién decide la acción — el servidor

El servidor calcula qué acción tiene disponible cada jugador y se lo
comunica. **El cliente solo dibuja lo que le dicen.** Si lo decidiera el
cliente, bastaría con manipularlo para atracar desde fuera de rango o
minar sin nave minera. El servidor vuelve a validar la capacidad al
ejecutar la acción, no solo al ofrecerla.

**Cómo viaja el dato, y por qué así.** No va por el estado replicado de
Colyseus. El estado es una pizarra compartida que se difunde a todos los
jugadores de la sala: poner ahí "este jugador tiene un asteroide a rango"
haría que ese dato llegue a los otros cuarenta y nueve pilotos del
sistema, a quienes no les sirve de nada. En su lugar:

- **Mensaje directo** al cliente afectado (`client.send`), no estado
  compartido.
- **Solo cuando el resultado cambia** respecto al anterior. Volando por
  el vacío no se transmite nada en absoluto.
- **A 4 Hz, no a los 20 Hz del tick de simulación.** Nadie percibe 250 ms
  de retraso en que se ilumine un botón, y recalcularlo veinte veces por
  segundo sería tirar el 80% del cálculo a la basura.

Este patrón —*información que solo le importa a un jugador va por mensaje
privado, con envío por cambio y no por tick*— debería ser la norma para
todo lo que sea interfaz: avisos, resultados de escaneo, notificaciones
de corporación. El estado replicado se reserva para lo que de verdad
tienen que ver todos: posiciones, estructuras, propiedad.

**Deuda técnica reconocida.** La búsqueda de lo que hay a rango recorre
hoy todos los objetos del chunk por cada jugador. Con pocos pilotos y 120
asteroides es irrelevante. Cuando un chunk tenga cientos de objetos y
decenas de naves hará falta una **rejilla espacial** (dividir el chunk en
casillas y consultar solo las nueve vecinas). No se implementa todavía a
propósito: añade complejidad para resolver un problema que aún no existe,
y encaja de forma natural con el trabajo de degradación bajo carga (5.4),
que necesitará esa misma rejilla para construir el área de interés.

### 15.6 Pendiente de diseñar

- Disposición del HUD en horizontal y en pantallas grandes (hoy todo está
  pensado para vertical a una mano).
- Panel de estación: qué se ve al atracar y cómo se navega (§3).
- Representación de escudo/armadura/casco cuando existan las tres capas
  (8.4): hoy solo hay un número de integridad.
- Overview tipo EVE (lista textual de objetos del sistema) — si existe,
  cómo convive con un HUD pensado para no tener listas.
- Marcadores en el borde de la pantalla para objetos fuera de vista.
