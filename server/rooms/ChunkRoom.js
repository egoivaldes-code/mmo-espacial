const { Room } = require("colyseus");
const { ChunkState } = require("../schema/ChunkState");
const { Player } = require("../schema/Player");
const { Asteroid } = require("../schema/Asteroid");

// Ajustes simples del prototipo. Nada de esto es definitivo, es fase 0.
const WORLD_SIZE = 4000; // el "chunk" es grande en espacio, poco denso
const SHIP_SPEED = 220; // unidades/seg
const MINING_RANGE = 80;
const MINING_RATE = 5; // recurso extraído por tick de minado
const TICK_RATE = 20; // Hz

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
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
      const input = player.input;
      if (!input) return;

      let dx = 0;
      let dy = 0;
      if (input.up) dy -= 1;
      if (input.down) dy += 1;
      if (input.left) dx -= 1;
      if (input.right) dx += 1;

      if (dx !== 0 || dy !== 0) {
        const len = Math.hypot(dx, dy);
        player.x += (dx / len) * SHIP_SPEED * dt;
        player.y += (dy / len) * SHIP_SPEED * dt;
        player.rotation = Math.atan2(dy, dx);

        // Límite del mundo — el servidor es la autoridad, no basta con
        // dibujar el borde en el cliente. El cliente solo lo pinta.
        const half = WORLD_SIZE / 2;
        player.x = clamp(player.x, -half, half);
        player.y = clamp(player.y, -half, half);
      }

      if (input.mining) {
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
