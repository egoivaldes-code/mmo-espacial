const { Room } = require("colyseus");
const { ChunkState } = require("../schema/ChunkState");
const { Player } = require("../schema/Player");
const { Asteroid } = require("../schema/Asteroid");

// Ajustes simples del prototipo. Nada de esto es definitivo, es fase 0.
const WORLD_SIZE = 4000; // el "chunk" es grande en espacio, poco denso
const MINING_RANGE = 80;
const MINING_RATE = 5; // recurso extraído por tick de minado
const TICK_RATE = 20; // Hz

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
    const player = new Player();
    player.name = options?.name || `Piloto-${client.sessionId.slice(0, 4)}`;
    player.x = (Math.random() - 0.5) * 400;
    player.y = (Math.random() - 0.5) * 400;
    player.input = null;
    this.state.players.set(client.sessionId, player);
  }

  onLeave(client) {
    this.state.players.delete(client.sessionId);
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

      const input = player.input;
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
        // Gira el morro hacia el rumbo deseado, limitado por TURN_RATE —
        // no salta directamente a esa dirección.
        const desiredAngle = Math.atan2(dy, dx);
        const diff = angleDiff(player.rotation, desiredAngle);
        const maxStep = TURN_RATE * dt;
        player.rotation += Math.abs(diff) <= maxStep ? diff : Math.sign(diff) * maxStep;

        // El empuje va en la dirección hacia la que la nave está
        // orientada AHORA, no hacia el rumbo deseado — por eso hay deriva
        // al girar rápido sin haber terminado de orientarse.
        player.vx += Math.cos(player.rotation) * ACCELERATION * dt;
        player.vy += Math.sin(player.rotation) * ACCELERATION * dt;

        const speed = Math.hypot(player.vx, player.vy);
        if (speed > MAX_SPEED) {
          player.vx = (player.vx / speed) * MAX_SPEED;
          player.vy = (player.vy / speed) * MAX_SPEED;
        }
      }

      // Fricción suave, siempre activa (con o sin input) — sin esto la
      // nave derivaría para siempre; con ella conserva inercia real pero
      // acaba frenándose sola en un par de segundos sin empuje.
      const dragFactor = Math.max(0, 1 - DRAG * dt);
      player.vx *= dragFactor;
      player.vy *= dragFactor;

      if (Math.abs(player.vx) > 0.01 || Math.abs(player.vy) > 0.01) {
        const half = WORLD_SIZE / 2;
        const nextX = player.x + player.vx * dt;
        const nextY = player.y + player.vy * dt;
        const clampedX = clamp(nextX, -half, half);
        const clampedY = clamp(nextY, -half, half);
        // Si topó con el borde del mundo, anula la velocidad en ese eje
        // en vez de dejar que siga acelerando contra la pared.
        if (clampedX !== nextX) player.vx = 0;
        if (clampedY !== nextY) player.vy = 0;
        player.x = clampedX;
        player.y = clampedY;
      }

      if (input?.mining) {
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
