const { Room } = require("colyseus");
const { ChunkState } = require("../schema/ChunkState");
const persistence = require("../persistence");
const { Player } = require("../schema/Player");
const { Asteroid } = require("../schema/Asteroid");

// Ajustes simples del prototipo. Nada de esto es definitivo, es fase 0.
const WORLD_SIZE = 30000; // el "chunk" es grande en espacio, poco denso — tamaño de diseño (5.5)
const MINING_RANGE = 80;
const MINING_RATE_BASE = 5; // recurso por tick con multiplicador ×1 (ver 8.2.1)
const TICK_RATE = 20; // Hz
const RECONNECT_GRACE_S = 90; // ventana para volver tras un corte de socket

// Física de vuelo — modelo tipo Asteroids/Newtoniano, no "velocidad
// instantánea en la dirección del input". El input marca hacia dónde
// QUIERE girar la nave (rumbo deseado); el morro gira hacia ahí a una
// velocidad angular limitada (TURN_RATE); el empuje (ACCELERATION) se
// aplica en la dirección hacia la que la nave está físicamente orientada
// en ESE instante, no hacia el rumbo deseado. Girar rápido a alta
// velocidad no es instantáneo — de ahí la deriva/elipses en vez de
// círculos perfectos al intentar orbitar algo.
//
// Estos valores son los de la única nave que hay en el juego ahora mismo
// (FHI Wren, lanzadera — nave nimble por diseño). Cuando exista selección
// real de nave, cada clase debería tener los suyos (más grande/pesada =
// TURN_RATE y ACCELERATION más bajos) — ver ships.json en
// client/public/ships/ como fuente de esos stats por clase a futuro.
const TURN_RATE = Math.PI; // rad/s — 180°/seg
const ACCELERATION = 300; // unidades/s²
const MAX_SPEED = 240; // unidades/s
const DRAG = 0.6; // fracción de velocidad perdida por segundo (fricción suave)

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

    // Con WORLD_SIZE=30.000 (56x más área que el valor de prototipo
    // anterior), 15 asteroides quedarían invisibles la mayor parte del
    // tiempo. 120 sigue siendo un valor de prototipo, no densidad final
    // calibrada — solo para que el mundo no se sienta vacío al explorar.
    this.spawnAsteroids(120);

    // Input del cliente: { up, down, left, right, mining }
    this.onMessage("input", (client, input) => {
      const player = this.state.players.get(client.sessionId);
      if (!player) return;
      player.input = input; // se guarda para procesarlo en el loop de simulación
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

    // Un único mensaje conmuta los tres estados del warp: si está
    // inactivo (y sin enfriamiento) arranca la carga; si está cargando o
    // ya viajando, lo cancela y para la nave en seco donde esté. Toda la
    // decisión vive en el servidor — el cliente solo pulsa el botón.
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
    this.saveAccum = 0;

    this.setSimulationInterval((deltaMs) => this.update(deltaMs), 1000 / TICK_RATE);
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
        player.hp = character.state.hp;
        player.cargo = character.state.cargo;
      } else {
        // Primera vez que vuela este personaje.
        player.x = (Math.random() - 0.5) * 400;
        player.y = (Math.random() - 0.5) * 400;
      }

      persistence.touchLastPlayed(character.id);
    }

    this.state.players.set(client.sessionId, player);
  }

  // Vuelca a la base de datos el estado de un jugador concreto.
  async savePlayer(player) {
    if (!player?.characterId) return;
    await persistence.saveCharacterState(player.characterId, {
      shipId: "shuttle_01",
      x: player.x,
      y: player.y,
      vx: player.vx || 0,
      vy: player.vy || 0,
      facing: player.facing || 0,
      hp: player.hp,
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
            const warpSpeed = MAX_SPEED * WARP_SPEED_MULTIPLIER;
            player.vx = dirX * warpSpeed;
            player.vy = dirY * warpSpeed;
            player.rotation = Math.atan2(dirY, dirX);
            player.warping = true;
            player.invulnerable = true;
          }
          // Si la velocidad era ~0, la carga termina sin efecto (no hay
          // dirección de vuelo en la que impulsarse) — se pierde el
          // intento pero el enfriamiento ya se aplicó igualmente.
        }
      }

      // --- Movimiento: en warp no hay control manual (ni giro ni
      // empuje ni fricción) — viaja en línea recta a velocidad fija
      // hasta que se cancela o topa con el borde del mundo. Fuera de
      // warp, la física normal de giro+empuje+fricción de siempre. ---
      const input = player.input;

      if (!player.warping) {
        let dx = 0;
        let dy = 0;
        if (input) {
          if (input.up) dy -= 1;
          if (input.down) dy += 1;
          if (input.left) dx -= 1;
          if (input.right) dx += 1;
        }
        const hasInput = dx !== 0 || dy !== 0;

        if (hasInput) {
          const desiredAngle = Math.atan2(dy, dx);
          const diff = angleDiff(player.rotation, desiredAngle);
          const maxStep = TURN_RATE * dt;
          player.rotation += Math.abs(diff) <= maxStep ? diff : Math.sign(diff) * maxStep;

          player.vx += Math.cos(player.rotation) * ACCELERATION * dt;
          player.vy += Math.sin(player.rotation) * ACCELERATION * dt;

          const speed = Math.hypot(player.vx, player.vy);
          if (speed > MAX_SPEED) {
            player.vx = (player.vx / speed) * MAX_SPEED;
            player.vy = (player.vy / speed) * MAX_SPEED;
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
