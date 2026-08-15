import Phaser from "phaser";
import { Client } from "colyseus.js";

// Súbela en cada release — se muestra en pantalla y sirve de referencia
// rápida para saber si el cliente cargado es el último.
const GAME_VERSION = "v0.0.2";

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
    this.createTopBarUI();
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

    // Input táctil, en paralelo al teclado — se combinan en cada tick.
    this.touchInput = { up: false, down: false, left: false, right: false, mining: false };

    if (this.sys.game.device.input.touch) {
      this.setupMiningButton();
      this.setupVirtualJoystick();
    }

    this.time.addEvent({
      delay: 50, // ~20 Hz, igual que el tick del servidor
      loop: true,
      callback: () => {
        const next = {
          up: keys.W.isDown || this.touchInput.up,
          down: keys.S.isDown || this.touchInput.down,
          left: keys.A.isDown || this.touchInput.left,
          right: keys.D.isDown || this.touchInput.right,
          mining: keys.SPACE.isDown || this.touchInput.mining,
        };
        if (this.room) this.room.send("input", next);
      },
    });
  }

  // Botón fijo abajo a la derecha — se reserva su zona para que el joystick
  // no se active ahí encima cuando el jugador quiere minar.
  setupMiningButton() {
    const margin = 70;
    const radius = 45;
    const x = this.scale.width - margin;
    const y = this.scale.height - margin;

    const circle = this.add
      .circle(x, y, radius, 0xff6644, 0.3)
      .setScrollFactor(0)
      .setDepth(100)
      .setStrokeStyle(2, 0xff6644, 0.8)
      .setInteractive({ useHandCursor: true });

    this.add
      .text(x, y, "MINAR", { fontSize: "12px", color: "#ffffff" })
      .setOrigin(0.5)
      .setScrollFactor(0)
      .setDepth(101);

    this.miningButtonBounds = { x, y, radius: radius + 15 };

    circle.on("pointerdown", () => (this.touchInput.mining = true));
    circle.on("pointerup", () => (this.touchInput.mining = false));
    circle.on("pointerout", () => (this.touchInput.mining = false));
  }

  // Joystick virtual: aparece exactamente donde el jugador pone el dedo,
  // no en una posición fija de la pantalla.
  setupVirtualJoystick() {
    const maxRadius = 60;
    const deadzone = maxRadius * 0.2;
    let base = null;
    let thumb = null;
    let activePointerId = null;

    const insideMiningButton = (x, y) => {
      if (!this.miningButtonBounds) return false;
      const { x: bx, y: by, radius } = this.miningButtonBounds;
      return Phaser.Math.Distance.Between(x, y, bx, by) <= radius;
    };

    const resetDirections = () => {
      this.touchInput.up = false;
      this.touchInput.down = false;
      this.touchInput.left = false;
      this.touchInput.right = false;
    };

    const destroyJoystick = () => {
      base?.destroy();
      thumb?.destroy();
      base = null;
      thumb = null;
      activePointerId = null;
      resetDirections();
    };

    this.input.on("pointerdown", (pointer) => {
      if (activePointerId !== null) return; // ya hay un dedo moviendo la nave
      if (insideMiningButton(pointer.x, pointer.y)) return; // eso es del botón

      activePointerId = pointer.id;
      base = this.add
        .circle(pointer.x, pointer.y, maxRadius, 0x66ccff, 0.15)
        .setScrollFactor(0)
        .setDepth(90)
        .setStrokeStyle(2, 0x66ccff, 0.5);
      thumb = this.add
        .circle(pointer.x, pointer.y, 26, 0x66ccff, 0.35)
        .setScrollFactor(0)
        .setDepth(91);
    });

    this.input.on("pointermove", (pointer) => {
      if (activePointerId !== pointer.id || !base) return;

      const dx = pointer.x - base.x;
      const dy = pointer.y - base.y;
      const dist = Math.min(Math.hypot(dx, dy), maxRadius);
      const angle = Math.atan2(dy, dx);

      thumb.x = base.x + Math.cos(angle) * dist;
      thumb.y = base.y + Math.sin(angle) * dist;

      if (dist < deadzone) {
        resetDirections();
        return;
      }

      this.touchInput.right = Math.cos(angle) > 0.3;
      this.touchInput.left = Math.cos(angle) < -0.3;
      this.touchInput.down = Math.sin(angle) > 0.3;
      this.touchInput.up = Math.sin(angle) < -0.3;
    });

    this.input.on("pointerup", (pointer) => {
      if (activePointerId !== pointer.id) return;
      destroyJoystick();
    });
  }

  // Etiqueta de versión (arriba a la derecha) + botón de menú (arriba a la
  // izquierda). Ambos fijos en pantalla, no se mueven con la cámara.
  createTopBarUI() {
    this.add
      .text(this.scale.width - 10, 10, GAME_VERSION, {
        fontSize: "12px",
        color: "#7d93b0",
      })
      .setOrigin(1, 0)
      .setScrollFactor(0)
      .setDepth(200);

    const menuBtn = this.add
      .text(10, 10, "☰", {
        fontSize: "20px",
        color: "#cfe8ff",
        backgroundColor: "#141a24",
        padding: { x: 8, y: 4 },
      })
      .setScrollFactor(0)
      .setDepth(200)
      .setInteractive({ useHandCursor: true });

    menuBtn.on("pointerdown", () => this.toggleOptionsMenu());
  }

  toggleOptionsMenu() {
    if (this.optionsMenu) {
      this.optionsMenu.destroy();
      this.optionsMenu = null;
      return;
    }

    const w = 220;
    const h = 130;
    const x = this.scale.width / 2 - w / 2;
    const y = this.scale.height / 2 - h / 2;

    const bg = this.add.rectangle(0, 0, w, h, 0x0a0e16, 0.95).setOrigin(0).setStrokeStyle(1, 0x334455);
    const title = this.add.text(w / 2, 16, "Opciones", { fontSize: "14px", color: "#cfe8ff" }).setOrigin(0.5, 0);
    const version = this.add
      .text(w / 2, 38, GAME_VERSION, { fontSize: "11px", color: "#7d93b0" })
      .setOrigin(0.5, 0);

    const closeBtn = this.add
      .text(w / 2, h / 2 + 20, "Cerrar juego", {
        fontSize: "14px",
        color: "#ffffff",
        backgroundColor: "#883333",
        padding: { x: 12, y: 8 },
      })
      .setOrigin(0.5)
      .setInteractive({ useHandCursor: true });
    closeBtn.on("pointerdown", () => this.closeGame());

    const dismissBtn = this.add
      .text(w - 10, 8, "✕", { fontSize: "14px", color: "#889" })
      .setOrigin(1, 0)
      .setInteractive({ useHandCursor: true });
    dismissBtn.on("pointerdown", () => this.toggleOptionsMenu());

    this.optionsMenu = this.add
      .container(x, y, [bg, title, version, closeBtn, dismissBtn])
      .setScrollFactor(0)
      .setDepth(300);
  }

  // Desconecta de la room y detiene toda actividad del cliente. No cierra
  // la pestaña del navegador (los navegadores lo bloquean por seguridad
  // salvo que la ventana la haya abierto el propio script) — en su lugar
  // deja claro que el juego ha terminado y hay que recargar para volver.
  closeGame() {
    this.room?.leave();
    this.tweens.killAll();
    this.time.removeAllEvents();
    this.scene.pause();

    this.add
      .rectangle(0, 0, this.scale.width, this.scale.height, 0x000000, 0.92)
      .setOrigin(0)
      .setScrollFactor(0)
      .setDepth(500);
    this.add
      .text(this.scale.width / 2, this.scale.height / 2, "Juego cerrado.\nRecarga la página para volver a jugar.", {
        fontSize: "16px",
        color: "#cfe8ff",
        align: "center",
      })
      .setOrigin(0.5)
      .setScrollFactor(0)
      .setDepth(501);
  }
}

new Phaser.Game({
  type: Phaser.AUTO,
  parent: document.body,
  width: window.innerWidth,
  height: window.innerHeight,
  backgroundColor: "#05050a",
  scene: [ChunkScene],
  input: {
    activePointers: 2, // un dedo para el joystick, otro para minar
  },
});
