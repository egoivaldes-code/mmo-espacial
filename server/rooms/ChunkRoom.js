const { Room } = require("colyseus");
const { ChunkState } = require("../schema/ChunkState");
const persistence = require("../persistence");
const combat = require("../combat");
const { Npc } = require("../schema/Npc");
const { Player } = require("../schema/Player");
const { Asteroid } = require("../schema/Asteroid");
const { getShipStats } = require("../data/shipStats");

// Ajustes simples del prototipo. Nada de esto es definitivo, es fase 0.
const WORLD_SIZE = 30000; // el "chunk" es grande en espacio, poco denso — tamaño de diseño (5.5)
const MINING_RANGE = 80;
const MINING_RATE_BASE = 5; // recurso por tick con multiplicador ×1 (ver 8.2.1)
const TICK_RATE = 20; // Hz
const RECONNECT_GRACE_S = 90; // ventana para volver tras un corte de socket

// Física de vuelo — modelo tipo Asteroids/Newtoniano, no "velocidad
// instantánea en la dirección del input". El input marca hacia dónde
// QUIERE girar la nave (rumbo deseado); el morro gira hacia ahí a una
// velocidad angular limitada por nave (ver PLAYER_SHIP_STATS.turnRate);
// el empuje se aplica en la dirección hacia la que la nave está
// físicamente orientada en ESE instante, no hacia el rumbo deseado.
// Girar rápido a alta velocidad no es instantáneo — de ahí la
// deriva/elipses en vez de círculos perfectos al intentar orbitar algo.
//
// Ahora mismo solo hay una nave por rol (crucero para jugador, crucero
// para NPC — ver DEFAULT_PLAYER_SHIP_ID / DEFAULT_NPC_SHIP_ID más abajo),
// pero sus valores de giro/empuje/velocidad/escudo/firma ya salen del
// catálogo real por clase (server/data/shipStats.js) en vez de estar
// escritos a mano. Cuando exista selección de nave, cada jugador tendrá
// los suyos según su shipId sin tocar este archivo.
const DRAG = 0.6; // fracción de velocidad perdida por segundo (fricción suave)

// Joystick analógico (8.4.10.3 del diseño): por debajo de PIVOT_THRESHOLD
// no hay dirección — es la zona muerta del centro. Entre PIVOT_THRESHOLD y
// THRUST_THRESHOLD la nave SOLO gira hacia esa dirección, sin empuje —
// deja pivotar/apuntar con un toque suave sin salir disparado. Por
// encima de THRUST_THRESHOLD el empuje entra progresivamente, de 0 en el
// umbral a 100% con el joystick a tope — no es un interruptor de golpe.
const PIVOT_THRESHOLD = 0.12;
const THRUST_THRESHOLD = 0.45;

const DEFAULT_PLAYER_SHIP_ID = "cruiser_01"; // FHI Warden
const DEFAULT_NPC_SHIP_ID = "cruiser_04"; // FHI Bastion

// Sistema de warp — pensado como "impulso" en la dirección actual de
// vuelo, no como salto a un punto elegido (eso se dejó para más
// adelante). Necesitas ya estar en movimiento para poder activarlo.
//
// WARP_CHARGE_TIME es el tiempo de carga de la única nave que hay en el
// juego ahora mismo (FHI Wren). Cuando exista selección real de nave,
// debería variar por clase (más grande/pesada = carga más lenta) — ver
// ships.json en client/public/ships/.
const WARP_CHARGE_TIME = 10; // segundos
const WARP_SPEED_MULTIPLIER = 5; // 500% de MAX_SPEED durante el warp
const WARP_COOLDOWN = 30; // segundos, empieza a contar al activar la carga

// --- Acción contextual ----------------------------------------------------
// El HUD tiene UN solo botón de acción, y su significado depende de lo que
// el jugador tenga a rango: minar un asteroide, atracar en una estación,
// activar un punto de salto, abrir un pecio. Quien decide cuál toca es el
// SERVIDOR, no el cliente: si lo decidiera el cliente, bastaría con
// manipularlo para "atracar" en una estación enemiga desde lejos.
//
// El cálculo NO va al estado replicado de Colyseus. Si fuera un campo del
// Player, cada cambio se enviaría a todos los jugadores de la sala aunque
// solo le importe a uno. En vez de eso se manda un mensaje directo al
// cliente afectado, y solo cuando el resultado cambia respecto al anterior:
// volando por el vacío no se envía absolutamente nada.
// --- Guardado en base de datos -------------------------------------------
// NO se guarda cada tick. Escribir en la base 20 veces por segundo y por
// jugador la fundiría, y sería inútil: si el servidor se cae, perder los
// últimos segundos de vuelo no le importa a nadie. Se guarda cada 30 s y
// solo de quienes hayan cambiado algo desde el último guardado.
const SAVE_INTERVAL_MS = 30000;

const ACTION_SCAN_HZ = 4; // veces por segundo que se recalcula (20 sería tirar CPU)
const ACTION_SCAN_INTERVAL = 1000 / ACTION_SCAN_HZ;
const DOCK_RANGE = 250;
const GATE_RANGE = 250;
const LOOT_RANGE = 120;

// ===========================================================================
// COMBATE (ver 8.4 del documento de diseño)
//
// Escala: crucero contra crucero, armamento Medium. Todos estos valores son
// de PARTIDA, para poder probar si el combate se siente bien. El balance real
// necesita jugarlo, no calcularlo.
// ===========================================================================

// Arma única de esta versión: Medium de corto alcance. Las otras siete
// familias (8.4.5) entran encima de esta misma estructura sin rehacer nada.
const ARMA_MEDIUM_CORTA = {
  id: "autocannon_m",
  // 170 y no 110: con la regeneración de escudo original, orbitar pegado
  // daba inmunidad de facto (simulado: 162s sin un rasguño). Subir el daño
  // y bajar la regeneración a la mitad deja el orbiteo como ventaja real
  // pero no absoluta — ver la comparativa simulada más abajo.
  damage: 170,         // daño de un ciclo con calidad perfecta
  cycle: 3.0,         // segundos entre disparos: pocos y gordos, no muchos y
                      // pequeños — cada disparo es un mensaje de red (8.4.2)
  tracking: 0.8,      // rad/s de velocidad angular que aguanta sin perder daño
  signatureRef: 120,  // firma para la que está calibrada: la de un crucero
  optimal: 600,       // dentro de esto pega entero
  falloff: 300,       // más allá cae rápido
  energyCost: 18,     // por ciclo
};

const LOCK_TIME = 4.0;        // segundos para fijar un objetivo
const LOCK_RANGE = 2000;      // no se puede fijar más lejos
const MAX_TARGETS = 3;        // objetivos simultáneos por nave

const CRUISER_SHIELD_REGEN = 5;    // por segundo; la estructura NO se regenera
// Simulado con este balance (crucero vs crucero, ambos disparando 3s/ciclo):
//   quieto todo el combate     -> gana en ~24s, llega con 127/698 estructura
//   orbitando a 550u (rango)   -> gana en ~42s, llega con 133/698
//   orbitando pegado a 300u    -> gana en ~63s, llega con 231/698 (el más seguro)
// Orbitar sigue siendo la opción defensiva real, pero deja de ser inmunidad.
// (HP/escudo/firma reales del Warden — ver PLAYER_SHIP_STATS más abajo)

const CAPACITOR_MAX = 1000;
const CAPACITOR_REGEN = 22;   // por segundo

// El enemigo: FHI Bastion, algo más blando que el jugador para que la primera
// pelea se pueda ganar mientras se aprende a colocarse. Sus stats reales
// (HP/escudo/firma/velocidad) salen del catálogo — ver NPC_SHIP_STATS.
const NPC_COUNT = 2;
const NPC_RESPAWN_S = 30;
const NPC_AGGRO_RANGE = 1400;   // a partir de aquí te ataca
const NPC_ORBIT_RANGE = 550;    // distancia a la que intenta mantenerse

// Resueltos una vez al arrancar la sala — ambos son homogéneos hoy (una
// sola nave por rol), así que no hace falta recalcular por jugador/NPC.
// El día que haya selección de nave, el jugador pasa a resolverse por
// persona en onJoin (ver más abajo) igual que ya se prepara aquí.
const PLAYER_SHIP_STATS = getShipStats(DEFAULT_PLAYER_SHIP_ID);
const NPC_SHIP_STATS = getShipStats(DEFAULT_NPC_SHIP_ID);

// La IA piensa 4 veces por segundo, no 20. Reevaluar la maniobra cada 250 ms
// basta de sobra para orbitar y disparar, y cuesta la quinta parte. Con
// decenas de NPCs esa diferencia es la que decide si el chunk aguanta.
const NPC_THINK_HZ = 4;
const NPC_THINK_INTERVAL = 1000 / NPC_THINK_HZ;

// --- Minado: quién puede y cuánto (ver 8.2.1 del documento de diseño) ----
//
// Dos preguntas distintas, y es importante que estén separadas:
//
//   1. ¿PUEDE minar?  -> depende del MÓDULO montado, no del casco.
//      Cualquier nave puede montar un módulo minero sacrificando una
//      ranura. Esto es lo que decide si aparece el botón.
//
//   2. ¿CUÁNTO extrae? -> depende del CASCO, y la diferencia es de orden
//      de magnitud (~×10 para una minera dedicada). Un crucero con módulo
//      minero ve el mismo botón, pero llena la bodega diez veces más
//      despacio.
//
// El bonus va deliberadamente en el casco y no en el módulo: si estuviera
// en el módulo bastaría con comprar el bueno y montarlo donde fuera, y la
// nave minera dejaría de tener sentido.
//
// PROVISIONAL: no existe todavía sistema de módulos ni clase minera en
// ships.json, y la lanzadera inicial es la única nave jugable — si le
// quitamos el minado no queda nada que hacer. Por eso hoy todo el mundo
// "lleva módulo" y todo el mundo extrae a ×1. Cuando existan módulos y
// clases, estas dos funciones pasan a consultarlos y no cambia nada más.
function hasMiningModule(_player) {
  return true;
}

function miningMultiplier(_player) {
  return 1;
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

// Diferencia angular más corta entre dos ángulos, en [-PI, PI]. Necesaria
// para saber hacia qué lado girar (y cuánto) sin dar la vuelta larga.
function angleDiff(from, to) {
  let diff = (to - from) % (Math.PI * 2);
  if (diff > Math.PI) diff -= Math.PI * 2;
  if (diff < -Math.PI) diff += Math.PI * 2;
  return diff;
}

class ChunkRoom extends Room {
  onCreate() {
    this.setState(new ChunkState());
    this.setPatchRate(1000 / TICK_RATE);

    // Input del cliente: { angle, magnitude, mining }. `angle` en radianes
    // (o null si no se toca el mando) y `magnitude` 0..1 (cuánto se ha
    // desplazado el joystick, o 1 fijo para teclado). Nunca nos fiamos de
    // lo que manda el cliente sin acotar — un magnitude fuera de rango o
    // un angle no numérico rompería la física del tick.
    this.onMessage("input", (client, input) => {
      const player = this.state.players.get(client.sessionId);
      if (!player) return;
      const angle =
        typeof input?.angle === "number" && Number.isFinite(input.angle) ? input.angle : null;
      const magnitude =
        typeof input?.magnitude === "number" && Number.isFinite(input.magnitude)
          ? clamp(input.magnitude, 0, 1)
          : 0;
      player.input = { angle, magnitude, mining: Boolean(input?.mining) };

      // Tocar el mando para dirigir la nave cancela el crucero — es la
      // forma de "soltar el piloto automático" (8.4.10.3). El umbral es
      // el mismo PIVOT_THRESHOLD que decide si hay dirección de verdad,
      // así que un roce accidental no lo desactiva por error.
      if (player.cruising && angle !== null && magnitude > PIVOT_THRESHOLD) {
        player.cruising = false;
      }
    });

    // Activa/desactiva el "piloto crucero": la nave sigue viajando sola a
    // la velocidad y rumbo que llevaba en ese momento, sin fricción ni
    // input, hasta que se vuelve a tocar el mando (ver arriba) o se entra
    // en warp. Pensado para dejar la nave viajando largo trecho sin tener
    // que mantener el dedo en la pantalla — ver 8.4.10.3.
    this.onMessage("cruiseToggle", (client) => {
      const player = this.state.players.get(client.sessionId);
      if (!player || !player.alive) return;
      if (player.warping || player.warpCharging) return; // no tiene sentido en warp
      if (player.cruising) {
        player.cruising = false;
        return;
      }
      const speed = Math.hypot(player.vx || 0, player.vy || 0);
      if (speed < 5) return; // parado no hay nada que "dejar viajando"
      player.cruising = true;
    });

    // Ping/pong para que el cliente pueda medir su latencia.
    this.onMessage("ping", (client, timestamp) => {
      client.send("pong", timestamp);
    });

    // La conexión puede arrancar en segundo plano con un nombre
    // provisional mientras el jugador aún está eligiendo personaje en el
    // cliente — esto permite corregirlo una vez lo confirma.
    this.onMessage("setName", (client, name) => {
      const player = this.state.players.get(client.sessionId);
      if (!player || typeof name !== "string") return;
      const trimmed = name.trim().slice(0, 16);
      if (trimmed) player.name = trimmed;
    });

    // Preferencia del jugador (por defecto activada): si un NPC te
    // marca como objetivo, tú lo fijas automáticamente de vuelta — ver
    // el disparo real en updateNpcs(). Es ajuste de cliente (se guarda
    // en su localStorage, no en Supabase), pero quien decide FIJAR de
    // verdad sigue siendo el servidor (15.5) — el cliente solo manda su
    // preferencia, nunca el fijado en sí.
    this.onMessage("setAutoTargetBack", (client, value) => {
      const player = this.state.players.get(client.sessionId);
      if (!player) return;
      player.autoTargetBack = Boolean(value);
    });

    // Un único mensaje conmuta los tres estados del warp: si está
    // inactivo (y sin enfriamiento) arranca la carga; si está cargando o
    // ya viajando, lo cancela y para la nave en seco donde esté. Toda la
    // decisión vive en el servidor — el cliente solo pulsa el botón.
    // --- Combate ---------------------------------------------------------
    // Fijar objetivo. El cliente manda A QUIÉN quiere fijar; el servidor
    // decide si puede (rango, límite de objetivos) y cuánto tarda.
    this.onMessage("lock", (client, msg) => {
      const player = this.state.players.get(client.sessionId);
      if (!player || !player.alive) return;
      this.startLock(client, player, msg?.kind, msg?.id);
    });

    this.onMessage("unlock", (client, msg) => {
      const combatState = this.combatState.get(client.sessionId);
      if (!combatState) return;
      combatState.targets = combatState.targets.filter(
        (t) => !(t.kind === msg?.kind && t.id === msg?.id)
      );
      if (combatState.activeTarget && combatState.activeTarget.id === msg?.id) {
        combatState.activeTarget = combatState.targets[0] || null;
      }
      this.sendCombatState(client);
    });

    // Disparar es un INTERRUPTOR, no un disparo. El cliente manda "enciende"
    // y "apaga"; los ciclos los cuenta el servidor. Un reparador encendido
    // dos minutos son dos mensajes, no cuarenta (8.4.10).
    this.onMessage("fireToggle", (client, on) => {
      const combatState = this.combatState.get(client.sessionId);
      if (!combatState) return;
      combatState.firing = typeof on === "boolean" ? on : !combatState.firing;
      this.sendCombatState(client);
    });

    // Autoshoot: al terminar de fijar, empieza a disparar solo. Es la casilla
    // pensada para jugar desde el móvil o estar AFK (8.4.10.1).
    this.onMessage("autoShoot", (client, on) => {
      const combatState = this.combatState.get(client.sessionId);
      if (!combatState) return;
      combatState.autoShoot = Boolean(on);
      if (combatState.autoShoot && combatState.activeTarget) combatState.firing = true;
      this.sendCombatState(client);
    });

    this.onMessage("warpToggle", (client) => {
      const player = this.state.players.get(client.sessionId);
      if (!player) return;

      if (player.warpCharging || player.warping) {
        player.warpCharging = false;
        player.warpChargeRemaining = 0;
        player.warping = false;
        player.invulnerable = false;
        player.vx = 0;
        player.vy = 0;
        return;
      }

      if (player.warpCooldownRemaining > 0) return; // todavía enfriando

      player.warpCharging = true;
      player.warpChargeRemaining = WARP_CHARGE_TIME;
      player.warpCooldownRemaining = WARP_COOLDOWN;
    });

    // sessionId -> última acción notificada, para no reenviar lo mismo.
    this.lastAction = new Map();
    this.actionScanAccum = 0;

    // Estado de combate por jugador. NO va al estado replicado: energía,
    // objetivos y recargas solo le importan a su dueño (8.4.8). Se manda por
    // mensaje privado y solo cuando cambia algo que se ve.
    this.combatState = new Map();
    this.npcBrains = new Map();
    this.npcThinkAccum = 0;
    this.npcRespawnQueue = [];
    this.nextNpcId = 1;
    this.saveAccum = 0;

    // spawnAsteroids/spawnNpc van AQUÍ, al final de onCreate, y no al
    // principio.
    //
    // BUG REAL (v0.5.0, encontrado en producción): spawnNpc() escribe en
    // this.npcBrains (un Map, ver arriba) además de en this.state.npcs.
    // Llamarlo al principio del método — antes de que "this.npcBrains =
    // new Map()" se ejecutara más abajo en el mismo onCreate — significaba
    // que this.npcBrains todavía era undefined, y
    // "this.npcBrains.set(id, ...)" reventaba con exactamente el mismo
    // mensaje que dio tantas vueltas: "Cannot read properties of
    // undefined (reading 'set')". El fallo no estaba en el schema de
    // Colyseus ni en Npc.js — sencillamente el método se llamaba antes de
    // que el objeto que necesitaba existiera todavía.
    //
    // Con WORLD_SIZE=30.000 (56x más área que el valor de prototipo
    // anterior), 15 asteroides quedarían invisibles la mayor parte del
    // tiempo. 120 sigue siendo un valor de prototipo, no densidad final
    // calibrada — solo para que el mundo no se sienta vacío al explorar.
    this.spawnAsteroids(120);
    for (let i = 0; i < NPC_COUNT; i++) this.spawnNpc();

    this.setSimulationInterval((deltaMs) => this.update(deltaMs), 1000 / TICK_RATE);
  }

  // =========================================================================
  // COMBATE
  // =========================================================================

  nuevoCombatState() {
    return {
      targets: [],        // [{kind, id, progress, locked}]
      activeTarget: null,
      firing: false,
      autoShoot: false,
      capacitor: CAPACITOR_MAX,
      cycleAccum: 0,
    };
  }

  // Busca la entidad real detrás de un objetivo fijado. Devuelve null si ya
  // no existe (murió, se fue, se agotó el asteroide): fijar algo no impide
  // que desaparezca, y el resto del código no debe asumir que sigue ahí.
  resolverEntidad(target) {
    if (!target) return null;
    if (target.kind === "npc") return this.state.npcs.get(target.id) || null;
    if (target.kind === "player") {
      const p = this.state.players.get(target.id);
      return p && p.alive ? p : null;
    }
    if (target.kind === "asteroid") {
      const a = this.state.asteroids.get(target.id);
      return a && a.amount > 0 ? { ...a, signature: 200, vx: 0, vy: 0, x: a.x, y: a.y } : null;
    }
    return null;
  }

  startLock(client, player, kind, id) {
    const combatState = this.combatState.get(client.sessionId);
    if (!combatState) return;

    // Ya fijado o fijándose: no se duplica.
    if (combatState.targets.some((t) => t.kind === kind && t.id === id)) return;
    if (combatState.targets.length >= MAX_TARGETS) return;

    const entidad = this.resolverEntidad({ kind, id });
    if (!entidad) return;

    const dist = Math.hypot(entidad.x - player.x, entidad.y - player.y);
    if (dist > LOCK_RANGE) return;

    combatState.targets.push({ kind, id, progress: 0, locked: false });
    this.sendCombatState(client);
  }

  // Si un NPC ACABA de elegir a este jugador como objetivo (ver
  // updateNpcs: contraataque y agresión por rango), y el jugador tiene
  // activada la preferencia (por defecto sí), se le fija automáticamente
  // de vuelta — le ahorra el toque manual justo cuando más ocupado está
  // esquivando. Pasa por el mismo startLock de siempre: respeta el
  // límite de objetivos simultáneos y el rango de fijado, nada especial.
  intentarAutoTargetBack(sessionId, npcId) {
    const player = this.state.players.get(sessionId);
    if (!player || !player.alive || player.autoTargetBack === false) return;
    const client = this.clients.find((c) => c.sessionId === sessionId);
    if (!client) return;
    this.startLock(client, player, "npc", npcId);
  }

  // Avance del fijado y disparo, por jugador. Se llama desde update().
  updateCombat(deltaMs) {
    const dt = deltaMs / 1000;

    this.clients.forEach((client) => {
      const player = this.state.players.get(client.sessionId);
      const cs = this.combatState.get(client.sessionId);
      if (!player || !cs) return;

      let cambio = false;

      // Capacitor: se regenera siempre. Es el recurso que limita cuánto
      // puedes mantener encendido a la vez (8.4.3).
      const capAntes = cs.capacitor;
      cs.capacitor = Math.min(CAPACITOR_MAX, cs.capacitor + CAPACITOR_REGEN * dt);

      // Escudo: se regenera solo. La estructura no, y esa asimetría es lo
      // que hace que perder el escudo importe de verdad.
      if (player.alive) {
        combat.regenerarEscudo(player, PLAYER_SHIP_STATS.shield, CRUISER_SHIELD_REGEN, dt);
      }

      // Avance de los fijados. Se cae el objetivo que desaparece o se aleja.
      for (const target of cs.targets) {
        const entidad = this.resolverEntidad(target);
        if (!entidad) { target.dead = true; cambio = true; continue; }

        const dist = Math.hypot(entidad.x - player.x, entidad.y - player.y);
        if (dist > LOCK_RANGE * 1.2) { target.dead = true; cambio = true; continue; }

        if (!target.locked) {
          target.progress = Math.min(1, target.progress + dt / LOCK_TIME);
          if (target.progress >= 1) {
            target.locked = true;
            cambio = true;
            if (!cs.activeTarget) cs.activeTarget = target;
            // La casilla de autodisparo: en cuanto el fijado termina, abre
            // fuego sin que el jugador tenga que pulsar nada.
            if (cs.autoShoot) cs.firing = true;
          }
        }
      }

      const antes = cs.targets.length;
      cs.targets = cs.targets.filter((t) => !t.dead);
      if (cs.targets.length !== antes) cambio = true;
      if (cs.activeTarget && cs.activeTarget.dead) cs.activeTarget = null;
      if (!cs.activeTarget) cs.activeTarget = cs.targets.find((t) => t.locked) || null;
      if (!cs.activeTarget && cs.firing) { cs.firing = false; cambio = true; }

      // Barra de fijado que sí ven los demás: solo el más avanzado, para que
      // la retícula del cliente tenga algo que dibujar sin replicar la lista
      // entera de objetivos de cada jugador.
      const enCurso = cs.targets.find((t) => !t.locked);
      const locking = Boolean(enCurso);
      const progress = enCurso ? enCurso.progress : 0;
      if (player.locking !== locking) player.locking = locking;
      if (Math.abs(player.lockProgress - progress) > 0.02) player.lockProgress = progress;

      // Ciclo de arma.
      if (cs.firing && cs.activeTarget?.locked && player.alive && !player.warping) {
        cs.cycleAccum += dt;
        if (cs.cycleAccum >= ARMA_MEDIUM_CORTA.cycle) {
          cs.cycleAccum = 0;
          this.dispararCiclo(client, player, cs);
          cambio = true;
        }
      } else {
        cs.cycleAccum = 0;
      }

      // Solo se avisa al cliente si cambió algo relevante, o cada vez que el
      // capacitor se mueve lo bastante para verse en la barra. Mandar el
      // capacitor cada tick sería el mensaje más frecuente del juego y no
      // aportaría nada: nadie distingue 1% de diferencia.
      if (cambio || Math.abs(cs.capacitor - capAntes) > CAPACITOR_MAX * 0.02) {
        this.sendCombatState(client);
      }
    });
  }

  dispararCiclo(client, player, cs) {
    const entidad = this.resolverEntidad(cs.activeTarget);
    if (!entidad) return;

    if (cs.capacitor < ARMA_MEDIUM_CORTA.energyCost) {
      // Sin energía no se dispara. El cliente lo enseña como botón agotado,
      // que es distinto de apagado (15.4.1).
      return;
    }

    const resultado = combat.resolverDisparo(ARMA_MEDIUM_CORTA, player, entidad);
    if (!resultado) return; // fuera de alcance: ni gasta energía ni avisa

    cs.capacitor -= ARMA_MEDIUM_CORTA.energyCost;

    // BUG REAL corregido aquí (crash en producción, v0.5.7): kind/id se
    // capturan en variables locales AHORA, porque más abajo destruirNpc()
    // recorre TODOS los clientes — incluido este mismo — y si el objetivo
    // que se acaba de destruir era el activeTarget de este jugador (el
    // caso normal: le disparas y lo matas), le reasigna cs.activeTarget a
    // otro objetivo fijado o a null. Seguir leyendo cs.activeTarget.kind/
    // .id DESPUÉS de esa llamada podía leer de un cs.activeTarget ya
    // puesto a null por la propia destrucción que acababa de causar este
    // disparo — de ahí el "Cannot read properties of null (reading 'id')"
    // que tumbaba el proceso entero (y con él, a todos los conectados).
    const targetKind = cs.activeTarget.kind;
    const targetId = cs.activeTarget.id;

    let destruida = false;
    if (targetKind === "npc") {
      const npc = this.state.npcs.get(targetId);
      const efecto = combat.aplicarDano(npc, resultado.damage);
      destruida = efecto.destruida;
      if (destruida) this.destruirNpc(targetId);
      // El NPC devuelve el golpe a quien le pega.
      const brain = this.npcBrains.get(targetId);
      if (brain && !brain.targetSessionId) {
        brain.targetSessionId = client.sessionId;
        this.intentarAutoTargetBack(client.sessionId, targetId);
      }
    } else if (targetKind === "player") {
      const otro = this.state.players.get(targetId);
      if (otro) {
        const efecto = combat.aplicarDano(otro, resultado.damage);
        destruida = efecto.destruida;
        if (destruida) this.matarJugador(targetId);
      }
    }

    // Un mensaje por ciclo, con los factores desglosados: el jugador tiene
    // que poder ver POR QUÉ el disparo fue flojo, o no aprenderá a colocarse
    // y concluirá que pilotar no sirve de nada (8.4.10).
    client.send("shot", {
      kind: targetKind,
      id: targetId,
      damage: Math.round(resultado.damage),
      quality: Math.round(resultado.quality * 100),
      angular: Math.round(resultado.angular * 100),
      range: Math.round(resultado.rango * 100),
      destroyed: destruida,
    });
  }

  sendCombatState(client) {
    const cs = this.combatState.get(client.sessionId);
    if (!cs) return;
    client.send("combat", {
      capacitor: Math.round(cs.capacitor),
      capacitorMax: CAPACITOR_MAX,
      firing: cs.firing,
      autoShoot: cs.autoShoot,
      targets: cs.targets.map((t) => ({
        kind: t.kind,
        id: t.id,
        progress: Math.round(t.progress * 100) / 100,
        locked: t.locked,
        active: cs.activeTarget === t,
      })),
    });
  }

  // =========================================================================
  // NPCs
  // =========================================================================

  spawnNpc() {
    const id = `npc-${this.nextNpcId++}`;
    const npc = new Npc();
    const ang = Math.random() * Math.PI * 2;
    const dist = 1500 + Math.random() * 1500;
    npc.x = Math.cos(ang) * dist;
    npc.y = Math.sin(ang) * dist;
    npc.shipId = DEFAULT_NPC_SHIP_ID;
    npc.name = "Hostil";
    npc.shield = NPC_SHIP_STATS.shield;
    npc.structure = NPC_SHIP_STATS.hp;
    npc.signature = NPC_SHIP_STATS.signature;
    this.state.npcs.set(id, npc);
    this.npcBrains.set(id, {
      targetSessionId: null,
      cycleAccum: 0,
      vx: 0,
      vy: 0,
      orbitDir: Math.random() < 0.5 ? 1 : -1,
    });
    return id;
  }

  destruirNpc(id) {
    this.state.npcs.delete(id);
    this.npcBrains.delete(id);
    this.npcRespawnQueue.push({ at: Date.now() + NPC_RESPAWN_S * 1000 });
    // Se limpia de los objetivos de todos: fijar algo destruido no debe
    // dejar retículas fantasma flotando en la pantalla de nadie.
    this.clients.forEach((client) => {
      const cs = this.combatState.get(client.sessionId);
      if (!cs) return;
      const antes = cs.targets.length;
      cs.targets = cs.targets.filter((t) => !(t.kind === "npc" && t.id === id));
      if (cs.activeTarget?.id === id) cs.activeTarget = cs.targets.find((t) => t.locked) || null;
      if (cs.targets.length !== antes) this.sendCombatState(client);
    });
  }

  // IA deliberadamente barata y a 4 Hz (ver NPC_THINK_HZ). Persigue, orbita a
  // una distancia fija y dispara. Nada de predecir trayectorias: eso es caro
  // y además haría al NPC demasiado bueno para lo que hace falta ahora.
  updateNpcs(deltaMs) {
    const dt = deltaMs / 1000;

    // Movimiento: cada tick, porque si no se mueven a tirones.
    this.state.npcs.forEach((npc, id) => {
      const brain = this.npcBrains.get(id);
      if (!brain) return;
      npc.x += brain.vx * dt;
      npc.y += brain.vy * dt;
      if (brain.vx || brain.vy) npc.rotation = Math.atan2(brain.vy, brain.vx) + Math.PI / 2;
      combat.regenerarEscudo(npc, NPC_SHIP_STATS.shield, CRUISER_SHIELD_REGEN * 0.5, dt);
    });

    // Decisión: solo 4 veces por segundo.
    this.npcThinkAccum += deltaMs;
    if (this.npcThinkAccum < NPC_THINK_INTERVAL) return;
    const pensarDt = this.npcThinkAccum / 1000;
    this.npcThinkAccum = 0;

    this.state.npcs.forEach((npc, id) => {
      const brain = this.npcBrains.get(id);
      if (!brain) return;

      let objetivo = brain.targetSessionId
        ? this.state.players.get(brain.targetSessionId)
        : null;
      if (objetivo && (!objetivo.alive || objetivo.warping)) objetivo = null;

      // Buscar al jugador vivo más cercano dentro del rango de agresión.
      if (!objetivo) {
        let mejor = null;
        let mejorDist = NPC_AGGRO_RANGE;
        this.state.players.forEach((p, sid) => {
          if (!p.alive || p.warping) return;
          const d = Math.hypot(p.x - npc.x, p.y - npc.y);
          if (d < mejorDist) { mejorDist = d; mejor = sid; }
        });
        brain.targetSessionId = mejor;
        objetivo = mejor ? this.state.players.get(mejor) : null;
        if (mejor) this.intentarAutoTargetBack(mejor, id);
      }

      if (!objetivo) {
        brain.vx *= 0.9;
        brain.vy *= 0.9;
        if (npc.firing) npc.firing = false;
        return;
      }

      const dx = objetivo.x - npc.x;
      const dy = objetivo.y - npc.y;
      const dist = Math.hypot(dx, dy) || 1;

      // Se pierde el interés si el jugador se va lo bastante lejos.
      if (dist > NPC_AGGRO_RANGE * 1.6) {
        brain.targetSessionId = null;
        if (npc.firing) npc.firing = false;
        return;
      }

      // Acercarse o alejarse hasta la distancia de órbita, y orbitar. La
      // combinación de las dos componentes da un movimiento circular sin
      // tener que calcular ninguna trayectoria.
      const ux = dx / dist;
      const uy = dy / dist;
      const radial = (dist - NPC_ORBIT_RANGE) / NPC_ORBIT_RANGE;
      const acercarse = Math.max(-1, Math.min(1, radial));
      const tangX = -uy * brain.orbitDir;
      const tangY = ux * brain.orbitDir;

      const deseadaX = (ux * acercarse + tangX * 0.9) * NPC_SHIP_STATS.maxSpeed;
      const deseadaY = (uy * acercarse + tangY * 0.9) * NPC_SHIP_STATS.maxSpeed;

      // Suavizado: la nave no cambia de rumbo instantáneamente.
      brain.vx += (deseadaX - brain.vx) * Math.min(1, pensarDt * 2);
      brain.vy += (deseadaY - brain.vy) * Math.min(1, pensarDt * 2);

      // Disparo del NPC. Mismo arma y mismas fórmulas que el jugador: si el
      // jugador se coloca bien, el NPC también falla.
      brain.cycleAccum += pensarDt;
      const disparando = dist < ARMA_MEDIUM_CORTA.optimal + ARMA_MEDIUM_CORTA.falloff * 3;
      if (npc.firing !== disparando) npc.firing = disparando;

      if (disparando && brain.cycleAccum >= ARMA_MEDIUM_CORTA.cycle) {
        brain.cycleAccum = 0;
        const tirador = { x: npc.x, y: npc.y, vx: brain.vx, vy: brain.vy };
        const resultado = combat.resolverDisparo(ARMA_MEDIUM_CORTA, tirador, objetivo);
        if (resultado) {
          const efecto = combat.aplicarDano(objetivo, resultado.damage);
          const client = this.clients.find((c) => c.sessionId === brain.targetSessionId);
          if (client) {
            client.send("hit", {
              from: id,
              damage: Math.round(resultado.damage),
              shield: Math.round(objetivo.shield),
              structure: Math.round(objetivo.structure),
            });
          }
          if (efecto.destruida) this.matarJugador(brain.targetSessionId);
        }
      }
    });

    // Reaparición de los destruidos.
    const ahora = Date.now();
    while (this.npcRespawnQueue.length && this.npcRespawnQueue[0].at <= ahora) {
      this.npcRespawnQueue.shift();
      this.spawnNpc();
    }
  }

  // Muerte del jugador. PROVISIONAL: reaparece en el centro con todo lleno.
  // El diseño (8.4) dice que morir cuesta la nave entera, pero eso necesita
  // inventario, seguro y equidad de pérdida — sistemas que aún no existen.
  // Poner ahora una penalización a medias sería peor que no poner ninguna.
  matarJugador(sessionId) {
    const player = this.state.players.get(sessionId);
    if (!player || !player.alive) return;
    player.alive = false;
    player.shield = 0;
    player.structure = 0;
    player.cruising = false;

    const client = this.clients.find((c) => c.sessionId === sessionId);
    if (client) client.send("destroyed", {});

    setTimeout(() => {
      const p = this.state.players.get(sessionId);
      if (!p) return;
      p.x = (Math.random() - 0.5) * 400;
      p.y = (Math.random() - 0.5) * 400;
      p.vx = 0;
      p.vy = 0;
      p.shield = PLAYER_SHIP_STATS.shield;
      p.structure = PLAYER_SHIP_STATS.hp;
      p.alive = true;
      p.cruising = false;
      const cs = this.combatState.get(sessionId);
      if (cs) {
        cs.targets = [];
        cs.activeTarget = null;
        cs.firing = false;
        cs.capacitor = CAPACITOR_MAX;
      }
      // Los NPCs que le perseguían pierden el rastro: reaparecer y que te
      // sigan esperando encima es una muerte segura en bucle.
      this.npcBrains.forEach((brain) => {
        if (brain.targetSessionId === sessionId) brain.targetSessionId = null;
      });
      const c2 = this.clients.find((c) => c.sessionId === sessionId);
      if (c2) { this.sendCombatState(c2); c2.send("respawned", {}); }
    }, 5000);
  }

  spawnAsteroids(count) {
    for (let i = 0; i < count; i++) {
      const id = `ast_${i}`;
      const x = Math.random() * WORLD_SIZE - WORLD_SIZE / 2;
      const y = Math.random() * WORLD_SIZE - WORLD_SIZE / 2;
      this.state.asteroids.set(id, new Asteroid(id, x, y, 100));
    }
  }

  // Colyseus llama a onAuth ANTES de onJoin. Si devuelve null o lanza, el
  // jugador no entra. Aquí es donde se comprueba que quien dice ser el
  // dueño de un personaje lo es de verdad.
  //
  // Si la persistencia no está configurada (desarrollo local sin claves),
  // se deja entrar como invitado sin guardado, para no bloquear las
  // pruebas.
  async onAuth(client, options) {
    if (!persistence.enabled) {
      return { guest: true, name: options?.name || "Piloto" };
    }

    const userId = await persistence.verifyToken(options?.accessToken);
    if (!userId) {
      throw new Error("Sesión no válida. Vuelve a iniciar sesión.");
    }

    // El personaje tiene que existir y ser de este usuario. Esta consulta
    // es la que impide que alguien mande el id del personaje de otro.
    const character = await persistence.loadCharacter(userId, options?.characterId);
    if (!character) {
      throw new Error("Ese personaje no existe o no es tuyo.");
    }

    return { guest: false, userId, character };
  }

  onJoin(client, options, auth) {
    // Si ya hay un Player para este sessionId es una reconexión dentro de
    // la ventana de allowReconnection (ver onLeave) — se conserva posición,
    // carga, HP, etc. Solo se crea uno nuevo si es la primera entrada.
    if (this.state.players.has(client.sessionId)) return;

    const player = new Player();
    player.input = null;
    let restauradoDeGuardado = false;

    if (auth?.guest || !auth?.character) {
      // Modo sin persistencia: piloto de usar y tirar.
      player.name = options?.name || `Piloto-${client.sessionId.slice(0, 4)}`;
      player.x = (Math.random() - 0.5) * 400;
      player.y = (Math.random() - 0.5) * 400;
    } else {
      const { character } = auth;
      player.name = character.name;
      player.characterId = character.id;

      if (character.state) {
        // Vuelve donde lo dejó, con su carga y su casco.
        player.x = character.state.x;
        player.y = character.state.y;
        player.vx = character.state.vx;
        player.vy = character.state.vy;
        player.facing = character.state.facing;
        player.rotation = character.state.facing;
        player.structure = character.state.hp;
        player.shield = character.state.shield ?? 0;
        player.cargo = character.state.cargo;
        restauradoDeGuardado = true;
      } else {
        // Primera vez que vuela este personaje.
        player.x = (Math.random() - 0.5) * 400;
        player.y = (Math.random() - 0.5) * 400;
      }

      persistence.touchLastPlayed(character.id);
    }

    // Stats reales del crucero (Warden) desde el catálogo por clase —
    // ver server/data/shipStats.js. Cuando exista selección de nave, el
    // shipId dejará de estar fijo y esto se resolverá por jugador.
    //
    // BUG REAL corregido aquí (presente desde antes de este catálogo):
    // el esquema Player pone structure=100 por defecto en su constructor,
    // así que el guard "if (!player.structure)" NUNCA disparaba — 100 es
    // un valor verdadero. Un piloto invitado o un personaje recién creado
    // (sin estado guardado todavía) se quedaba con 100 HP fijos, no con
    // los del crucero. Solo se respeta lo guardado si de verdad se
    // restauró una partida anterior; en cualquier otro caso, catálogo.
    player.signature = PLAYER_SHIP_STATS.signature;
    if (!restauradoDeGuardado) {
      player.structure = PLAYER_SHIP_STATS.hp;
      player.shield = PLAYER_SHIP_STATS.shield;
    }
    player.alive = true;
    // Por defecto activado — el cliente lo corrige justo tras unirse si el
    // jugador lo tenía desactivado en una sesión anterior (ver setName).
    player.autoTargetBack = true;

    this.combatState.set(client.sessionId, this.nuevoCombatState());
    this.state.players.set(client.sessionId, player);
  }

  // Vuelca a la base de datos el estado de un jugador concreto.
  async savePlayer(player) {
    if (!player?.characterId) return;
    await persistence.saveCharacterState(player.characterId, {
      shipId: DEFAULT_PLAYER_SHIP_ID,
      x: player.x,
      y: player.y,
      vx: player.vx || 0,
      vy: player.vy || 0,
      facing: player.facing || 0,
      hp: player.structure,
      shield: player.shield,
      cargo: player.cargo,
    });
  }

  // Guardado periódico de todos los pilotos con personaje asociado.
  async saveAllPlayers() {
    const pending = [];
    this.state.players.forEach((player) => {
      if (player.characterId) pending.push(this.savePlayer(player));
    });
    if (pending.length) await Promise.allSettled(pending);
  }

  // Antes borraba al jugador de state al instante en cuanto caía el socket.
  // Eso hacía inútil el reconnect() del cliente: reconnect() de Colyseus
  // solo funciona si el servidor reservó el asiento con allowReconnection().
  // Al minimizar el navegador el socket se corta en segundos, así que todo
  // intento de reconexión fallaba siempre, no de forma intermitente.
  //
  // Ahora: se guarda el estado del jugador y se da una ventana de RECONNECT_GRACE_S
  // segundos para volver. Solo se borra si expira sin que reconecte.
  async onLeave(client, consented) {
    const player = this.state.players.get(client.sessionId);

    // Se olvida la acción contextual cacheada: si vuelve, que se recalcule
    // desde cero (puede haber minado el asteroide otro mientras no estaba).
    this.lastAction.delete(client.sessionId);
    this.combatState.delete(client.sessionId);
    // Los NPCs que le perseguían dejan de hacerlo.
    this.npcBrains.forEach((brain) => {
      if (brain.targetSessionId === client.sessionId) brain.targetSessionId = null;
    });

    // Salida explícita (el jugador cerró el juego) — no reservar asiento.
    // Se guarda ANTES de borrarlo del estado, o se perdería el progreso de
    // la sesión entera.
    if (consented) {
      await this.savePlayer(player);
      this.state.players.delete(client.sessionId);
      return;
    }

    try {
      await this.allowReconnection(client, RECONNECT_GRACE_S);
      // El cliente volvió dentro de la ventana — el jugador sigue en state,
      // no hay que hacer nada más.
    } catch {
      // Expiró la ventana sin reconexión: se guarda antes de descartarlo.
      // Este es el caso habitual cuando alguien cierra el móvil de golpe,
      // así que es justo donde más importa no perder el progreso.
      if (player) {
        await this.savePlayer(player);
        this.state.players.delete(client.sessionId);
      }
    }
  }

  // La sala se cierra (último jugador fuera, o reinicio del servidor).
  // Último guardado de todo lo que quede dentro.
  async onDispose() {
    await this.saveAllPlayers();
  }

  update(deltaMs) {
    const dt = deltaMs / 1000;

    this.state.players.forEach((player) => {
      // vx/vy son estado interno de simulación, no van al schema
      // sincronizado (igual que ya hacíamos con player.input) — el
      // cliente no necesita la velocidad, solo x/y/rotation.
      if (player.vx === undefined) {
        player.vx = 0;
        player.vy = 0;
      }

      // --- Enfriamiento del warp — cuenta siempre, cargando o no ---
      if (player.warpCooldownRemaining > 0) {
        player.warpCooldownRemaining = Math.max(0, player.warpCooldownRemaining - dt);
      }

      // --- Cuenta atrás de carga ---
      if (player.warpCharging) {
        player.warpChargeRemaining -= dt;
        if (player.warpChargeRemaining <= 0) {
          player.warpCharging = false;
          player.warpChargeRemaining = 0;

          const currentSpeed = Math.hypot(player.vx, player.vy);
          if (currentSpeed > 0.01) {
            // Activa el warp: impulso en la dirección actual de vuelo,
            // no hacia donde mires — necesitas ya estar en movimiento.
            const dirX = player.vx / currentSpeed;
            const dirY = player.vy / currentSpeed;
            const warpSpeed = PLAYER_SHIP_STATS.maxSpeed * WARP_SPEED_MULTIPLIER;
            player.vx = dirX * warpSpeed;
            player.vy = dirY * warpSpeed;
            player.rotation = Math.atan2(dirY, dirX);
            player.warping = true;
            player.invulnerable = true;
            player.cruising = false; // el warp manda, no tiene sentido combinarlo con crucero
          }
          // Si la velocidad era ~0, la carga termina sin efecto (no hay
          // dirección de vuelo en la que impulsarse) — se pierde el
          // intento pero el enfriamiento ya se aplicó igualmente.
        }
      }

      // --- Movimiento: en warp no hay control manual (ni giro ni
      // empuje ni fricción) — viaja en línea recta a velocidad fija
      // hasta que se cancela o topa con el borde del mundo. En crucero
      // (8.4.10.3) tampoco hay fricción NI input: la velocidad se
      // congela tal cual estaba al activarlo, así viaja sola. Fuera de
      // warp/crucero, física normal de giro+empuje+fricción de siempre,
      // ahora en 360° reales (el input trae un ángulo, no 4 booleans). ---
      const input = player.input;

      if (!player.warping && !player.cruising) {
        const hasDirection = input && input.angle !== null && input.magnitude > PIVOT_THRESHOLD;

        if (hasDirection) {
          // Gira siempre a velocidad angular completa hacia el rumbo
          // deseado — un toque suave del joystick apunta la nave igual
          // de rápido que uno a fondo, solo cambia si además empuja.
          const diff = angleDiff(player.rotation, input.angle);
          const maxStep = PLAYER_SHIP_STATS.turnRate * dt;
          player.rotation += Math.abs(diff) <= maxStep ? diff : Math.sign(diff) * maxStep;

          if (input.magnitude > THRUST_THRESHOLD) {
            // Empuje progresivo: 0 justo en el umbral, 100% con el
            // joystick a tope — no es todo o nada.
            const thrustFactor = (input.magnitude - THRUST_THRESHOLD) / (1 - THRUST_THRESHOLD);
            const accel = PLAYER_SHIP_STATS.acceleration * thrustFactor;
            player.vx += Math.cos(player.rotation) * accel * dt;
            player.vy += Math.sin(player.rotation) * accel * dt;

            const speed = Math.hypot(player.vx, player.vy);
            if (speed > PLAYER_SHIP_STATS.maxSpeed) {
              player.vx = (player.vx / speed) * PLAYER_SHIP_STATS.maxSpeed;
              player.vy = (player.vy / speed) * PLAYER_SHIP_STATS.maxSpeed;
            }
          }
        }

        const dragFactor = Math.max(0, 1 - DRAG * dt);
        player.vx *= dragFactor;
        player.vy *= dragFactor;
      }

      if (Math.abs(player.vx) > 0.01 || Math.abs(player.vy) > 0.01) {
        const half = WORLD_SIZE / 2;
        const nextX = player.x + player.vx * dt;
        const nextY = player.y + player.vy * dt;
        const clampedX = clamp(nextX, -half, half);
        const clampedY = clamp(nextY, -half, half);
        // Si topó con el borde del mundo, anula la velocidad en ese eje
        // en vez de dejar que siga acelerando contra la pared. Si iba en
        // warp, esto también lo termina (ver justo debajo).
        if (clampedX !== nextX) player.vx = 0;
        if (clampedY !== nextY) player.vy = 0;
        player.x = clampedX;
        player.y = clampedY;
      }

      // El warp termina solo si la velocidad se anuló por chocar con el
      // borde del mundo — el resto del tiempo sigue hasta cancelarse a
      // mano (mensaje warpToggle) o hasta el próximo tope de borde.
      if (player.warping && Math.abs(player.vx) < 0.01 && Math.abs(player.vy) < 0.01) {
        player.warping = false;
        player.invulnerable = false;
      }

      if (input?.mining && !player.warping) {
        this.tryMine(player);
      }
    });

    this.updateNpcs(deltaMs);
    this.updateCombat(deltaMs);

    // Recalcular qué puede hacer cada jugador, a 4 Hz y no a 20: es
    // información de interfaz, nadie nota 250 ms de retraso en que se
    // ilumine un botón, y ahorra el 80% del coste.
    this.actionScanAccum += deltaMs;
    if (this.actionScanAccum >= ACTION_SCAN_INTERVAL) {
      this.actionScanAccum = 0;
      this.updateContextActions();
    }

    // Guardado periódico. No se espera al resultado: si la base tarda o
    // falla, la simulación no puede quedarse parada esperándola.
    this.saveAccum += deltaMs;
    if (this.saveAccum >= SAVE_INTERVAL_MS) {
      this.saveAccum = 0;
      this.saveAllPlayers();
    }
  }

  // Busca el objeto accionable más cercano al jugador y, si el resultado
  // cambió desde la última vez, se lo notifica solo a él.
  //
  // Rendimiento: hoy recorre los 120 asteroides por jugador, 4 veces por
  // segundo. Con pocos jugadores es irrelevante. Cuando un chunk tenga
  // cientos de objetos y decenas de pilotos habrá que meter una rejilla
  // espacial (dividir el chunk en casillas y mirar solo las 9 casillas
  // vecinas), pero esa optimización no tiene sentido hacerla todavía:
  // añade complejidad para resolver un problema que aún no existe.
  updateContextActions() {
    this.clients.forEach((client) => {
      const player = this.state.players.get(client.sessionId);
      if (!player) return;

      const action = player.warping ? null : this.findContextAction(player);

      // Firma corta para comparar sin comparar objetos enteros.
      const signature = action ? `${action.kind}:${action.id}` : "";
      if (this.lastAction.get(client.sessionId) === signature) return;

      this.lastAction.set(client.sessionId, signature);
      client.send("action", action);
    });
  }

  findContextAction(player) {
    let best = null;

    // Minado — solo si la nave puede minar. Una nave de combate junto a un
    // asteroide simplemente no verá el botón.
    if (hasMiningModule(player)) {
      for (const [id, asteroid] of this.state.asteroids.entries()) {
        if (asteroid.amount <= 0) continue;
        const dist = Math.hypot(asteroid.x - player.x, asteroid.y - player.y);
        if (dist > MINING_RANGE) continue;
        if (!best || dist < best.dist) {
          best = { kind: "mine", id, x: asteroid.x, y: asteroid.y, dist, hold: true };
        }
      }
    }

    // Aquí entrarán, con la misma forma, las demás acciones cuando existan
    // los objetos correspondientes en el chunk. Se dejan escritas las
    // constantes de rango (DOCK_RANGE, GATE_RANGE, LOOT_RANGE) para que
    // añadirlas sea rellenar el bucle, no rediseñar nada:
    //   "dock"  -> estación atracable       (§3 del documento de diseño)
    //   "gate"  -> punto de salto activable (§5.5)
    //   "loot"  -> pecio / contenedor abrible
    // El criterio de desempate es y seguirá siendo la distancia: gana lo
    // que tengas más cerca, sin menús ni submenús.

    if (!best) return null;
    return { kind: best.kind, id: best.id, x: best.x, y: best.y, hold: best.hold };
  }

  tryMine(player) {
    // Segunda comprobación deliberada: el cliente solo enseña el botón si
    // el servidor le dijo que podía, pero un cliente manipulado puede
    // mandar `mining: true` sin más. La autoridad está aquí.
    if (!hasMiningModule(player)) return;

    for (const [id, asteroid] of this.state.asteroids.entries()) {
      const dist = Math.hypot(asteroid.x - player.x, asteroid.y - player.y);
      if (dist <= MINING_RANGE && asteroid.amount > 0) {
        const rate = MINING_RATE_BASE * miningMultiplier(player);
        const extracted = Math.min(rate, asteroid.amount);
        asteroid.amount -= extracted;
        player.cargo += extracted;
        if (asteroid.amount <= 0) {
          this.state.asteroids.delete(id);
        }
        break; // solo mina el asteroide más cercano encontrado, prototipo simple
      }
    }
  }
}

module.exports = { ChunkRoom };
