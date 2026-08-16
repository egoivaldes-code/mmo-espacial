import Phaser from "phaser";
import { Client } from "colyseus.js";

// Súbela en cada release — se muestra en pantalla y sirve de referencia
// rápida para saber si el cliente cargado es el último.
const GAME_VERSION = "v0.0.7";

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

// Misma clave de localStorage que usa client/public/naveteca/index.html.
const SHIP_OVERRIDES_KEY = "spacemmo_ship_overrides";

function getLocalShipOverride(shipId) {
  try {
    const raw = localStorage.getItem(SHIP_OVERRIDES_KEY);
    if (!raw) return null;
    const all = JSON.parse(raw);
    return all[shipId] || null;
  } catch {
    return null;
  }
}

// Zoom de la cámara — límites razonables para no perder el contexto del
// mundo ni acercarse tanto que se pixele el sprite.
const MIN_ZOOM = 0.5;
const MAX_ZOOM = 2.5;
const DEFAULT_ZOOM = 1;

const ui = document.getElementById("ui");

// ============================================================================
// Idioma — el juego está preparado para varios desde el principio. Se
// elige aquí (o en Opciones dentro de la partida) y todo el texto de la
// interfaz (HTML y Phaser) sale de estos diccionarios, no hay texto fijo
// repartido por el código. Añadir un idioma nuevo es: crear
// client/public/i18n/xx.json + client/public/patchnotes/xx.json y sumarlo
// a AVAILABLE_LANGUAGES — no hace falta tocar nada más.
// ============================================================================

const LANG_STORAGE_KEY = "spacemmo_lang";
const DEFAULT_LANG = "es";
const AVAILABLE_LANGUAGES = [
  { code: "es", label: "Español" },
  { code: "en", label: "English" },
];

let TRANSLATIONS = {};
let currentLang = DEFAULT_LANG;

function detectInitialLang() {
  const saved = localStorage.getItem(LANG_STORAGE_KEY);
  if (saved && AVAILABLE_LANGUAGES.some((l) => l.code === saved)) return saved;

  const browserLang = (navigator.language || "es").slice(0, 2).toLowerCase();
  if (AVAILABLE_LANGUAGES.some((l) => l.code === browserLang)) return browserLang;

  return DEFAULT_LANG;
}

async function loadTranslations() {
  currentLang = detectInitialLang();
  try {
    const res = await fetch(`${import.meta.env.BASE_URL}i18n/${currentLang}.json`);
    TRANSLATIONS = await res.json();
  } catch {
    currentLang = DEFAULT_LANG;
    TRANSLATIONS = {};
  }
}

// Busca una clave tipo "hud.pingSuffix" en el diccionario y sustituye
// variables {nombre} por sus valores. Si falta la clave, devuelve la
// propia clave (visible y fácil de detectar, en vez de romper la UI).
function t(key, vars) {
  const parts = key.split(".");
  let node = TRANSLATIONS;
  for (const p of parts) {
    node = node?.[p];
  }
  if (typeof node !== "string") return key;
  if (!vars) return node;
  return node.replace(/\{(\w+)\}/g, (_, name) => (vars[name] !== undefined ? String(vars[name]) : ""));
}

function localeForLang(lang) {
  return lang === "en" ? "en-US" : "es-ES";
}

function setLanguage(code) {
  localStorage.setItem(LANG_STORAGE_KEY, code);
  location.reload();
}

// ============================================================================
// Conexión en segundo plano — arranca nada más cargar la página, antes de
// que el jugador termine de leer las patch notes o elegir personaje. Así
// se aprovecha ese tiempo para que el servidor de Render despierte si
// estaba dormido (el plan gratuito duerme tras inactividad).
// ============================================================================

let roomPromise = null;
let CHOSEN_NAME = "Piloto";

const statusListeners = new Set();
let currentStatusText = "";

function setStatus(text) {
  currentStatusText = text;
  statusListeners.forEach((fn) => fn(text));
}

function onStatusChange(fn) {
  statusListeners.add(fn);
  fn(currentStatusText);
}

function httpUrlFromWsUrl(wsUrl) {
  return wsUrl.replace(/^wss:/, "https:").replace(/^ws:/, "http:");
}

// "Despierta" el servidor con una petición ligera antes de intentar la
// conexión real por websocket. Si el servidor está dormido (Render free
// tier), esta petición se queda esperando hasta que arranca — es
// justamente lo que da tiempo para leer las patch notes.
async function warmupServer() {
  const httpUrl = httpUrlFromWsUrl(SERVER_URL);
  const hintTimer = setTimeout(() => {
    setStatus(t("intro.wakingServer"));
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
}

function joinRoom() {
  const client = new Client(SERVER_URL);
  return client.joinOrCreate("chunk", { name: CHOSEN_NAME });
}

async function startBackgroundConnection() {
  setStatus(t("intro.checkingServer"));
  await warmupServer();
  setStatus(t("intro.serverReady"));

  roomPromise = joinRoom();
  try {
    await roomPromise;
    setStatus(t("intro.connected"));
  } catch (err) {
    setStatus(t("intro.connectionError", { error: err.message }));
  }
}

// ============================================================================
// Pantalla 1: patch notes (resumen para jugador) + barra de estado, ANCLADA
// ARRIBA — así nunca se pierde de vista aunque se haga scroll a las notas.
// ============================================================================

function escapeHtml(str) {
  return String(str).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

const introScrollInner = document.getElementById("intro-scroll-inner");
const loadStatusEl = document.getElementById("load-status");
const introContinueBtn = document.getElementById("intro-continue-btn");
const introScreen = document.getElementById("intro-screen");
const characterScreen = document.getElementById("character-screen");

onStatusChange((text) => {
  loadStatusEl.textContent = text;
});

async function loadPatchNotes() {
  try {
    const res = await fetch(`${import.meta.env.BASE_URL}patchnotes/${currentLang}.json`);
    const notes = await res.json();
    introScrollInner.innerHTML = notes
      .map((entry) => {
        const isCurrent = entry.version === GAME_VERSION;
        const tag = isCurrent ? `<span class="current-tag">${escapeHtml(t("intro.current"))}</span>` : "";
        const items = entry.highlights.map((h) => `<li>${escapeHtml(h)}</li>`).join("");
        return `
          <div class="patch-entry">
            <div class="patch-version">${escapeHtml(entry.version)}${tag}</div>
            <ul>${items}</ul>
          </div>
        `;
      })
      .join("");
  } catch {
    introScrollInner.innerHTML = `<p>${escapeHtml(t("intro.loadError"))}</p>`;
  }
}

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

const charTitleEl = document.getElementById("char-title");
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
    const dateStr = new Date(char.createdAt).toLocaleDateString(localeForLang(currentLang));
    btn.innerHTML = `${escapeHtml(char.name)}<div class="char-meta">${escapeHtml(t("character.createdOn", { date: dateStr }))}</div>`;
    btn.addEventListener("click", () => selectCharacter(char));
    charListEl.appendChild(btn);
  });

  const atLimit = characters.length >= MAX_CHARACTERS;
  charLimitMsg.style.display = atLimit ? "block" : "none";

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
  const name = typed ? typed.slice(0, 16) : t("character.defaultName", { n: characters.length + 1 });

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
  launchGame();
}

// Aplica las traducciones a los textos fijos del HTML (una vez, al arrancar).
function applyStaticTranslations() {
  introContinueBtn.textContent = t("intro.continue");
  charTitleEl.textContent = t("character.title");
  charNameInput.placeholder = t("character.namePlaceholder");
  charCreateBtn.textContent = t("character.createButton");
  charCreateToggleBtn.textContent = t("character.createNewToggle");
  charLimitMsg.textContent = t("character.limitReached");
}

// ============================================================================
// Arranque: cargar idioma antes que nada (para no mostrar texto sin
// traducir ni un instante), luego patch notes + conexión en paralelo.
// ============================================================================

async function boot() {
  await loadTranslations();
  applyStaticTranslations();
  loadPatchNotes();
  startBackgroundConnection();
  introScreen.style.visibility = "visible";
}

boot();

// ============================================================================
// Juego (Phaser + Colyseus)
// ============================================================================

class ChunkScene extends Phaser.Scene {
  constructor() {
    super("chunk");
    this.playerEntities = new Map(); // sessionId -> { container, sprite, label, isMe, buffer }
    this.asteroidSprites = new Map(); // id -> Phaser.GameObjects
    this.touchInput = { up: false, down: false, left: false, right: false, mining: false };
    this.localEntry = null;
    this.localPlayerState = null;
    this.manualLeave = false;
    this.latencyMs = null;
    this.shipMeta = null;
    this.engineSound = null;
    this.engineSoundPlaying = false;
    this.pinchPointers = new Map(); // id -> {x,y}, dedos libres candidatos a pellizco
    this.lastPinchDistance = null;
  }

  preload() {
    const base = `${import.meta.env.BASE_URL}ships/`;
    this.load.json("shipsCatalog", `${base}ships.json`);

    const override = getLocalShipOverride(STARTING_SHIP_ID);

    if (override?.spriteDataUrl) {
      this.load.image(`ship-${STARTING_SHIP_ID}`, override.spriteDataUrl);
    } else {
      this.load.image(`ship-${STARTING_SHIP_ID}`, `${base}sprites/${STARTING_SHIP_ID}.png`);
    }

    if (override?.soundDataUrl) {
      this.load.audio(`ship-${STARTING_SHIP_ID}-hum`, [override.soundDataUrl]);
    } else {
      this.load.audio(`ship-${STARTING_SHIP_ID}-hum`, `${base}sounds/${STARTING_SHIP_ID}_hum.wav`);
    }
  }

  async create() {
    this.cameras.main.setBackgroundColor("#05050a");
    this.cameras.main.setZoom(DEFAULT_ZOOM);

    const catalog = this.cache.json.get("shipsCatalog") || [];
    const baseMeta = catalog.find((s) => s.id === STARTING_SHIP_ID) || null;
    const override = getLocalShipOverride(STARTING_SHIP_ID);
    this.shipMeta = override && baseMeta ? { ...baseMeta, ...override, stats: { ...baseMeta.stats, ...(override.stats || {}) } } : baseMeta;

    this.engineSound = this.sound.add(`ship-${STARTING_SHIP_ID}-hum`, { loop: true, volume: 0.12 });

    this.starfield();
    this.drawWorldBorder();
    this.setupInput();
    this.setupZoom();
    this.createTopBarUI();

    await this.connectToServer();
  }

  starfield() {
    for (let i = 0; i < 200; i++) {
      const x = Phaser.Math.Between(-2500, 2500);
      const y = Phaser.Math.Between(-2500, 2500);
      const star = this.add.circle(x, y, Phaser.Math.Between(1, 2), 0xffffff, Phaser.Math.FloatBetween(0.3, 0.9));
      star.setScrollFactor(0.6);
    }
  }

  drawWorldBorder() {
    const half = WORLD_SIZE / 2;
    this.add
      .rectangle(-half, -half, WORLD_SIZE, WORLD_SIZE)
      .setOrigin(0)
      .setStrokeStyle(2, 0x334455, 0.8)
      .setFillStyle();
  }

  // ---- Zoom: rueda del ratón (PC) + pellizco con dos dedos (táctil) ----

  setupZoom() {
    this.input.on("wheel", (_pointer, _gameObjects, _dx, dy) => {
      this.adjustZoom(-dy * 0.0015);
    });
  }

  setZoom(value) {
    const clamped = Phaser.Math.Clamp(value, MIN_ZOOM, MAX_ZOOM);
    this.cameras.main.setZoom(clamped);
    // Compensa el HUD persistente para que no cambie de tamaño en pantalla
    // al hacer zoom del mundo (el zoom de cámara afecta también a los
    // objetos con scrollFactor 0 en Phaser, así que hay que contrarrestarlo).
    const compensate = 1 / clamped;
    this.versionText?.setScale(compensate);
    this.menuBtn?.setScale(compensate);
    if (this.optionsMenu) this.optionsMenu.setScale(compensate);
  }

  adjustZoom(delta) {
    this.setZoom(this.cameras.main.zoom + delta);
  }

  // ---- Conexión, reconexión y binding de eventos de la room ----

  async connectToServer() {
    ui.textContent = currentStatusText;
    onStatusChange((text) => {
      if (!this.room) ui.textContent = text;
    });

    try {
      this.room = roomPromise ? await roomPromise : await joinRoom();
    } catch (err) {
      ui.textContent = t("hud.connectionError", { error: err.message });
      return;
    }

    this.room.send("setName", CHOSEN_NAME);
    ui.textContent = t("hud.connectedSession", { id: this.room.sessionId });

    this.bindRoomEvents();
    this.startPingLoop();

    this.room.onLeave(() => {
      if (this.manualLeave) return;
      this.handleUnexpectedDisconnect();
    });
  }

  bindRoomEvents() {
    this.room.state.players.onAdd((player, sessionId) => {
      const isMe = sessionId === this.room.sessionId;
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
    const pingPart = this.latencyMs !== null ? t("hud.pingSuffix", { ms: this.latencyMs }) : "";
    const shipPart = this.shipMeta ? `${this.shipMeta.name} — ` : "";
    ui.textContent = t("hud.shipCargoHp", {
      ship: shipPart,
      cargo: Math.floor(player.cargo),
      hp: Math.floor(player.hp),
      ping: pingPart,
    });
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
      ui.textContent = t("hud.connectionLost");
      return;
    }

    const maxAttempts = 5;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      ui.textContent = t("hud.reconnecting", { attempt, max: maxAttempts });
      try {
        const client = new Client(SERVER_URL);
        this.room = await client.reconnect(token);
        this.resetEntities();
        this.bindRoomEvents();
        this.room.onLeave(() => {
          if (this.manualLeave) return;
          this.handleUnexpectedDisconnect();
        });
        ui.textContent = t("hud.reconnected", { id: this.room.sessionId });
        return;
      } catch {
        await new Promise((resolve) => setTimeout(resolve, 1500 * attempt));
      }
    }
    ui.textContent = t("hud.couldNotReconnect");
  }

  // ---- Input ----

  setupInput() {
    this.keys = this.input.keyboard.addKeys("W,A,S,D,SPACE");

    if (this.sys.game.device.input.touch) {
      this.setupMiningButton();
      this.setupTouchMovementAndZoom();
    }

    this.time.addEvent({
      delay: 50,
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
      const tt = Phaser.Math.Clamp((renderTime - older.t) / span, 0, 1);
      entry.container.x = Phaser.Math.Linear(older.x, newer.x, tt);
      entry.container.y = Phaser.Math.Linear(older.y, newer.y, tt);
      entry.sprite.rotation = Phaser.Math.Linear(older.rotation, newer.rotation, tt) + Math.PI / 2;
    });
  }

  // ---- Controles táctiles: botón de minar, joystick, y pellizco de zoom ----

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
      .text(x, y, t("controls.mine"), { fontSize: "12px", color: "#ffffff" })
      .setOrigin(0.5)
      .setScrollFactor(0)
      .setDepth(101);

    this.miningButtonBounds = { x, y, radius: radius + 15 };

    circle.on("pointerdown", (pointer) => {
      this.touchInput.mining = true;
      this.touchPurpose.set(pointer.id, "mining");
    });
    const releaseMining = (pointer) => {
      this.touchInput.mining = false;
      if (this.touchPurpose.get(pointer.id) === "mining") this.touchPurpose.delete(pointer.id);
    };
    circle.on("pointerup", releaseMining);
    circle.on("pointerout", releaseMining);
  }

  // Un único listener de pointerdown/move/up gestiona tres cosas a la vez:
  // el joystick (primer dedo libre), el pellizco de zoom (dos dedos libres
  // que no sean ni el joystick ni el botón de minar), y limpieza al soltar.
  // Un único listener de pointerdown/move/up gestiona tres cosas: el botón
  // de minar (aparte, en setupMiningButton), el joystick, y el pellizco de
  // zoom. El truco para que no se disparen a la vez: el primer dedo NO se
  // compromete al joystick al instante — espera un margen corto
  // (JOYSTICK_COMMIT_DELAY) por si llega un segundo dedo, en cuyo caso el
  // gesto se reinterpreta como pellizco en vez de arrancar el joystick.
  setupTouchMovementAndZoom() {
    this.touchPurpose = new Map(); // pointer.id -> "joystick" | "mining" | "pinch"
    const maxRadius = 60;
    const deadzone = maxRadius * 0.2;
    const JOYSTICK_COMMIT_DELAY = 120; // ms

    let base = null;
    let thumb = null;
    let joystickPointerId = null;
    let pendingJoystickPointer = null; // { id, x, y } — a la espera de confirmación
    let pendingTimer = null;

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

    const commitJoystick = ({ id, x, y }) => {
      joystickPointerId = id;
      this.touchPurpose.set(id, "joystick");
      const compensate = 1 / this.cameras.main.zoom;
      base = this.add
        .circle(x, y, maxRadius, 0x66ccff, 0.15)
        .setScrollFactor(0)
        .setDepth(90)
        .setStrokeStyle(2, 0x66ccff, 0.5)
        .setScale(compensate);
      thumb = this.add
        .circle(x, y, 26, 0x66ccff, 0.35)
        .setScrollFactor(0)
        .setDepth(91)
        .setScale(compensate);
    };

    const destroyJoystick = () => {
      base?.destroy();
      thumb?.destroy();
      base = null;
      thumb = null;
      joystickPointerId = null;
      resetDirections();
    };

    const startPinch = (p1, p2) => {
      this.touchPurpose.set(p1.id, "pinch");
      this.touchPurpose.set(p2.id, "pinch");
      this.pinchPointers.set(p1.id, { x: p1.x, y: p1.y });
      this.pinchPointers.set(p2.id, { x: p2.x, y: p2.y });
      this.lastPinchDistance = Phaser.Math.Distance.Between(p1.x, p1.y, p2.x, p2.y);
    };

    const endPinch = () => {
      this.touchPurpose.forEach((purpose, id) => {
        if (purpose === "pinch") this.touchPurpose.delete(id);
      });
      this.pinchPointers.clear();
      this.lastPinchDistance = null;
    };

    this.input.on("pointerdown", (pointer) => {
      if (insideMiningButton(pointer.x, pointer.y)) return; // lo gestiona el botón

      // Ya hay un joystick confirmado o un pellizco en marcha — no se
      // reconoce un tercer gesto simultáneo, se ignora este dedo extra.
      if (joystickPointerId !== null || this.pinchPointers.size > 0) return;

      if (pendingJoystickPointer) {
        // Llega un segundo dedo mientras el primero seguía "pendiente" de
        // confirmar — es un pellizco, no dos joysticks.
        clearTimeout(pendingTimer);
        startPinch(pendingJoystickPointer, { id: pointer.id, x: pointer.x, y: pointer.y });
        pendingJoystickPointer = null;
        pendingTimer = null;
        return;
      }

      // Primer dedo — candidato a joystick, con un margen corto por si
      // llega un segundo dedo (pellizco).
      pendingJoystickPointer = { id: pointer.id, x: pointer.x, y: pointer.y };
      pendingTimer = setTimeout(() => {
        if (pendingJoystickPointer && pendingJoystickPointer.id === pointer.id) {
          commitJoystick(pendingJoystickPointer);
          pendingJoystickPointer = null;
        }
        pendingTimer = null;
      }, JOYSTICK_COMMIT_DELAY);
    });

    this.input.on("pointermove", (pointer) => {
      // Mantiene actualizada la posición del dedo pendiente, para que si
      // se confirma como joystick aparezca donde está el dedo ahora, no
      // donde tocó por primera vez hace unos ms.
      if (pendingJoystickPointer && pendingJoystickPointer.id === pointer.id) {
        pendingJoystickPointer.x = pointer.x;
        pendingJoystickPointer.y = pointer.y;
      }

      const purpose = this.touchPurpose.get(pointer.id);

      if (purpose === "joystick" && joystickPointerId === pointer.id && base) {
        const dx = pointer.x - base.x;
        const dy = pointer.y - base.y;
        const dist = Math.min(Math.hypot(dx, dy), maxRadius);
        const angle = Math.atan2(dy, dx);

        thumb.x = base.x + Math.cos(angle) * dist;
        thumb.y = base.y + Math.sin(angle) * dist;

        if (dist < deadzone) {
          resetDirections();
        } else {
          this.touchInput.right = Math.cos(angle) > 0.3;
          this.touchInput.left = Math.cos(angle) < -0.3;
          this.touchInput.down = Math.sin(angle) > 0.3;
          this.touchInput.up = Math.sin(angle) < -0.3;
        }
        return;
      }

      if (purpose === "pinch" && this.pinchPointers.has(pointer.id)) {
        this.pinchPointers.set(pointer.id, { x: pointer.x, y: pointer.y });
        if (this.pinchPointers.size === 2) {
          const [a, b] = [...this.pinchPointers.values()];
          const dist = Phaser.Math.Distance.Between(a.x, a.y, b.x, b.y);
          if (this.lastPinchDistance !== null) {
            const ratio = dist / this.lastPinchDistance;
            this.setZoom(this.cameras.main.zoom * ratio);
          }
          this.lastPinchDistance = dist;
        }
      }
    });

    this.input.on("pointerup", (pointer) => {
      if (pendingJoystickPointer && pendingJoystickPointer.id === pointer.id) {
        // Se levantó el dedo antes de que se confirmara nada (toque suelto).
        clearTimeout(pendingTimer);
        pendingTimer = null;
        pendingJoystickPointer = null;
        return;
      }

      const purpose = this.touchPurpose.get(pointer.id);
      this.touchPurpose.delete(pointer.id);

      if (purpose === "joystick" && joystickPointerId === pointer.id) {
        destroyJoystick();
      } else if (purpose === "pinch") {
        // Al soltar cualquiera de los dos dedos del pellizco se cierra el
        // gesto entero — hay que volver a tocar con dos dedos para otro.
        endPinch();
      }
    });
  }

  // ---- UI: versión, ping, menú de opciones (con selector de idioma) ----

  createTopBarUI() {
    this.versionText = this.add
      .text(this.scale.width - 10, 10, GAME_VERSION, {
        fontSize: "12px",
        color: "#7d93b0",
      })
      .setOrigin(1, 0)
      .setScrollFactor(0)
      .setDepth(200);

    this.menuBtn = this.add
      .text(10, 10, "☰", {
        fontSize: "20px",
        color: "#cfe8ff",
        backgroundColor: "#141a24",
        padding: { x: 8, y: 4 },
      })
      .setScrollFactor(0)
      .setDepth(200)
      .setInteractive({ useHandCursor: true });

    this.menuBtn.on("pointerdown", () => this.toggleOptionsMenu());
  }

  toggleOptionsMenu() {
    if (this.optionsMenu) {
      this.optionsMenu.destroy();
      this.optionsMenu = null;
      return;
    }

    const w = 240;
    const langRowH = 30;
    const h = 140 + AVAILABLE_LANGUAGES.length * langRowH;
    const x = this.scale.width / 2 - w / 2;
    const y = this.scale.height / 2 - h / 2;

    const bg = this.add.rectangle(0, 0, w, h, 0x0a0e16, 0.95).setOrigin(0).setStrokeStyle(1, 0x334455);
    const title = this.add.text(w / 2, 16, t("menu.title"), { fontSize: "14px", color: "#cfe8ff" }).setOrigin(0.5, 0);
    const version = this.add
      .text(w / 2, 38, GAME_VERSION, { fontSize: "11px", color: "#7d93b0" })
      .setOrigin(0.5, 0);

    const langLabel = this.add
      .text(16, 60, t("menu.language"), { fontSize: "11px", color: "#7d93b0" })
      .setOrigin(0, 0);

    const langButtons = AVAILABLE_LANGUAGES.map((lang, i) => {
      const isCurrent = lang.code === currentLang;
      const btn = this.add
        .text(16, 78 + i * langRowH, `${isCurrent ? "● " : "○ "}${lang.label}`, {
          fontSize: "13px",
          color: isCurrent ? "#66ccff" : "#cfe8ff",
        })
        .setOrigin(0, 0)
        .setInteractive({ useHandCursor: true });
      btn.on("pointerdown", () => setLanguage(lang.code));
      return btn;
    });

    const closeBtn = this.add
      .text(w / 2, h - 34, t("menu.closeGame"), {
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
      .container(x, y, [bg, title, version, langLabel, ...langButtons, closeBtn, dismissBtn])
      .setScrollFactor(0)
      .setDepth(300)
      .setScale(1 / this.cameras.main.zoom);
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
      .text(this.scale.width / 2, this.scale.height / 2, `${t("menu.gameClosedLine1")}\n${t("menu.gameClosedLine2")}`, {
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
  if (gameInstance) return;
  gameInstance = new Phaser.Game({
    type: Phaser.AUTO,
    parent: document.body,
    width: window.innerWidth,
    height: window.innerHeight,
    backgroundColor: "#05050a",
    scene: [ChunkScene],
    input: {
      activePointers: 3, // joystick + botón de minar + un dedo extra para pellizco
    },
  });
}
