import Phaser from "phaser";
import { Client } from "colyseus.js";

// Súbela en cada release — se muestra en pantalla y sirve de referencia
// rápida para saber si el cliente cargado es el último.
const GAME_VERSION = "v0.0.4";

// En local usa ws://localhost:2567 (ver client/.env.example).
// En producción, define VITE_SERVER_URL en las variables de entorno de tu
// build (p. ej. GitHub Pages via Actions) apuntando a wss://tu-servicio.onrender.com
const SERVER_URL = import.meta.env.VITE_SERVER_URL || "ws://localhost:2567";

// Debe coincidir con las constantes homónimas del servidor
// (server/rooms/ChunkRoom.js). Candidatas a mover a un archivo de config
// compartido más adelante.
const SHIP_SPEED = 220;
const WORLD_SIZE = 4000;

// Cuánto "en el pasado" se dibujan los jugadores remotos, para poder
// interpolar entre dos posiciones reales del servidor en vez de saltar de
// una a otra. Más alto = más suave pero más lag visual de los demás.
const INTERP_DELAY_MS = 100;

const MAX_CHARACTERS = 5;
const CHARACTERS_STORAGE_KEY = "spacemmo_characters";

// Nave que usa todo el mundo por ahora (todavía no hay selección/crafteo
// de nave — ver roadmap). Debe coincidir con ACTIVE_SHIP_ID en
// client/public/naveteca/index.html. El sprite y el sonido salen de
// client/public/ships/ — es la MISMA carpeta que usa la naveteca, así que
// cambiar esos archivos ahí cambia lo que se ve/oye en el juego también.
const STARTING_SHIP_ID = "shuttle_01";

const ui = document.getElementById("ui");

// ============================================================================
// Conexión en segundo plano — arranca nada más cargar la página, antes de
// que el jugador termine de leer el changelog o elegir personaje. Así se
// aprovecha ese tiempo para que el servidor de Render despierte si estaba
// dormido (el plan gratuito duerme tras inactividad).
// ============================================================================

let roomPromise = null;
let CHOSEN_NAME = "Piloto";

const statusListeners = new Set();
let currentStatusText = "Comprobando estado del servidor…";

function setStatus(text) {
  currentStatusText = text;
  statusListeners.forEach((fn) => fn(text));
}

function onStatusChange(fn) {
  statusListeners.add(fn);
  fn(currentStatusText); // notifica el estado actual al suscribirse
}

function httpUrlFromWsUrl(wsUrl) {
  return wsUrl.replace(/^wss:/, "https:").replace(/^ws:/, "http:");
}

// "Despierta" el servidor con una petición ligera antes de intentar la
// conexión real por websocket. Si el servidor está dormido (Render free
// tier), esta petición se queda esperando hasta que arranca — es
// justamente lo que da tiempo para leer el changelog.
async function warmupServer() {
  const httpUrl = httpUrlFromWsUrl(SERVER_URL);
  const hintTimer = setTimeout(() => {
    setStatus("Despertando el servidor (plan gratuito) — puede tardar hasta 30s…");
  }, 3000);

  const maxAttempts = 6;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      await fetch(httpUrl, { mode: "no-cors" });
      clearTimeout(hintTimer);
      return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }
  }
  clearTimeout(hintTimer);
  // Si tras varios intentos sigue sin responder, seguimos igualmente —
  // el intento real de conexión colyseus dará su propio error si procede.
}

function joinRoom() {
  const client = new Client(SERVER_URL);
  return client.joinOrCreate("chunk", { name: CHOSEN_NAME });
}

async function startBackgroundConnection() {
  setStatus("Comprobando estado del servidor…");
  await warmupServer();
  setStatus("Servidor listo. Conectando…");

  roomPromise = joinRoom();
  try {
    await roomPromise;
    setStatus("Conectado. Listo para jugar.");
  } catch (err) {
    setStatus(`Error de conexión: ${err.message}`);
  }
}

startBackgroundConnection();

// ============================================================================
// Pantalla 1: changelog scrolleable + barra de estado fija
// ============================================================================

function escapeHtml(str) {
  return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function formatInline(text) {
  return escapeHtml(text).replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
}

// Conversor mínimo de Markdown a HTML — cubre justo lo que usa
// CHANGELOG.md (encabezados, listas, párrafos, negrita). No es un parser
// completo a propósito, para no añadir una dependencia solo para esto.
function simpleMarkdownToHtml(md) {
  const lines = md.split("\n");
  let html = "";
  let inList = false;

  const closeList = () => {
    if (inList) {
      html += "</ul>";
      inList = false;
    }
  };

  for (const raw of lines) {
    const line = raw.trimEnd();
    if (line.startsWith("### ")) {
      closeList();
      html += `<h3>${formatInline(line.slice(4))}</h3>`;
    } else if (line.startsWith("## ")) {
      closeList();
      html += `<h2>${formatInline(line.slice(3))}</h2>`;
    } else if (line.startsWith("# ")) {
      closeList();
      html += `<h1>${formatInline(line.slice(2))}</h1>`;
    } else if (line.startsWith("- ")) {
      if (!inList) {
        html += "<ul>";
        inList = true;
      }
      html += `<li>${formatInline(line.slice(2))}</li>`;
    } else if (line.trim() === "") {
      closeList();
    } else {
      closeList();
      html += `<p>${formatInline(line)}</p>`;
    }
  }
  closeList();
  return html;
}

const introScroll = document.getElementById("intro-scroll");
const loadStatusEl = document.getElementById("load-status");
const introContinueBtn = document.getElementById("intro-continue-btn");
const introScreen = document.getElementById("intro-screen");
const characterScreen = document.getElementById("character-screen");

onStatusChange((text) => {
  loadStatusEl.textContent = text;
});

async function loadChangelog() {
  try {
    const res = await fetch(`${import.meta.env.BASE_URL}CHANGELOG.md`);
    const md = await res.text();
    introScroll.innerHTML = simpleMarkdownToHtml(md);
  } catch {
    introScroll.innerHTML = "<p>No se pudo cargar el changelog.</p>";
  }
}
loadChangelog();

introContinueBtn.addEventListener("click", () => {
  introScreen.style.display = "none";
  showCharacterScreen();
});

// ============================================================================
// Pantalla 2: selección/creación de personaje (máx. 5, guardado local)
//
// Nota: esto es persistencia LOCAL en el navegador (localStorage), no una
// cuenta de verdad — es un sustituto provisional hasta que el documento de
// diseño incorpore autenticación real vía Supabase (ver sección 7 del
// documento de diseño).
// ============================================================================

function loadCharacters() {
  try {
    const raw = localStorage.getItem(CHARACTERS_STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function saveCharacters(characters) {
  localStorage.setItem(CHARACTERS_STORAGE_KEY, JSON.stringify(characters));
}

const charListEl = document.getElementById("char-list");
const charCreateEl = document.getElementById("char-create");
const charNameInput = document.getElementById("char-name-input");
const charCreateBtn = document.getElementById("char-create-btn");
const charCreateToggleBtn = document.getElementById("char-create-toggle-btn");
const charLimitMsg = document.getElementById("char-limit-msg");
const charStatusEl = document.getElementById("char-status");

onStatusChange((text) => {
  charStatusEl.textContent = text;
});

function showCharacterScreen() {
  characterScreen.style.display = "flex";
  renderCharacterScreen();
}

function renderCharacterScreen() {
  const characters = loadCharacters();
  charListEl.innerHTML = "";

  characters.forEach((char) => {
    const btn = document.createElement("button");
    btn.className = "char-item";
    btn.innerHTML = `${escapeHtml(char.name)}<div class="char-meta">Creado ${new Date(char.createdAt).toLocaleDateString()}</div>`;
    btn.addEventListener("click", () => selectCharacter(char));
    charListEl.appendChild(btn);
  });

  const atLimit = characters.length >= MAX_CHARACTERS;
  charLimitMsg.style.display = atLimit ? "block" : "none";

  // Si no hay ningún personaje todavía, no tiene sentido pedir que
  // pulsen "crear nuevo" — se muestra el formulario directamente.
  const showCreateFormDirectly = characters.length === 0 && !atLimit;
  charCreateEl.style.display = showCreateFormDirectly ? "block" : "none";
  charCreateToggleBtn.style.display = atLimit || showCreateFormDirectly ? "none" : "block";
}

charCreateToggleBtn.addEventListener("click", () => {
  charCreateEl.style.display = "block";
  charCreateToggleBtn.style.display = "none";
  charNameInput.focus();
});

function createCharacter() {
  const characters = loadCharacters();
  if (characters.length >= MAX_CHARACTERS) return;

  const typed = charNameInput.value.trim();
  const name = typed ? typed.slice(0, 16) : `Piloto-${characters.length + 1}`;

  const character = {
    id: `char_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
    name,
    createdAt: Date.now(),
  };
  characters.push(character);
  saveCharacters(characters);

  selectCharacter(character);
}

charCreateBtn.addEventListener("click", createCharacter);
charNameInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") createCharacter();
});

function selectCharacter(character) {
  CHOSEN_NAME = character.name;
  characterScreen.style.display = "none";

  // El join en segundo plano pudo haber arrancado con el nombre por
  // defecto ("Piloto") mientras el jugador aún elegía — se corrige en
  // cuanto la room esté lista, dentro de la escena de Phaser.
  launchGame();
}

// ============================================================================
// Juego (Phaser + Colyseus)
// ============================================================================

class ChunkScene extends Phaser.Scene {
  constructor() {
    super("chunk");
    this.playerEntities = new Map(); // sessionId -> { container, sprite, label, isMe, buffer }
    this.asteroidSprites = new Map(); // id -> Phaser.GameObjects
    this.touchInput = { up: false, down: false, left: false, right: false, mining: false };
    this.localEntry = null; // referencia rápida a la entidad del propio jugador
    this.localPlayerState = null;
    this.manualLeave = false; // true si el propio jugador cerró el juego
    this.latencyMs = null;
    this.shipMeta = null; // datos de la nave activa, leídos de ships.json
    this.engineSound = null;
    this.engineSoundPlaying = false;
  }

  // Carga la textura y el sonido de la nave activa desde la carpeta
  // compartida con la naveteca (client/public/ships/). Cambiar esos
  // archivos ahí cambia lo que se ve/oye aquí, sin tocar código.
  preload() {
    const base = `${import.meta.env.BASE_URL}ships/`;
    this.load.json("shipsCatalog", `${base}ships.json`);
    this.load.image(`ship-${STARTING_SHIP_ID}`, `${base}sprites/${STARTING_SHIP_ID}.png`);
    this.load.audio(`ship-${STARTING_SHIP_ID}-hum`, `${base}sounds/${STARTING_SHIP_ID}_hum.wav`);
  }

  async create() {
    this.cameras.main.setBackgroundColor("#05050a");

    const catalog = this.cache.json.get("shipsCatalog") || [];
    this.shipMeta = catalog.find((s) => s.id === STARTING_SHIP_ID) || null;
    this.engineSound = this.sound.add(`ship-${STARTING_SHIP_ID}-hum`, { loop: true, volume: 0.12 });

    this.starfield();
    this.drawWorldBorder();
    this.setupInput();
    this.createTopBarUI();

    await this.connectToServer();
  }

  starfield() {
    for (let i = 0; i < 200; i++) {
      const x = Phaser.Math.Between(-2500, 2500);
      const y = Phaser.Math.Between(-2500, 2500);
      const star = this.add.circle(x, y, Phaser.Math.Between(1, 2), 0xffffff, Phaser.Math.FloatBetween(0.3, 0.9));
      star.setScrollFactor(0.6); // ligero parallax
    }
  }

  // Borde visual del mundo jugable. El servidor es quien realmente aplica
  // el límite (clamp de posición) — esto es solo la representación.
  drawWorldBorder() {
    const half = WORLD_SIZE / 2;
    this.add
      .rectangle(-half, -half, WORLD_SIZE, WORLD_SIZE)
      .setOrigin(0)
      .setStrokeStyle(2, 0x334455, 0.8)
      .setFillStyle();
  }

  // ---- Conexión, reconexión y binding de eventos de la room ----

  async connectToServer() {
    ui.textContent = currentStatusText;
    const unsubscribeStatus = (text) => {
      if (!this.room) ui.textContent = text;
    };
    onStatusChange(unsubscribeStatus);

    try {
      // Reutiliza la conexión que ya se inició en segundo plano nada más
      // cargar la página (mientras se leía el changelog / elegía personaje)
      // en vez de arrancar una nueva desde cero.
      this.room = roomPromise ? await roomPromise : await joinRoom();
    } catch (err) {
      ui.textContent = `Error de conexión: ${err.message}`;
      return;
    }

    // El join de fondo pudo haberse hecho con el nombre por defecto —
    // corrige al nombre real del personaje elegido.
    this.room.send("setName", CHOSEN_NAME);

    ui.textContent = `Conectado. Sesión: ${this.room.sessionId}`;

    this.bindRoomEvents();
    this.startPingLoop();

    this.room.onLeave(() => {
      if (this.manualLeave) return;
      this.handleUnexpectedDisconnect();
    });
  }

  // Vuelve a registrar todos los listeners de estado sobre this.room.
  // Se llama tanto en la conexión inicial como tras cada reconexión (la
  // room es un objeto nuevo cada vez, así que hay que re-suscribirse).
  bindRoomEvents() {
    this.room.state.players.onAdd((player, sessionId) => {
      const isMe = sessionId === this.room.sessionId;
      // Sprite real de la nave (cargado en preload() desde ships/sprites/).
      // El arte viene con el morro hacia arriba, igual que el triángulo
      // que sustituye, así que la misma fórmula de rotación sigue valiendo.
      const sprite = this.add.image(0, 0, `ship-${STARTING_SHIP_ID}`).setScale(0.5);
      sprite.setTint(isMe ? 0x9fd6ff : 0xffb090);
      const label = this.add.text(0, 22, player.name, { fontSize: "10px", color: "#cfe8ff" }).setOrigin(0.5, 0);
      const container = this.add.container(player.x, player.y, [sprite, label]);

      const entry = {
        container,
        sprite,
        label,
        isMe,
        buffer: [{ x: player.x, y: player.y, rotation: player.rotation, t: performance.now() }],
        serverX: player.x,
        serverY: player.y,
      };
      this.playerEntities.set(sessionId, entry);

      player.onChange(() => {
        entry.buffer.push({ x: player.x, y: player.y, rotation: player.rotation, t: performance.now() });
        if (entry.buffer.length > 6) entry.buffer.shift();
        entry.serverX = player.x;
        entry.serverY = player.y;
        label.setText(player.name);

        if (isMe) {
          this.updateStatusText(player);
        }
      });

      if (isMe) {
        this.cameras.main.startFollow(container, true, 0.15, 0.15);
        this.localEntry = entry;
        this.localPlayerState = player;
        this.updateStatusText(player);
      }
    });

    this.room.state.players.onRemove((_, sessionId) => {
      const entry = this.playerEntities.get(sessionId);
      if (entry) entry.container.destroy();
      this.playerEntities.delete(sessionId);
      if (sessionId === this.room.sessionId) {
        this.localEntry = null;
        this.localPlayerState = null;
      }
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

    this.room.onMessage("pong", (timestamp) => {
      this.latencyMs = Date.now() - timestamp;
      if (this.localPlayerState) this.updateStatusText(this.localPlayerState);
    });
  }

  updateStatusText(player) {
    const pingPart = this.latencyMs !== null ? `  |  Ping: ${this.latencyMs}ms` : "";
    const shipPart = this.shipMeta ? `${this.shipMeta.name} — ` : "";
    ui.textContent = `${shipPart}Carga: ${Math.floor(player.cargo)}  |  HP: ${Math.floor(player.hp)}${pingPart}`;
  }

  startPingLoop() {
    this.time.addEvent({
      delay: 2000,
      loop: true,
      callback: () => {
        if (this.room) this.room.send("ping", Date.now());
      },
    });
  }

  // Destruye todos los sprites de jugadores/asteroides actuales — se usa
  // antes de reconectar, porque la room nueva reenvía el estado completo
  // (vuelve a disparar onAdd para todo lo que ya existía).
  resetEntities() {
    this.playerEntities.forEach((entry) => entry.container.destroy());
    this.playerEntities.clear();
    this.asteroidSprites.forEach((circle) => circle.destroy());
    this.asteroidSprites.clear();
    this.localEntry = null;
    this.localPlayerState = null;
  }

  async handleUnexpectedDisconnect() {
    const token = this.room?.reconnectionToken;
    if (!token) {
      ui.textContent = "Conexión perdida. Recarga la página para volver a jugar.";
      return;
    }

    const maxAttempts = 5;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      ui.textContent = `Conexión perdida. Reconectando… (intento ${attempt}/${maxAttempts})`;
      try {
        const client = new Client(SERVER_URL);
        this.room = await client.reconnect(token);
        this.resetEntities();
        this.bindRoomEvents();
        this.room.onLeave(() => {
          if (this.manualLeave) return;
          this.handleUnexpectedDisconnect();
        });
        ui.textContent = `Reconectado. Sesión: ${this.room.sessionId}`;
        return;
      } catch {
        await new Promise((resolve) => setTimeout(resolve, 1500 * attempt));
      }
    }
    ui.textContent = "No se pudo reconectar. Recarga la página para volver a jugar.";
  }

  // ---- Input ----

  setupInput() {
    this.keys = this.input.keyboard.addKeys("W,A,S,D,SPACE");

    if (this.sys.game.device.input.touch) {
      this.setupMiningButton();
      this.setupVirtualJoystick();
    }

    this.time.addEvent({
      delay: 50, // cadencia de red — no tiene por qué ir a la par del render
      loop: true,
      callback: () => {
        if (this.room) this.room.send("input", this.currentInput());
      },
    });
  }

  currentInput() {
    return {
      up: this.keys.W.isDown || this.touchInput.up,
      down: this.keys.S.isDown || this.touchInput.down,
      left: this.keys.A.isDown || this.touchInput.left,
      right: this.keys.D.isDown || this.touchInput.right,
      mining: this.keys.SPACE.isDown || this.touchInput.mining,
    };
  }

  update(time, delta) {
    if (!this.room) return;
    this.predictLocalMovement(delta);
    this.interpolateRemotePlayers();
  }

  // Arranca/para el zumbido de motor en bucle, sin reiniciarlo en cada
  // frame — solo actúa cuando cambia el estado (empieza o deja de
  // acelerar). Es el mismo archivo de sonido que usa la naveteca.
  updateEngineSound(isThrusting) {
    if (!this.engineSound) return;
    if (isThrusting && !this.engineSoundPlaying) {
      this.engineSound.play();
      this.engineSoundPlaying = true;
    } else if (!isThrusting && this.engineSoundPlaying) {
      this.engineSound.stop();
      this.engineSoundPlaying = false;
    }
  }

  predictLocalMovement(delta) {
    if (!this.localEntry) return;

    const input = this.currentInput();
    let dx = 0;
    let dy = 0;
    if (input.up) dy -= 1;
    if (input.down) dy += 1;
    if (input.left) dx -= 1;
    if (input.right) dx += 1;

    const isThrusting = dx !== 0 || dy !== 0;
    this.updateEngineSound(isThrusting);

    if (isThrusting) {
      const len = Math.hypot(dx, dy);
      const dt = delta / 1000;
      const half = WORLD_SIZE / 2;
      this.localEntry.container.x = Phaser.Math.Clamp(
        this.localEntry.container.x + (dx / len) * SHIP_SPEED * dt,
        -half,
        half
      );
      this.localEntry.container.y = Phaser.Math.Clamp(
        this.localEntry.container.y + (dy / len) * SHIP_SPEED * dt,
        -half,
        half
      );
      this.localEntry.sprite.rotation = Math.atan2(dy, dx) + Math.PI / 2;
    }

    const drift = Phaser.Math.Distance.Between(
      this.localEntry.container.x,
      this.localEntry.container.y,
      this.localEntry.serverX,
      this.localEntry.serverY
    );
    if (drift > 150) {
      this.localEntry.container.x = Phaser.Math.Linear(this.localEntry.container.x, this.localEntry.serverX, 0.2);
      this.localEntry.container.y = Phaser.Math.Linear(this.localEntry.container.y, this.localEntry.serverY, 0.2);
    }
  }

  interpolateRemotePlayers() {
    const renderTime = performance.now() - INTERP_DELAY_MS;

    this.playerEntities.forEach((entry) => {
      if (entry.isMe) return;

      const buf = entry.buffer;
      if (buf.length === 0) return;
      if (buf.length === 1) {
        entry.container.x = buf[0].x;
        entry.container.y = buf[0].y;
        entry.sprite.rotation = buf[0].rotation + Math.PI / 2;
        return;
      }

      let older = buf[0];
      let newer = buf[buf.length - 1];
      for (let i = 0; i < buf.length - 1; i++) {
        if (buf[i].t <= renderTime && buf[i + 1].t >= renderTime) {
          older = buf[i];
          newer = buf[i + 1];
          break;
        }
      }

      const span = newer.t - older.t || 1;
      const t = Phaser.Math.Clamp((renderTime - older.t) / span, 0, 1);
      entry.container.x = Phaser.Math.Linear(older.x, newer.x, t);
      entry.container.y = Phaser.Math.Linear(older.y, newer.y, t);
      entry.sprite.rotation = Phaser.Math.Linear(older.rotation, newer.rotation, t) + Math.PI / 2;
    });
  }

  // ---- Controles táctiles ----

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
      if (activePointerId !== null) return;
      if (insideMiningButton(pointer.x, pointer.y)) return;

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

  // ---- UI: versión, ping, menú ----

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

  closeGame() {
    this.manualLeave = true;
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

let gameInstance = null;

function launchGame() {
  if (gameInstance) return; // evita instanciar Phaser dos veces
  gameInstance = new Phaser.Game({
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
}
