import Phaser from "phaser";
import { Client } from "colyseus.js";

// En local usa ws://localhost:2567 (ver client/.env.example).
// En producción, define VITE_SERVER_URL en las variables de entorno de tu
// build (p. ej. GitHub Pages via Actions) apuntando a wss://tu-servicio.onrender.com
const SERVER_URL = import.meta.env.VITE_SERVER_URL || "ws://localhost:2567";

const ui = document.getElementById("ui");

class ChunkScene extends Phaser.Scene {
  constructor() {
    super("chunk");
    this.shipSprites = new Map(); // sessionId -> Phaser.GameObjects
    this.asteroidSprites = new Map(); // id -> Phaser.GameObjects
    this.input$ = { up: false, down: false, left: false, right: false, mining: false };
  }

  async create() {
    this.cameras.main.setBackgroundColor("#05050a");
    this.starfield();

    const client = new Client(SERVER_URL);
    ui.textContent = "Conectando al servidor…";

    try {
      this.room = await client.joinOrCreate("chunk", { name: "Piloto" });
      ui.textContent = `Conectado. Sesión: ${this.room.sessionId}`;
    } catch (err) {
      ui.textContent = `Error de conexión: ${err.message}`;
      return;
    }

    this.room.state.players.onAdd((player, sessionId) => {
      const isMe = sessionId === this.room.sessionId;
      const sprite = this.add.triangle(0, 0, 0, -14, -10, 12, 10, 12, isMe ? 0x66ccff : 0xff8866);
      sprite.setStrokeStyle(1, 0xffffff);
      const label = this.add.text(0, 18, player.name, { fontSize: "10px", color: "#cfe8ff" }).setOrigin(0.5, 0);
      const container = this.add.container(player.x, player.y, [sprite, label]);
      this.shipSprites.set(sessionId, container);

      player.onChange = () => {
        container.x = player.x;
        container.y = player.y;
        sprite.rotation = player.rotation + Math.PI / 2;
        if (isMe) {
          ui.textContent = `Carga: ${Math.floor(player.cargo)}  |  HP: ${Math.floor(player.hp)}`;
        }
      };

      if (isMe) {
        this.cameras.main.startFollow(container, true, 0.15, 0.15);
      }
    });

    this.room.state.players.onRemove((_, sessionId) => {
      const container = this.shipSprites.get(sessionId);
      if (container) container.destroy();
      this.shipSprites.delete(sessionId);
    });

    this.room.state.asteroids.onAdd((asteroid, id) => {
      const circle = this.add.circle(asteroid.x, asteroid.y, 22, 0x8a8a8a);
      circle.setStrokeStyle(1, 0xcccccc);
      this.asteroidSprites.set(id, circle);
    });

    this.room.state.asteroids.onRemove((_, id) => {
      const circle = this.asteroidSprites.get(id);
      if (circle) circle.destroy();
      this.asteroidSprites.delete(id);
    });

    this.setupInput();
  }

  starfield() {
    for (let i = 0; i < 200; i++) {
      const x = Phaser.Math.Between(-2500, 2500);
      const y = Phaser.Math.Between(-2500, 2500);
      const star = this.add.circle(x, y, Phaser.Math.Between(1, 2), 0xffffff, Phaser.Math.FloatBetween(0.3, 0.9));
      star.setScrollFactor(0.6); // ligero parallax
    }
  }

  setupInput() {
    const keys = this.input.keyboard.addKeys("W,A,S,D,SPACE");

    this.time.addEvent({
      delay: 50, // ~20 Hz, igual que el tick del servidor
      loop: true,
      callback: () => {
        const next = {
          up: keys.W.isDown,
          down: keys.S.isDown,
          left: keys.A.isDown,
          right: keys.D.isDown,
          mining: keys.SPACE.isDown,
        };
        this.input$ = next;
        if (this.room) this.room.send("input", next);
      },
    });
  }
}

new Phaser.Game({
  type: Phaser.AUTO,
  parent: document.body,
  width: window.innerWidth,
  height: window.innerHeight,
  backgroundColor: "#05050a",
  scene: [ChunkScene],
});
