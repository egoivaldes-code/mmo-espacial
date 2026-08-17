import Phaser from "phaser";
import { Client } from "colyseus.js";

// Súbela en cada release — se muestra en pantalla y sirve de referencia
// rápida para saber si el cliente cargado es el último.
const GAME_VERSION = "v0.1.2";

// En local usa ws://localhost:2567 (ver client/.env.example).
// En producción, define VITE_SERVER_URL en las variables de entorno de tu
// build (p. ej. GitHub Pages via Actions) apuntando a wss://tu-servicio.onrender.com
const SERVER_URL = import.meta.env.VITE_SERVER_URL || "ws://localhost:2567";

// Debe coincidir con las constantes homónimas del servidor
// (server/rooms/ChunkRoom.js). Candidatas a mover a un archivo de config
// compartido más adelante.
// Física de vuelo — DEBE coincidir exactamente con las constantes
// homónimas de server/rooms/ChunkRoom.js (es la misma simulación
// replicada en cliente para la predicción local). Ver el comentario
// largo allí para la explicación completa del modelo.
const TURN_RATE = Math.PI; // rad/s
const ACCELERATION = 300; // unidades/s²
const MAX_SPEED = 240; // unidades/s
const DRAG = 0.6;
const WARP_SPEED_MULTIPLIER = 5; // debe coincidir con el servidor

const WORLD_SIZE = 30000;

// Recorta el padding transparente alrededor del sprite real dentro del
// PNG. Los sprites de naveteca vienen en lienzos de tamaño uniforme con
// mucho margen vacío alrededor de cada nave — eso hace que, a la misma
// escala visual, una fragata "ocupe" muchos menos píxeles reales que su
// silueta debería, y se pixele antes al hacer zoom in. Recortar al
// bounding box real del contenido opaco arregla eso sin tocar el arte.
//
// Nota: esto NO resuelve todavía el problema completo de escala entre
// clases de nave (fragata vs dreadnought) — eso es trabajo de pipeline de
// arte (LOD/mipmaps por clase), pendiente aparte. Esto solo asegura que
// cada sprite individual usa el máximo de resolución disponible en su
// propio PNG.
function trimTransparentPadding(scene, key, alphaThreshold = 8) {
  const source = scene.textures.get(key)?.getSourceImage();
  if (!source || !source.width) return;

  const full = document.createElement("canvas");
  full.width = source.width;
  full.height = source.height;
  const fullCtx = full.getContext("2d");
  fullCtx.drawImage(source, 0, 0);

  const { data } = fullCtx.getImageData(0, 0, full.width, full.height);
  let minX = full.width;
  let minY = full.height;
  let maxX = -1;
  let maxY = -1;

  for (let y = 0; y < full.height; y++) {
    for (let x = 0; x < full.width; x++) {
      const alpha = data[(y * full.width + x) * 4 + 3];
      if (alpha > alphaThreshold) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }

  if (maxX < minX || maxY < minY) return; // sprite completamente vacío, no tocar

  const w = maxX - minX + 1;
  const h = maxY - minY + 1;
  if (w === full.width && h === full.height) return; // ya estaba ajustado

  const trimmed = document.createElement("canvas");
  trimmed.width = w;
  trimmed.height = h;
  trimmed.getContext("2d").drawImage(full, minX, minY, w, h, 0, 0, w, h);

  scene.textures.remove(key);
  scene.textures.addCanvas(key, trimmed);
}

// Diferencia angular más corta entre dos ángulos, en [-PI, PI].
function angleDiff(from, to) {
  let diff = (to - from) % (Math.PI * 2);
  if (diff > Math.PI) diff -= Math.PI * 2;
  if (diff < -Math.PI) diff += Math.PI * 2;
  return diff;
}

// Cuánto "en el pasado" se dibujan los jugadores remotos, para poder
// interpolar entre dos posiciones reales del servidor en vez de saltar de
// una a otra. Más alto = más suave pero más lag visual de los demás.
const INTERP_DELAY_MS = 100;

// Debe ser <= RECONNECT_GRACE_S del servidor (server/rooms/ChunkRoom.js).
// Un margen de 5s por debajo evita reintentar ya sabiendo que el asiento
// del servidor va a haber expirado.
const RECONNECT_WINDOW_MS = 85000;

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
const MIN_ZOOM = 0.025; // con WORLD_SIZE=30.000, hace falta esto de bajo para ver el sistema entero
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
    // Textura de la estela de plasma — un disco suave generado a mano,
    // sin necesidad de un asset nuevo de arte. Pequeño a propósito: con
    // el ángulo de emisión ahora fijo (chorro, no nube — ver
    // updateEngineTrailPosition), varias partículas finas y seguidas se
    // leen como un chorro continuo, no como bolas sueltas.
    const trailGfx = this.make.graphics({ x: 0, y: 0, add: false });
    trailGfx.fillStyle(0xffffff, 1);
    trailGfx.fillCircle(4, 4, 4);
    trailGfx.generateTexture("plasma-particle", 8, 8);
    trailGfx.destroy();

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

    // Los objetos Text de Phaser renderizan su propio bitmap interno a
    // resolución 1 por defecto, INDEPENDIENTEMENTE del `resolution` del
    // canvas general — por eso salían borrosos en pantallas de alta
    // densidad aunque el resto del render ya estuviera nítido. Se aplica
    // a cada `this.add.text(...)` de la escena. Tope en 3 para no gastar
    // memoria de más en dispositivos con devicePixelRatio muy alto.
    this.textResolution = Math.min(window.devicePixelRatio || 1, 3);

    // Cámara de HUD dedicada, siempre a zoom 1 y sin scroll. Antes el HUD
    // (menú, versión, botón de minar, joystick) se dibujaba en la cámara
    // principal con scrollFactor(0) + un setScale(1/zoom) manual por
    // elemento para contrarrestar el zoom del mundo — Phaser aplica el
    // zoom de cámara también a los objetos con scrollFactor(0), así que
    // cualquier elemento sin ese parche se desajustaba al hacer zoom out.
    // Con una cámara aparte que ignora el mundo, el HUD nunca ve el zoom
    // y no hace falta compensar nada a mano.
    this.worldLayer = this.add.layer();
    this.hudLayer = this.add.layer();
    this.uiCamera = this.cameras.add(0, 0, this.scale.width, this.scale.height);
    this.uiCamera.setScroll(0, 0);
    this.uiCamera.setZoom(1);
    this.uiCamera.setBackgroundColor("rgba(0,0,0,0)");
    this.cameras.main.ignore(this.hudLayer);
    this.uiCamera.ignore(this.worldLayer);

    const catalog = this.cache.json.get("shipsCatalog") || [];
    const baseMeta = catalog.find((s) => s.id === STARTING_SHIP_ID) || null;
    const override = getLocalShipOverride(STARTING_SHIP_ID);
    this.shipMeta = override && baseMeta ? { ...baseMeta, ...override, stats: { ...baseMeta.stats, ...(override.stats || {}) } } : baseMeta;

    trimTransparentPadding(this, `ship-${STARTING_SHIP_ID}`);

    this.engineSound = this.sound.add(`ship-${STARTING_SHIP_ID}-hum`, { loop: true, volume: 0.12 });

    this.starfield();
    this.drawWorldBorder();
    this.setupInput();
    this.setupZoom();
    this.createTopBarUI();
    this.setupVisibilityRetry();

    await this.connectToServer();
  }

  starfield() {
    // Rango ajustado a WORLD_SIZE=30.000 y al nuevo MIN_ZOOM=0.025 — el
    // campo de estrellas tiene que cubrir más que el propio mundo
    // jugable para no dejar un vacío negro alrededor al ver el sistema
    // entero con el zoom mínimo.
    for (let i = 0; i < 900; i++) {
      const x = Phaser.Math.Between(-22000, 22000);
      const y = Phaser.Math.Between(-22000, 22000);
      const star = this.add.circle(x, y, Phaser.Math.Between(1, 2), 0xffffff, Phaser.Math.FloatBetween(0.3, 0.9));
      star.setScrollFactor(0.6);
      this.worldLayer.add(star);
    }
  }

  drawWorldBorder() {
    const half = WORLD_SIZE / 2;
    const border = this.add
      .rectangle(-half, -half, WORLD_SIZE, WORLD_SIZE)
      .setOrigin(0)
      .setStrokeStyle(2, 0x334455, 0.8)
      .setFillStyle();
    this.worldLayer.add(border);
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
    // El HUD vive en this.uiCamera, que siempre está a zoom 1 — ya no hace
    // falta compensar manualmente cada elemento (ver hudLayer en create()).
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
      // El nombre no se muestra sobre la propia nave — solo tiene
      // sentido para identificar a los demás jugadores en pantalla.
      const label = this.add
        .text(0, 22, isMe ? "" : player.name, { fontSize: "10px", color: "#cfe8ff", resolution: this.textResolution })
        .setOrigin(0.5, 0);
      const container = this.add.container(player.x, player.y, [sprite, label]);
      this.worldLayer.add(container);

      // Estela de plasma del motor — solo se activa mientras la nave
      // acelera (ver updateEngineTrail, llamado desde predictLocalMovement
      // para la nave propia; las remotas se activan por cambio de posición).
      const engineTrail = this.add.particles(0, 0, "plasma-particle", {
        // Sin "follow": la posición se actualiza a mano cada frame
        // (updateEngineTrailPosition) para poder colocarla detrás de la
        // nave según su orientación real, no un offset fijo en pantalla.
        // "angle" y "speed" arrancan con un valor cualquiera — se
        // sobreescriben nada más crearse la nave, en updateEngineTrailPosition.
        lifespan: 220,
        angle: -90,
        speed: 60,
        scale: { start: 0.55, end: 0 },
        alpha: { start: 0.85, end: 0 },
        tint: 0x66ccff,
        frequency: 18,
        emitting: false,
      });
      this.worldLayer.add(engineTrail);

      const entry = {
        container,
        sprite,
        label,
        isMe,
        engineTrail,
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
        if (!isMe) label.setText(player.name);

        if (isMe) {
          this.updateStatusText(player);
        }
      });

      if (isMe) {
        // El segundo argumento de startFollow es roundPixels: con true, la
        // cámara redondea su posición a píxel entero cada frame. Con zoom
        // metido, un píxel de pantalla equivale a poca distancia real, así
        // que ese redondeo se veía como una vibración/oscilación de la
        // nave — más notable cuanto más zoom. Con false el seguimiento es
        // subpíxel y estable; WebGL interpola bien, no hace falta el
        // redondeo.
        this.cameras.main.startFollow(container, false, 0.15, 0.15);
        this.localEntry = entry;
        this.localPlayerState = player;
        this.updateStatusText(player);
      }
    });

    this.room.state.players.onRemove((_, sessionId) => {
      const entry = this.playerEntities.get(sessionId);
      if (entry) {
        entry.container.destroy();
        entry.engineTrail?.destroy();
      }
      this.playerEntities.delete(sessionId);
      if (sessionId === this.room.sessionId) {
        this.localEntry = null;
        this.localPlayerState = null;
      }
    });

    this.room.state.asteroids.onAdd((asteroid, id) => {
      const circle = this.add.circle(asteroid.x, asteroid.y, 22, 0x8a8a8a);
      circle.setStrokeStyle(1, 0xcccccc);
      this.worldLayer.add(circle);
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
    let warpPart = "";
    if (player.warpCharging) {
      warpPart = `  |  ${t("hud.warpCharging", { s: Math.ceil(player.warpChargeRemaining) })}`;
    } else if (player.warping) {
      warpPart = `  |  ${t("hud.warping")}`;
    } else if (player.warpCooldownRemaining > 0) {
      warpPart = `  |  ${t("hud.warpCooldown", { s: Math.ceil(player.warpCooldownRemaining) })}`;
    }
    ui.textContent = t("hud.shipCargoHp", {
      ship: shipPart,
      cargo: Math.floor(player.cargo),
      hp: Math.floor(player.hp),
      ping: pingPart,
    }) + warpPart;

    this.updateWarpButtonVisual(player);
  }

  // El botón de warp cambia de color según el estado real que manda el
  // servidor: verde normal, ámbar cargando, azul viajando, gris enfriando.
  updateWarpButtonVisual(player) {
    if (!this.warpButtonCircle) return;
    let color = 0x33cc66; // listo
    if (player.warping) color = 0x3399ff;
    else if (player.warpCharging) color = 0xd0a030;
    else if (player.warpCooldownRemaining > 0) color = 0x555555;
    this.warpButtonCircle.setFillStyle(color, 0.3);
    this.warpButtonCircle.setStrokeStyle(2, color, 0.8);
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
    this.playerEntities.forEach((entry) => {
      entry.container.destroy();
      entry.engineTrail?.destroy();
    });
    this.playerEntities.clear();
    this.asteroidSprites.forEach((circle) => circle.destroy());
    this.asteroidSprites.clear();
    this.localEntry = null;
    this.localPlayerState = null;
  }

  // Debe cubrir, en tiempo real transcurrido, la ventana de
  // allowReconnection del servidor (RECONNECT_GRACE_S en ChunkRoom.js,
  // hoy 90s) — no un número de intentos fijo. Con la pestaña en segundo
  // plano, setTimeout se ralentiza (throttling del navegador), así que
  // contar intentos en vez de tiempo real podía agotarse sin haber
  // pasado ni la mitad de la ventana del servidor.
  async handleUnexpectedDisconnect() {
    const token = this.room?.reconnectionToken;
    if (!token) {
      ui.textContent = t("hud.connectionLost");
      return;
    }

    if (this.reconnecting) return; // ya hay un intento en marcha
    this.reconnecting = true;
    this.reconnectDeadline = performance.now() + RECONNECT_WINDOW_MS;

    let attempt = 0;
    while (performance.now() < this.reconnectDeadline) {
      attempt += 1;
      ui.textContent = t("hud.reconnecting", { attempt, max: "…" });
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
        this.reconnecting = false;
        return;
      } catch {
        // Si la pestaña está oculta, no tiene sentido seguir reintentando
        // a ciegas (los sockets en background suelen fallar igual) — se
        // espera a que vuelva a estar visible, ver setupVisibilityRetry().
        if (document.hidden) {
          this.reconnecting = false;
          this.pendingReconnectToken = token;
          ui.textContent = t("hud.reconnectPaused");
          return;
        }
        await new Promise((resolve) => setTimeout(resolve, Math.min(1500 * attempt, 8000)));
      }
    }
    this.reconnecting = false;
    ui.textContent = t("hud.couldNotReconnect");
  }

  // Al minimizar/cambiar de pestaña, Android corta el socket casi de
  // inmediato — antes eso consumía los reintentos en segundo plano sin
  // ninguna posibilidad real de éxito. Ahora se pausa y se retoma en
  // cuanto la pestaña vuelve a primer plano, dentro de lo que quede de
  // la ventana de reconexión.
  setupVisibilityRetry() {
    document.addEventListener("visibilitychange", () => {
      if (document.hidden) return;
      if (this.pendingReconnectToken && !this.reconnecting) {
        this.pendingReconnectToken = null;
        this.handleUnexpectedDisconnect();
      }
    });
  }

  // ---- Input ----

  setupInput() {
    this.keys = this.input.keyboard.addKeys("W,A,S,D,SPACE");

    // Tecla de warp para escritorio — acción puntual, no mantenida como
    // WASD, así que va por evento de tecla en vez de leerse cada frame.
    this.input.keyboard.on("keydown-E", () => this.room?.send("warpToggle"));

    if (this.sys.game.device.input.touch) {
      this.setupMiningButton();
      this.setupWarpButton();
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

  // Coloca el emisor de la estela detrás de la nave (en el sentido
  // contrario al morro) y lo enciende/apaga según si está acelerando.
  //
  // sprite.rotation = facing + PI/2 (el arte apunta "arriba" por defecto,
  // así que se compensa con +PI/2 — ver predictLocalMovement /
  // interpolateRemotePlayers). Para volver a la dirección física real
  // ("facing") hay que DESHACER ese +PI/2 restándolo, y luego sumar PI
  // para apuntar hacia atrás: facing + PI = (sprite.rotation - PI/2) + PI
  // = sprite.rotation + PI/2. Restar PI directamente a sprite.rotation
  // (como estaba antes) deja el offset girado 90° de más — la estela
  // salía por el lateral de la nave en vez de por la cola.
  updateEngineTrailPosition(entry, isThrusting, speed = 0) {
    if (!entry.engineTrail) return;
    const back = entry.sprite.rotation + Math.PI / 2;
    const offset = 16;
    entry.engineTrail.setPosition(
      entry.container.x + Math.cos(back) * offset,
      entry.container.y + Math.sin(back) * offset
    );

    // Chorro estrecho en vez de nube: un ÁNGULO EXACTO (no un rango
    // {min,max}) actualizado cada frame según hacia dónde apunta la cola.
    // Phaser tiene un bug conocido (#6688) donde setEmitterAngle con un
    // rango en tiempo de ejecución da resultados impredecibles — con un
    // número exacto sí es fiable, y de paso sale un chorro más fino.
    entry.engineTrail.setEmitterAngle(Phaser.Math.RadToDeg(back));

    // Alarga el chorro según la velocidad real: más rápido, partículas
    // más veloces, recorren más distancia en el mismo tiempo de vida.
    // setSpeed se renombró a setParticleSpeed en Phaser 3.60+.
    const particleSpeed = Phaser.Math.Clamp(60 + speed * 0.6, 60, 900);
    entry.engineTrail.setParticleSpeed(particleSpeed);

    entry.engineTrail.emitting = isThrusting;
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
    const dt = delta / 1000;

    const isWarping = !!this.localPlayerState?.warping;

    if (isWarping) {
      if (!this.localEntry.wasWarping) {
        // Justo al entrar en warp: parte de la posición/rotación reales
        // del servidor, no de donde estuviera la predicción normal.
        this.localEntry.container.x = this.localEntry.serverX;
        this.localEntry.container.y = this.localEntry.serverY;
        this.localEntry.facing = this.localPlayerState.rotation;
      }
      this.localEntry.wasWarping = true;

      // Trayectoria determinista y conocida (línea recta a velocidad
      // fija) — el cliente la puede predecir exactamente igual que el
      // servidor, en vez de esperar cada paquete de red. Antes hacía
      // "snap" directo a la última posición recibida (~20 veces/seg),
      // que a 1200u/s se notaba como parpadeo/saltos.
      const warpSpeed = MAX_SPEED * WARP_SPEED_MULTIPLIER;
      const half = WORLD_SIZE / 2;
      this.localEntry.container.x = Phaser.Math.Clamp(
        this.localEntry.container.x + Math.cos(this.localEntry.facing) * warpSpeed * dt,
        -half,
        half
      );
      this.localEntry.container.y = Phaser.Math.Clamp(
        this.localEntry.container.y + Math.sin(this.localEntry.facing) * warpSpeed * dt,
        -half,
        half
      );
      this.localEntry.sprite.rotation = this.localEntry.facing + Math.PI / 2;
      this.updateEngineSound(true);
      this.updateEngineTrailPosition(this.localEntry, true, warpSpeed);

      // Reconciliación por si el servidor decide algo distinto (topó
      // con el borde, por ejemplo) — umbral más generoso que en vuelo
      // normal porque a esta velocidad el margen natural entre paquetes
      // ya es mayor.
      const drift = Phaser.Math.Distance.Between(
        this.localEntry.container.x,
        this.localEntry.container.y,
        this.localEntry.serverX,
        this.localEntry.serverY
      );
      if (drift > 300) {
        this.localEntry.container.x = Phaser.Math.Linear(this.localEntry.container.x, this.localEntry.serverX, 0.3);
        this.localEntry.container.y = Phaser.Math.Linear(this.localEntry.container.y, this.localEntry.serverY, 0.3);
      }
      return;
    }

    if (this.localEntry.wasWarping) {
      // Justo al salir de warp: la velocidad local predicha (vx/vy) no
      // se tocó durante el warp, así que no refleja la realidad — se
      // resetea a 0 (coincide con lo que hace el servidor al cancelar o
      // topar con el borde) y se encaja la posición exacta para no
      // arrastrar ningún desfase acumulado.
      this.localEntry.wasWarping = false;
      this.localEntry.vx = 0;
      this.localEntry.vy = 0;
      this.localEntry.container.x = this.localEntry.serverX;
      this.localEntry.container.y = this.localEntry.serverY;
      this.localEntry.facing = this.localPlayerState?.rotation ?? this.localEntry.facing;
    }

    const input = this.currentInput();
    let dx = 0;
    let dy = 0;
    if (input.up) dy -= 1;
    if (input.down) dy += 1;
    if (input.left) dx -= 1;
    if (input.right) dx += 1;
    const hasInput = dx !== 0 || dy !== 0;

    this.updateEngineSound(hasInput);

    if (this.localEntry.vx === undefined) {
      this.localEntry.vx = 0;
      this.localEntry.vy = 0;
    }
    if (this.localEntry.facing === undefined) {
      this.localEntry.facing = 0;
    }

    if (hasInput) {
      // Gira el morro hacia el rumbo deseado, limitado por TURN_RATE —
      // igual que en el servidor, no salta directo a esa dirección.
      const desiredAngle = Math.atan2(dy, dx);
      const diff = angleDiff(this.localEntry.facing, desiredAngle);
      const maxStep = TURN_RATE * dt;
      this.localEntry.facing += Math.abs(diff) <= maxStep ? diff : Math.sign(diff) * maxStep;

      // El empuje va en la dirección hacia la que la nave está orientada
      // AHORA, no hacia el rumbo deseado — de ahí la deriva al girar
      // rápido sin haber terminado de orientarse.
      this.localEntry.vx += Math.cos(this.localEntry.facing) * ACCELERATION * dt;
      this.localEntry.vy += Math.sin(this.localEntry.facing) * ACCELERATION * dt;

      const speed = Math.hypot(this.localEntry.vx, this.localEntry.vy);
      if (speed > MAX_SPEED) {
        this.localEntry.vx = (this.localEntry.vx / speed) * MAX_SPEED;
        this.localEntry.vy = (this.localEntry.vy / speed) * MAX_SPEED;
      }
    }

    const dragFactor = Math.max(0, 1 - DRAG * dt);
    this.localEntry.vx *= dragFactor;
    this.localEntry.vy *= dragFactor;

    this.updateEngineTrailPosition(this.localEntry, hasInput, Math.hypot(this.localEntry.vx, this.localEntry.vy));

    const half = WORLD_SIZE / 2;
    this.localEntry.container.x = Phaser.Math.Clamp(
      this.localEntry.container.x + this.localEntry.vx * dt,
      -half,
      half
    );
    this.localEntry.container.y = Phaser.Math.Clamp(
      this.localEntry.container.y + this.localEntry.vy * dt,
      -half,
      half
    );
    this.localEntry.sprite.rotation = this.localEntry.facing + Math.PI / 2;

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

      // No hay input de otros jugadores, así que se infiere "está
      // acelerando" (y a qué velocidad) por la distancia recorrida entre
      // los dos últimos paquetes del buffer — aproximado, pero suficiente
      // para que la estela no quede encendida con la nave parada y para
      // darle largo acorde a la velocidad real.
      const movedDist = Phaser.Math.Distance.Between(older.x, older.y, newer.x, newer.y);
      const estimatedSpeed = movedDist / (span / 1000);
      this.updateEngineTrailPosition(entry, movedDist > 2, estimatedSpeed);
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
      .setDepth(100)
      .setStrokeStyle(2, 0xff6644, 0.8)
      .setInteractive({ useHandCursor: true });
    this.hudLayer.add(circle);

    const label = this.add
      .text(x, y, t("controls.mine"), { fontSize: "12px", color: "#ffffff", resolution: this.textResolution })
      .setOrigin(0.5)
      .setDepth(101);
    this.hudLayer.add(label);

    // Margen de exclusión para que un toque cerca del botón (no exacto)
    // no dispare un joystick que lo tape visualmente. 15px era poco para
    // un pulgar real; con 40 el radio de exclusión (85px) queda por
    // encima del radio del propio joystick (60px), así que un joystick
    // que nazca justo fuera de la zona de exclusión ya no llega a
    // solaparse con el botón.
    this.miningButtonBounds = { x, y, radius: radius + 40 };

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

  // Botón verde de warp, justo a la izquierda del de minar. El estado
  // real (cargando/viajando/enfriando) lo decide el servidor — este
  // botón solo manda "warpToggle" y refleja lo que diga player.onChange.
  setupWarpButton() {
    const marginX = 70;
    const marginY = 70;
    const radius = 45;
    const gap = 110; // separación entre centros, mismo criterio que el resto de botones
    const x = this.scale.width - marginX - gap;
    const y = this.scale.height - marginY;

    const circle = this.add
      .circle(x, y, radius, 0x33cc66, 0.3)
      .setDepth(100)
      .setStrokeStyle(2, 0x33cc66, 0.8)
      .setInteractive({ useHandCursor: true });
    this.hudLayer.add(circle);

    const label = this.add
      .text(x, y, t("controls.warp"), { fontSize: "12px", color: "#ffffff", resolution: this.textResolution })
      .setOrigin(0.5)
      .setDepth(101);
    this.hudLayer.add(label);

    this.warpButtonCircle = circle;
    this.warpButtonBounds = { x, y, radius: radius + 40 };

    circle.on("pointerdown", (pointer) => {
      this.touchPurpose.set(pointer.id, "warp");
      this.room?.send("warpToggle");
    });
    const releaseWarp = (pointer) => {
      if (this.touchPurpose.get(pointer.id) === "warp") this.touchPurpose.delete(pointer.id);
    };
    circle.on("pointerup", releaseWarp);
    circle.on("pointerout", releaseWarp);
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

    const insideAnyButton = (x, y) => {
      const bounds = [this.miningButtonBounds, this.warpButtonBounds, this.gearButtonBounds];
      return bounds.some((b) => b && Phaser.Math.Distance.Between(x, y, b.x, b.y) <= b.radius);
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
      base = this.add
        .circle(x, y, maxRadius, 0x66ccff, 0.15)
        .setDepth(90)
        .setStrokeStyle(2, 0x66ccff, 0.5);
      thumb = this.add.circle(x, y, 26, 0x66ccff, 0.35).setDepth(91);
      this.hudLayer.add(base);
      this.hudLayer.add(thumb);
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
      if (insideAnyButton(pointer.x, pointer.y)) return; // lo gestiona el botón correspondiente

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
        resolution: this.textResolution,
      })
      .setOrigin(1, 0)
      .setDepth(200);
    this.hudLayer.add(this.versionText);

    // Engranaje de opciones, abajo a la derecha — encima del botón de
    // minar, no al lado, para no competir en la misma fila que
    // minar/warp.
    const gearX = this.scale.width - 70;
    const gearY = this.scale.height - 170;
    this.menuBtn = this.add
      .text(gearX, gearY, "⚙", {
        fontSize: "22px",
        color: "#cfe8ff",
        backgroundColor: "#141a24",
        padding: { x: 8, y: 6 },
        resolution: this.textResolution,
      })
      .setOrigin(0.5)
      .setDepth(200)
      .setInteractive({ useHandCursor: true });
    this.hudLayer.add(this.menuBtn);
    this.gearButtonBounds = { x: gearX, y: gearY, radius: 40 };

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
    const title = this.add
      .text(w / 2, 16, t("menu.title"), { fontSize: "14px", color: "#cfe8ff", resolution: this.textResolution })
      .setOrigin(0.5, 0);
    const version = this.add
      .text(w / 2, 38, GAME_VERSION, { fontSize: "11px", color: "#7d93b0", resolution: this.textResolution })
      .setOrigin(0.5, 0);

    const langLabel = this.add
      .text(16, 60, t("menu.language"), { fontSize: "11px", color: "#7d93b0", resolution: this.textResolution })
      .setOrigin(0, 0);

    const langButtons = AVAILABLE_LANGUAGES.map((lang, i) => {
      const isCurrent = lang.code === currentLang;
      const btn = this.add
        .text(16, 78 + i * langRowH, `${isCurrent ? "● " : "○ "}${lang.label}`, {
          fontSize: "13px",
          color: isCurrent ? "#66ccff" : "#cfe8ff",
          resolution: this.textResolution,
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
        resolution: this.textResolution,
      })
      .setOrigin(0.5)
      .setInteractive({ useHandCursor: true });
    closeBtn.on("pointerdown", () => this.closeGame());

    const dismissBtn = this.add
      .text(w - 10, 8, "✕", { fontSize: "14px", color: "#889", resolution: this.textResolution })
      .setOrigin(1, 0)
      .setInteractive({ useHandCursor: true });
    dismissBtn.on("pointerdown", () => this.toggleOptionsMenu());

    this.optionsMenu = this.add
      .container(x, y, [bg, title, version, langLabel, ...langButtons, closeBtn, dismissBtn])
      .setDepth(300);
    this.hudLayer.add(this.optionsMenu);
  }

  closeGame() {
    this.manualLeave = true;
    this.room?.leave();
    this.tweens.killAll();
    this.time.removeAllEvents();
    this.scene.pause();

    const overlay = this.add
      .rectangle(0, 0, this.scale.width, this.scale.height, 0x000000, 0.92)
      .setOrigin(0)
      .setDepth(500);
    const closedText = this.add
      .text(this.scale.width / 2, this.scale.height / 2, `${t("menu.gameClosedLine1")}\n${t("menu.gameClosedLine2")}`, {
        fontSize: "16px",
        color: "#cfe8ff",
        align: "center",
        resolution: this.textResolution,
      })
      .setOrigin(0.5)
      .setDepth(501);
    this.hudLayer.add(overlay);
    this.hudLayer.add(closedText);
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
    // Sin esto, en cualquier pantalla de alta densidad (la mayoría de
    // móviles a 2x-3x, muchos portátiles a 2x) Phaser renderiza a
    // resolución de píxeles CSS y el navegador estira el canvas para
    // llenar los píxeles físicos reales — esa ampliación es exactamente
    // lo que se veía como borroso/granulado/con velo. Con resolution
    // igual al devicePixelRatio, Phaser renderiza ya a la resolución
    // física nativa, nítido de verdad.
    resolution: window.devicePixelRatio || 1,
    backgroundColor: "#05050a",
    scene: [ChunkScene],
    input: {
      activePointers: 3, // joystick + botón de minar + un dedo extra para pellizco
    },
  });
}
