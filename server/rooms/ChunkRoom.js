const { Room } = require("colyseus");
const { ChunkState } = require("../schema/ChunkState");
const { Player } = require("../schema/Player");
const { Asteroid } = require("../schema/Asteroid");

// Ajustes simples del prototipo. Nada de esto es definitivo, es fase 0.
const WORLD_SIZE = 4000; // el "chunk" es grande en espacio, poco denso
const MINING_RANGE = 80;
const MINING_RATE = 5; // recurso extraído por tick de minado
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

    this.spawnAsteroids(15);

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

  onJoin(client, options) {
    // Si ya hay un Player para este sessionId es una reconexión dentro de
    // la ventana de allowReconnection (ver onLeave) — se conserva posición,
    // carga, HP, etc. Solo se crea uno nuevo si es la primera entrada.
    if (this.state.players.has(client.sessionId)) return;

    const player = new Player();
    player.name = options?.name || `Piloto-${client.sessionId.slice(0, 4)}`;
    player.x = (Math.random() - 0.5) * 400;
    player.y = (Math.random() - 0.5) * 400;
    player.input = null;
    this.state.players.set(client.sessionId, player);
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

    // Salida explícita (el jugador cerró el juego) — no reservar asiento.
    if (consented) {
      this.state.players.delete(client.sessionId);
      return;
    }

    try {
      await this.allowReconnection(client, RECONNECT_GRACE_S);
      // El cliente volvió dentro de la ventana — el jugador sigue en state,
      // no hay que hacer nada más.
    } catch {
      // Expiró la ventana sin reconexión.
      if (player) this.state.players.delete(client.sessionId);
    }
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
  }

  tryMine(player) {
    for (const [id, asteroid] of this.state.asteroids.entries()) {
      const dist = Math.hypot(asteroid.x - player.x, asteroid.y - player.y);
      if (dist <= MINING_RANGE && asteroid.amount > 0) {
        const extracted = Math.min(MINING_RATE, asteroid.amount);
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
