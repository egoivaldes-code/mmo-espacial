import Phaser from "phaser";
import { Client } from "colyseus.js";
import {
  supabase,
  getSession,
  ensureSession,
  LOGIN_ENABLED,
  signIn,
  signUp,
  signOut,
  setRemember,
  getRemember,
  listCharacters,
  createCharacter as createCharacterRemote,
  deleteCharacter as deleteCharacterRemote,
  MIN_PASSWORD,
} from "./cuenta.js";

// Súbela en cada release — se muestra en pantalla y sirve de referencia
// rápida para saber si el cliente cargado es el último.
const GAME_VERSION = "v0.5.9";

// En local usa ws://localhost:2567 (ver client/.env.example).
// En producción, define VITE_SERVER_URL en las variables de entorno de tu
// build (p. ej. GitHub Pages via Actions) apuntando a wss://tu-servicio.onrender.com
const SERVER_URL = import.meta.env.VITE_SERVER_URL || "ws://localhost:2567";

// Debe coincidir con las constantes homónimas del servidor
// (server/rooms/ChunkRoom.js + server/data/shipStats.js). Candidatas a
// mover a un archivo de config compartido más adelante.
//
// Física de vuelo — modelo de MASA, no números sueltos (ver 8.4.6.1 del
// diseño): giro y aceleración salen de dividir el empuje/par del motor
// (fijo por clase) entre la masa de la nave. Aquí solo hace falta el
// resultado ya calculado para el crucero del jugador (Warden,
// cruiser_01) porque es la única nave que existe hoy — si cambia algo en
// server/data/shipStats.js hay que replicarlo aquí, o la predicción
// local empieza a desincronizarse del servidor (rubber-banding visible).
const CRUISER_MASS = 698; // = HP del Warden (cruiser_01)
const CRUISER_CLASS_REFERENCE_MASS = 650; // HP medio de la clase crucero
const CRUISER_CLASS_ACCEL_AT_REF = 250; // u/s² objetivo en la masa de referencia
const CRUISER_CLASS_TURN_DEG_AT_REF = 85; // °/s objetivo en la masa de referencia
const CRUISER_THRUST = CRUISER_CLASS_REFERENCE_MASS * CRUISER_CLASS_ACCEL_AT_REF;
const CRUISER_TORQUE = CRUISER_CLASS_REFERENCE_MASS * (CRUISER_CLASS_TURN_DEG_AT_REF * Math.PI / 180);

const TURN_RATE = CRUISER_TORQUE / CRUISER_MASS; // rad/s
const ACCELERATION = CRUISER_THRUST / CRUISER_MASS; // unidades/s²
const MAX_SPEED = 242; // unidades/s — velocidad del Warden, ver ships.json
const DRAG = 0.6;
const WARP_SPEED_MULTIPLIER = 5; // debe coincidir con el servidor

// Joystick analógico (8.4.10.3): mismos umbrales que el servidor — por
// debajo de PIVOT_THRESHOLD no hay dirección, entre PIVOT y THRUST solo
// gira sin empuje, por encima el empuje entra progresivo hasta el tope.
const PIVOT_THRESHOLD = 0.12;
const THRUST_THRESHOLD = 0.45;

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

// Nave que usa todo el mundo por ahora (todavía no hay selección/crafteo
// de nave — ver roadmap). Debe coincidir con ACTIVE_SHIP_ID en
// client/public/naveteca/index.html. El sprite y el sonido salen de
// client/public/ships/ — es la MISMA carpeta que usa la naveteca, así que
// cambiar esos archivos ahí cambia lo que se ve/oye en el juego también.
// El armamento Medium (8.4.5) está calibrado para escala de crucero: probarlo
// con la lanzadera no diría nada útil, así que la nave inicial pasa a ser el
// FHI Warden. El enemigo NPC (server/rooms/ChunkRoom.js) usa el FHI Bastion.
const STARTING_SHIP_ID = "cruiser_01";
const NPC_SHIP_ID = "cruiser_04";

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

// 50% del recorrido de zoom en escala logarítmica (media geométrica) —
// el zoom se siente multiplicativo (pellizcar duplica/divide, no suma),
// así que "la mitad del recorrido" tiene que calcularse en esa escala,
// no en la lineal. Por debajo de esto, el triángulo de referencia de la
// propia nave sustituye a su sprite (ver createOwnShipIndicator).
const OWN_SHIP_INDICATOR_ZOOM_THRESHOLD = Math.sqrt(MIN_ZOOM * MAX_ZOOM);

// Referencia fuera de pantalla / demasiado lejos para leerse como sprite.
// Radios en PÍXELES DE PANTALLA (constantes, no se encogen con el zoom —
// ver updateOffscreenMarkers). Cuidado con pasarse de escala: son puntos
// de referencia, no deben competir visualmente con los sprites reales.
const OFFSCREEN_MARKER_MARGIN_PX = 36; // separación del borde real de la vista
const OFFSCREEN_SHIP_ZOOM_THRESHOLD = 0.15; // por debajo de esto, un sprite ya no se lee
const OFFSCREEN_DOT_RADIUS_PX = 4;
const OFFSCREEN_TARGET_RADIUS_PX = 6;

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

let CHOSEN_NAME = "Piloto";
let CHOSEN_CHARACTER_ID = null;

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

async function joinRoom() {
  const client = new Client(SERVER_URL);
  // Se manda el token de sesión junto al personaje elegido. El servidor
  // comprueba las dos cosas: que el token es auténtico y que ese personaje
  // pertenece a esa cuenta. Sin eso, cualquiera podría pedir jugar con el
  // piloto de otro simplemente sabiendo su identificador.
  const session = await getSession();
  return client.joinOrCreate("chunk", {
    name: CHOSEN_NAME,
    characterId: CHOSEN_CHARACTER_ID,
    accessToken: session?.access_token || null,
  });
}

// BUG REAL (v0.5.1 → v0.5.2, encontrado en producción): esta función hacía
// la unión a la sala completa — con autenticación e identidad — en cuanto
// se abría la página, antes de que el jugador hubiera elegido personaje.
// Con eso, "characterId" viajaba como null.
//
// Para alguien sin sesión guardada eso fallaba con "Sesión no válida" y
// pasaba desapercibido. Para alguien con sesión recordada (login normal,
// casilla de "mantener sesión" marcada), el token SÍ era válido — el
// servidor llegaba a comprobarlo — y fallaba más adelante, al buscar un
// personaje con id null: "Ese personaje no existe o no es tuyo". Ese
// intento fallido quedaba guardado en `roomPromise`, y `connectToServer()`
// lo REUTILIZABA en vez de intentarlo de nuevo — así que aunque el
// jugador ya hubiera elegido personaje de verdad, seguía viendo el
// rechazo de aquel primer intento, hecho antes de que existiera nada que
// comprobar.
//
// La corrección: aquí solo se despierta el servidor (una petición HTTP
// sin identidad, útil porque el plan gratuito de Render duerme el
// servicio). La unión real a la sala —la que necesita char/token— se
// hace en connectToServer(), una vez, cuando ya hay un personaje elegido.
async function startBackgroundConnection() {
  setStatus(t("intro.checkingServer"));
  await warmupServer();
  setStatus(t("intro.serverReady"));
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

// ============================================================================
// HUD de juego en HTML — botones, engranaje, panel de opciones, versión,
// pantalla de cierre. Todo lo que es interfaz pura (no "mundo del juego")
// vive aquí, no en el canvas de Phaser — el navegador ya sabe renderizar
// HTML nítido en cualquier pantalla sin configuración especial, cosa que
// Phaser no garantiza igual de bien para texto/formas dibujadas a mano.
// ============================================================================

const gameHud = document.getElementById("game-hud");
const versionBadge = document.getElementById("version-badge");
const optionsGearBtn = document.getElementById("options-gear-btn");
const warpBtn = document.getElementById("warp-btn");
const actionBtn = document.getElementById("action-btn");
const actionBtnIcon = actionBtn.querySelector(".ui-icon");
const actionBtnLabel = actionBtn.querySelector(".btn-label");
const warpBtnLabel = warpBtn.querySelector(".btn-label");

// El CSS necesita saber dónde está el atlas de iconos, pero el juego se
// publica bajo un subdirectorio (/mmo-espacial/) y esa ruta solo se
// conoce aquí. Se pasa como variable CSS y el resto de estilos la usan.
document.documentElement.style.setProperty(
  "--icons-url",
  `url(${import.meta.env.BASE_URL}ui/icons.png)`
);

// Posición de cada icono dentro de la rejilla 4x4 del atlas: [columna, fila].
// Un solo sitio donde mirar si algún día se reordena la lámina.
const ICONS = {
  warp: [0, 0], scan: [1, 0], dock: [2, 0], map: [3, 0],
  cargo: [0, 1], target: [1, 1], mine: [2, 1], weapon: [3, 1],
  ship: [0, 2], station: [1, 2], gate: [2, 2], asteroid: [3, 2],
  container: [0, 3], ruin: [1, 3], lockPending: [2, 3], lockDone: [3, 3],
};

// El mismo atlas visto como lista lineal (0..15), que es como lo indexa
// Phaser al cargarlo como hoja de sprites. Se deriva de ICONS para que no
// puedan quedar desincronizados nunca.
// --- Combate: referencias DOM ----------------------------------------------
const shieldFillEl = document.getElementById("shield-fill");
const structureFillEl = document.getElementById("structure-fill");
const capacitorFillEl = document.getElementById("capacitor-fill");
const combatButtonsEl = document.getElementById("combat-buttons");
const fireBtn = document.getElementById("fire-btn");
const autoshootCheck = document.getElementById("autoshoot-check");
const autoshootLabel = document.getElementById("autoshoot-label");
const targetPanelEl = document.getElementById("target-panel");
const targetNameEl = document.getElementById("target-name");
const targetShieldFillEl = document.getElementById("target-shield-fill");
const targetStructureFillEl = document.getElementById("target-structure-fill");

// Último estado de combate recibido del servidor. Es la fuente de verdad
// para dibujar el HUD; el cliente no calcula nada de esto por su cuenta.
let combatState = null;

function setBarWidth(el, ratio) {
  el.style.width = `${Math.max(0, Math.min(1, ratio)) * 100}%`;
}

function updateCombatHud() {
  if (!combatState) {
    combatButtonsEl.classList.add("empty");
    targetPanelEl.classList.remove("visible");
    return;
  }

  setBarWidth(capacitorFillEl, combatState.capacitor / combatState.capacitorMax);

  const activo = combatState.targets.find((t) => t.active) || null;
  const bloqueado = Boolean(activo?.locked);

  // El botón de disparo (15.4.1) solo existe con objetivo fijado Y
  // bloqueado. Sin eso no hay a qué disparar, así que no ocupa sitio.
  combatButtonsEl.classList.toggle("empty", !bloqueado);
  if (bloqueado) {
    fireBtn.classList.toggle("active", combatState.firing);
    fireBtn.classList.toggle("no-energy", combatState.capacitor < 18);
  }
  autoshootCheck.checked = combatState.autoShoot;
}

// El servidor manda escudo/estructura del objetivo dentro de los mensajes
// de disparo (shot/hit); este panel se rellena con lo último que se sepa,
// no con una réplica completa por tick.
const targetInfo = { kind: null, id: null, name: "", shield: 1, structure: 1 };

function refreshTargetPanel() {
  const activo = combatState?.targets.find((t) => t.active && t.locked);
  if (!activo) {
    targetPanelEl.classList.remove("visible");
    return;
  }
  targetPanelEl.classList.add("visible");
  targetNameEl.textContent = targetInfo.name || t("combat.target");
  setBarWidth(targetShieldFillEl, targetInfo.shield);
  setBarWidth(targetStructureFillEl, targetInfo.structure);
}

// Máximos de crucero, en espejo con server/rooms/ChunkRoom.js. Solo sirven
// para dibujar barras: el número real de vida SÍ lo manda el servidor
// (player.shield / player.structure), esto únicamente da la escala 0..1.
const CRUISER_SHIELD_MAX = 420;
const CRUISER_STRUCTURE_MAX = 698;

const ICON_FRAMES = Object.fromEntries(
  Object.entries(ICONS).map(([name, [col, row]]) => [name, row * 4 + col])
);

// Devuelve el HTML de un dato del HUD precedido por su icono. El icono se
// pinta con la misma máscara que los botones, a la altura del texto.
function statChip(icon, value) {
  const pos = ICONS[icon];
  return (
    `<span class="hud-stat">` +
    `<i class="ui-icon" style="--ix:${pos[0]}; --iy:${pos[1]};"></i>` +
    `${escapeHtml(String(value))}</span>`
  );
}

function applyIcon(el, name) {
  const pos = ICONS[name];
  if (!pos) return;
  el.style.setProperty("--ix", pos[0]);
  el.style.setProperty("--iy", pos[1]);
}

// Qué icono y qué texto corresponden a cada tipo de acción contextual.
// Añadir una acción nueva es añadir una línea aquí y otra en el servidor.
const ACTION_ICONS = { mine: "mine", dock: "dock", gate: "gate", loot: "container" };
const optionsPanel = document.getElementById("options-panel");
const optionsCloseDismiss = document.getElementById("options-close-dismiss");
const optionsTitleEl = document.getElementById("options-title");
const optionsVersionEl = document.getElementById("options-version");
const optionsLangLabelEl = document.getElementById("options-lang-label");
const langOptionsEl = document.getElementById("lang-options");
const closeGameBtn = document.getElementById("close-game-btn");
const gameClosedOverlay = document.getElementById("game-closed-overlay");
const autotargetBackCheck = document.getElementById("autotarget-back-check");
const autotargetBackLabel = document.getElementById("autotarget-back-label");

// --- Fijar automáticamente a quien me ataque -------------------------------
// Preferencia del jugador, por defecto activada. Se guarda en localStorage
// (no en Supabase — es un ajuste de cliente, no progreso de personaje) para
// que sobreviva a recargar la página, y se manda al servidor porque es
// SERVIDOR quien decide fijar el objetivo (mismo principio que 15.5: el
// cliente no puede simplemente "fingir" un fijado sin pasar por lock real).
const AUTOTARGET_BACK_KEY = "spacemmo_autotarget_back";

function getAutoTargetBackPref() {
  const stored = localStorage.getItem(AUTOTARGET_BACK_KEY);
  return stored === null ? true : stored === "1"; // por defecto activado
}

function setAutoTargetBackPref(value) {
  localStorage.setItem(AUTOTARGET_BACK_KEY, value ? "1" : "0");
}

autotargetBackCheck.checked = getAutoTargetBackPref();

autotargetBackCheck.addEventListener("change", () => {
  setAutoTargetBackPref(autotargetBackCheck.checked);
  getActiveScene()?.room?.send("setAutoTargetBack", autotargetBackCheck.checked);
});

// La escena activa de Phaser expone `room` y `touchInput` — los botones
// HTML necesitan llegar hasta ahí para mandar mensajes / marcar minado
// continuo, sin acoplarse a los internos del resto del juego.
function getActiveScene() {
  return gameInstance?.scene?.getScene("chunk") || null;
}

versionBadge.textContent = GAME_VERSION;

// --- Botón de acción contextual -------------------------------------------
// Es un único botón cuyo significado lo dicta el servidor: minar, atracar,
// activar un punto de salto o abrir un pecio, según lo que haya a rango.
// El cliente NO decide nada, solo dibuja lo que le dicen y avisa de que se
// ha pulsado.
//
// Hay dos formas de pulsarlo. Minar es "mantener pulsado" (sueltas y para);
// atracar o saltar son de un toque. El servidor lo indica con `hold`.
let currentAction = null;

function setContextAction(action) {
  currentAction = action;
  if (!action) {
    actionBtn.classList.add("empty");
    stopHoldAction();
    return;
  }
  actionBtn.classList.remove("empty", "kind-dock", "kind-gate", "kind-loot");
  if (action.kind !== "mine") actionBtn.classList.add(`kind-${action.kind}`);
  applyIcon(actionBtnIcon, ACTION_ICONS[action.kind] || "target");
  actionBtnLabel.textContent = t(`controls.action.${action.kind}`);
}

function stopHoldAction() {
  const scene = getActiveScene();
  if (scene) scene.touchInput.mining = false;
}

// --- Botones de disparo y autodisparo --------------------------------------
fireBtn.addEventListener("pointerdown", (e) => {
  e.preventDefault();
  getActiveScene()?.room?.send("fireToggle", !combatState?.firing);
});

autoshootCheck.addEventListener("change", () => {
  getActiveScene()?.room?.send("autoShoot", autoshootCheck.checked);
});

actionBtn.addEventListener("pointerdown", (e) => {
  e.preventDefault();
  const scene = getActiveScene();
  if (!scene || !currentAction) return;
  if (currentAction.hold) {
    scene.touchInput.mining = true;
  } else {
    scene.room?.send("action", { kind: currentAction.kind, id: currentAction.id });
  }
});
actionBtn.addEventListener("pointerup", stopHoldAction);
actionBtn.addEventListener("pointerleave", stopHoldAction);
actionBtn.addEventListener("pointercancel", stopHoldAction);

warpBtn.addEventListener("click", () => {
  getActiveScene()?.room?.send("warpToggle");
});

function renderLangOptions() {
  langOptionsEl.innerHTML = "";
  AVAILABLE_LANGUAGES.forEach((lang) => {
    const isCurrent = lang.code === currentLang;
    const btn = document.createElement("button");
    btn.className = "lang-option" + (isCurrent ? " current" : "");
    btn.textContent = `${isCurrent ? "● " : "○ "}${lang.label}`;
    btn.addEventListener("click", () => setLanguage(lang.code));
    langOptionsEl.appendChild(btn);
  });
}

function toggleOptionsPanel() {
  optionsPanel.style.display = optionsPanel.style.display === "flex" ? "none" : "flex";
}
optionsGearBtn.addEventListener("click", toggleOptionsPanel);
optionsCloseDismiss.addEventListener("click", toggleOptionsPanel);

closeGameBtn.addEventListener("click", () => {
  getActiveScene()?.closeGame();
});

// Refleja en el botón de warp el estado real que manda el servidor —
// listo/cargando/viajando/enfriando — con solo cambiar una clase CSS.
function updateWarpButtonVisual(player) {
  warpBtn.classList.remove("charging", "warping", "cooldown");
  if (player.warping) warpBtn.classList.add("warping");
  else if (player.warpCharging) warpBtn.classList.add("charging");
  else if (player.warpCooldownRemaining > 0) warpBtn.classList.add("cooldown");
}

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

introContinueBtn.addEventListener("click", async () => {
  introScreen.style.display = "none";
  await routeAfterIntro();
});

// ============================================================================
// Pantalla de identificación (enlace mágico)
//
// El jugador escribe su correo, recibe un enlace y al pulsarlo vuelve aquí
// ya identificado. No hay contraseñas: nada que recordar, nada que se pueda
// filtrar, y una cuenta perdida se recupera solo con acceso al correo.
// ============================================================================

const loginScreen = document.getElementById("login-screen");
const loginEmailInput = document.getElementById("login-email-input");
const loginPasswordInput = document.getElementById("login-password-input");
const loginRememberCheck = document.getElementById("login-remember");
const loginSigninBtn = document.getElementById("login-signin-btn");
const loginSignupBtn = document.getElementById("login-signup-btn");
const loginStatusEl = document.getElementById("login-status");
const charSignoutBtn = document.getElementById("char-signout-btn");

loginRememberCheck.checked = getRemember();

// Cerrar sesión solo se ofrece si hay una sesión que cerrar tenga sentido.
// Con el login dormido la cuenta es anónima: cerrarla no te devuelve a
// ninguna pantalla útil, te borra el acceso a tus propios personajes.
if (!LOGIN_ENABLED) charSignoutBtn.style.display = "none";

// Decide qué pantalla toca al terminar la intro: si ya hay sesión guardada,
// directo a los pilotos sin pedir nada.
async function routeAfterIntro() {
  // Con el login dormido esto crea una cuenta anónima al vuelo y entra
  // directo. Si algo impide crearla, cae en la pantalla de login en vez de
  // dejar al jugador mirando una pantalla muerta.
  const session = await ensureSession();
  if (session) {
    loginScreen.style.display = "none";
    await showCharacterScreen();
  } else {
    loginScreen.style.display = "flex";
    loginEmailInput.focus();
  }
}

function setLoginBusy(busy) {
  loginSigninBtn.disabled = busy;
  loginSignupBtn.disabled = busy;
}

// Validación antes de molestar al servidor: si falta algo o la contraseña es
// demasiado corta, se dice aquí mismo en lugar de esperar un viaje de ida y
// vuelta para recibir un error en inglés.
function datosLoginValidos() {
  const email = loginEmailInput.value.trim();
  const password = loginPasswordInput.value;
  if (!email.includes("@") || email.length < 5) {
    loginStatusEl.textContent = t("login.invalidEmail");
    return null;
  }
  if (password.length < MIN_PASSWORD) {
    loginStatusEl.textContent = t("login.passwordShort", { min: MIN_PASSWORD });
    return null;
  }
  return { email, password };
}

// Los dos botones hacen lo mismo salvo la operación concreta, así que
// comparten el envoltorio: bloquear, avisar, traducir el error, desbloquear.
async function ejecutarAcceso(accion, statusKey) {
  const datos = datosLoginValidos();
  if (!datos) return;

  setRemember(loginRememberCheck.checked);
  setLoginBusy(true);
  loginStatusEl.textContent = t(statusKey);

  try {
    await accion(datos.email, datos.password);
    loginPasswordInput.value = "";
    loginStatusEl.textContent = "";
    loginScreen.style.display = "none";
    await showCharacterScreen();
  } catch (err) {
    // err.message trae uno de los códigos propios de cuenta.js.
    const clave = `login.err.${err.message}`;
    const texto = t(clave);
    loginStatusEl.textContent = texto === clave ? t("login.err.DESCONOCIDO") : texto;
    setLoginBusy(false);
  }
}

loginSigninBtn.addEventListener("click", () => ejecutarAcceso(signIn, "login.signingIn"));
loginSignupBtn.addEventListener("click", () => ejecutarAcceso(signUp, "login.creating"));

// Enter desde cualquiera de los dos campos entra (no crea cuenta): crear una
// cuenta sin querer por pulsar Enter sería un mal accidente.
[loginEmailInput, loginPasswordInput].forEach((el) => {
  el.addEventListener("keydown", (e) => {
    if (e.key === "Enter") loginSigninBtn.click();
  });
});

charSignoutBtn.addEventListener("click", async () => {
  await signOut();
  cachedCharacters = [];
  characterScreen.style.display = "none";
  setLoginBusy(false);
  loginStatusEl.textContent = "";
  loginPasswordInput.value = "";
  loginScreen.style.display = "flex";
});

// ============================================================================
// Pantalla 2: selección/creación de personaje (máx. 5, guardado local)
//
// Los personajes están ligados a la CUENTA, no al navegador: entras con tu
// correo desde cualquier dispositivo y ahí están. El límite de 5 lo impone
// la propia base de datos, no este código (ver sección 7 del documento de
// diseño).
// ============================================================================

// Los personajes ya no viven en este navegador: viven en la cuenta. Esta
// lista es solo una copia en memoria de lo último que devolvió el servidor,
// para no pedirla de nuevo cada vez que se redibuja la pantalla.
let cachedCharacters = [];

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

async function showCharacterScreen() {
  characterScreen.style.display = "flex";
  charListEl.innerHTML = "";
  charStatusEl.textContent = t("character.loading");
  try {
    cachedCharacters = await listCharacters();
    charStatusEl.textContent = "";
  } catch {
    charStatusEl.textContent = t("character.loadError");
    return;
  }
  renderCharacterScreen();
}

function renderCharacterScreen() {
  charListEl.innerHTML = "";

  cachedCharacters.forEach((char) => {
    const row = document.createElement("div");
    row.className = "char-row";

    const btn = document.createElement("button");
    btn.className = "char-item";
    const dateStr = new Date(char.created_at).toLocaleDateString(localeForLang(currentLang));
    btn.innerHTML = `${escapeHtml(char.name)}<div class="char-meta">${escapeHtml(t("character.createdOn", { date: dateStr }))}</div>`;
    btn.addEventListener("click", () => selectCharacter(char));

    // Borrar es irreversible y el botón está justo al lado de "jugar", así
    // que pide confirmación escribiendo el nombre no — pero sí una
    // confirmación explícita. En un móvil los dedos resbalan.
    const del = document.createElement("button");
    del.className = "char-delete-btn";
    del.textContent = "×";
    del.title = t("character.delete");
    del.addEventListener("click", async (e) => {
      e.stopPropagation();
      if (!confirm(t("character.deleteConfirm", { name: char.name }))) return;
      charStatusEl.textContent = t("character.deleting");
      try {
        await deleteCharacterRemote(char.id);
        cachedCharacters = cachedCharacters.filter((c) => c.id !== char.id);
        charStatusEl.textContent = "";
        renderCharacterScreen();
      } catch {
        charStatusEl.textContent = t("character.deleteError");
      }
    });

    row.appendChild(btn);
    row.appendChild(del);
    charListEl.appendChild(row);
  });

  const atLimit = cachedCharacters.length >= MAX_CHARACTERS;
  charLimitMsg.style.display = atLimit ? "block" : "none";

  const showCreateFormDirectly = cachedCharacters.length === 0 && !atLimit;
  charCreateEl.style.display = showCreateFormDirectly ? "block" : "none";
  charCreateToggleBtn.style.display = atLimit || showCreateFormDirectly ? "none" : "block";
}

charCreateToggleBtn.addEventListener("click", () => {
  charCreateEl.style.display = "block";
  charCreateToggleBtn.style.display = "none";
  charNameInput.focus();
});

async function createCharacter() {
  if (cachedCharacters.length >= MAX_CHARACTERS) return;

  const typed = charNameInput.value.trim();
  const name = typed
    ? typed.slice(0, 16)
    : t("character.defaultName", { n: cachedCharacters.length + 1 });

  if (name.length < 3) {
    charStatusEl.textContent = t("character.nameTooShort");
    return;
  }

  charCreateBtn.disabled = true;
  charStatusEl.textContent = t("character.creating");
  try {
    const character = await createCharacterRemote(name);
    cachedCharacters.push(character);
    charStatusEl.textContent = "";
    selectCharacter(character);
  } catch (err) {
    // El nombre es único en TODO el juego, así que este error es frecuente
    // y merece un mensaje claro en vez de un fallo genérico.
    if (err.message === "NOMBRE_OCUPADO") {
      charStatusEl.textContent = t("character.nameTaken");
    } else if (err.message === "LIMITE") {
      charStatusEl.textContent = t("character.limitReached");
    } else {
      charStatusEl.textContent = t("character.createError");
    }
  } finally {
    charCreateBtn.disabled = false;
  }
}

charCreateBtn.addEventListener("click", createCharacter);
charNameInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") createCharacter();
});

function selectCharacter(character) {
  CHOSEN_NAME = character.name;
  CHOSEN_CHARACTER_ID = character.id;
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
  document.getElementById("login-title").textContent = t("login.title");
  loginEmailInput.placeholder = t("login.emailPlaceholder");
  loginPasswordInput.placeholder = t("login.passwordPlaceholder");
  document.getElementById("login-remember-label").textContent = t("login.remember");
  loginSigninBtn.textContent = t("login.signInButton");
  loginSignupBtn.textContent = t("login.signUpButton");
  charSignoutBtn.textContent = t("login.signOut");

  warpBtnLabel.textContent = t("controls.warp");
  autoshootLabel.textContent = t("combat.auto");
  if (currentAction) actionBtnLabel.textContent = t(`controls.action.${currentAction.kind}`);
  optionsTitleEl.textContent = t("menu.title");
  optionsVersionEl.textContent = GAME_VERSION;
  optionsLangLabelEl.textContent = t("menu.language");
  autotargetBackLabel.textContent = t("menu.autoTargetBack");
  closeGameBtn.textContent = t("menu.closeGame");
  renderLangOptions();
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
    this.touchInput = { angle: null, magnitude: 0, mining: false };
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

  // Retícula del objetivo de la acción contextual. Se crea una sola vez y
  // se reutiliza moviéndola y ocultándola: crear y destruir un sprite cada
  // vez que pasas cerca de un asteroide genera basura de memoria que en
  // móvil se nota como tironcillos.
  showActionReticle(action) {
    if (!this.actionReticle) {
      this.actionReticle = this.add.image(0, 0, "ui-icons", ICON_FRAMES.lockDone);
      this.actionReticle.setDisplaySize(90, 90);
      this.actionReticle.setTint(0xffb066);
      this.actionReticle.setVisible(false);
      this.worldLayer?.add(this.actionReticle);
    }
    if (!action) {
      this.actionReticle.setVisible(false);
      this.actionReticleTarget = null;
      return;
    }
    this.actionReticleTarget = action;
    this.actionReticle.setPosition(action.x, action.y);
    this.actionReticle.setVisible(true);
  }

  // La retícula gira despacio sobre sí misma. Es un detalle mínimo, pero
  // en una pantalla llena de cosas quietas el movimiento lento es lo que
  // hace que el ojo la encuentre sin buscarla.
  updateActionReticle(deltaMs) {
    if (!this.actionReticle?.visible) return;
    this.actionReticle.rotation += (deltaMs / 1000) * 0.6;
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

    // El mismo atlas de iconos que usa el HUD en HTML, cargado también
    // como hoja de sprites para lo que se dibuja DENTRO del mundo
    // (asteroides, retículas, futuros marcadores de estación y pecio).
    // El navegador lo descarga una sola vez y lo reutiliza en los dos
    // sitios; en el mundo se tiñe por código igual que en el HUD.
    this.load.spritesheet("ui-icons", `${import.meta.env.BASE_URL}ui/icons.png`, {
      frameWidth: 256,
      frameHeight: 256,
    });

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

    // Sprite del NPC enemigo. Sin sonido: no hay una nave propia que
    // escuchar, así que no se carga el audio del Bastion.
    this.load.image(`ship-${NPC_SHIP_ID}`, `${base}sprites/${NPC_SHIP_ID}.png`);
  }

  async create() {
    this.cameras.main.setBackgroundColor("#05050a");
    this.cameras.main.setZoom(DEFAULT_ZOOM);

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
    this.createOwnShipIndicator();
    this.setupInput();
    this.setupZoom();
    gameHud.style.display = "block"; // el HUD (versión, engranaje, botones) es HTML normal
    this.setupVisibilityRetry();

    await this.connectToServer();
  }

  // Triángulo de referencia para la PROPIA nave cuando el zoom está muy
  // alejado. La cámara siempre sigue a la nave propia, así que nunca está
  // "fuera de pantalla" — pero su sprite sí se vuelve ilegible con zoom
  // out extremo, igual que le pasa a las demás naves (ver
  // updateOffscreenMarkers). Un punto no serviría aquí porque no dice
  // hacia dónde miras; un triángulo sí, y es lo único que de verdad hace
  // falta saber de un vistazo cuando estás muy alejado.
  //
  // Vive en hudLayer (cámara de HUD, zoom fijo a 1) y no en worldLayer:
  // así su tamaño en pantalla es SIEMPRE el mismo, sin tener que
  // contrarrestar el zoom a mano como con las estrellas. Se coloca en el
  // centro exacto de la pantalla — la cámara seguidora deja la nave ahí
  // con un pelín de retraso por el suavizado (startFollow con lerp
  // 0.15), pero el indicador se ancla al centro real, no a la posición
  // de la nave en pantalla, precisamente para que quede SIEMPRE bien
  // centrado y no se note ese suavizado.
  createOwnShipIndicator() {
    // Apunta "hacia arriba" en reposo (ápice arriba, base abajo) — misma
    // convención que el sprite de la nave, que también parte apuntando
    // hacia arriba y se corrige con +90° (ver predictLocalMovement).
    this.ownShipIndicator = this.add
      .triangle(this.scale.width / 2, this.scale.height / 2, 0, -10, -7, 8, 7, 8, 0xffffff, 0.95)
      .setStrokeStyle(1, 0xffffff, 1)
      .setDepth(85)
      .setVisible(false);
    this.hudLayer.add(this.ownShipIndicator);
  }

  // Umbral en el que el triángulo sustituye al sprite real: la media
  // geométrica de MIN_ZOOM y MAX_ZOOM, es decir, el 50% del recorrido de
  // zoom en escala logarítmica (que es como se siente el zoom de
  // verdad — multiplicativo, no lineal). Por debajo (más alejado que la
  // mitad del recorrido) aparece; por encima (más cerca que la mitad)
  // desaparece. Un único umbral basta para las dos direcciones.
  updateOwnShipIndicator() {
    if (!this.ownShipIndicator) return;
    const show = Boolean(this.localEntry) && this.cameras.main.zoom < OWN_SHIP_INDICATOR_ZOOM_THRESHOLD;
    this.ownShipIndicator.setVisible(show);
    if (show) this.ownShipIndicator.rotation = this.localEntry.facing + Math.PI / 2;
  }

  starfield() {
    // Rango ajustado a WORLD_SIZE=30.000 y al nuevo MIN_ZOOM=0.025 — el
    // campo de estrellas tiene que cubrir más que el propio mundo
    // jugable para no dejar un vacío negro alrededor al ver el sistema
    // entero con el zoom mínimo.
    //
    // Las estrellas viven en worldLayer (para el parallax de
    // scrollFactor) pero su TAMAÑO en pantalla no debe depender del
    // zoom — son "el fondo del universo", no objetos del mundo: con
    // zoom out extremo (0.025) un radio de 1-2px se volvía invisible, y
    // con zoom in (2.5) se veían como manchas grandes. Se guardan en
    // this.stars para contrarrestar el zoom cada frame en update()
    // (mismo truco que los marcadores fuera de pantalla:
    // setScale(1/zoom) en vez de dejar que el mundo las escale).
    this.stars = [];
    for (let i = 0; i < 900; i++) {
      const x = Phaser.Math.Between(-22000, 22000);
      const y = Phaser.Math.Between(-22000, 22000);
      const star = this.add.circle(x, y, Phaser.Math.Between(1, 2), 0xffffff, Phaser.Math.FloatBetween(0.3, 0.9));
      star.setScrollFactor(0.6);
      this.worldLayer.add(star);
      this.stars.push(star);
    }
    this.lastStarZoom = null;
  }

  // Contrarresta el zoom de la cámara en las estrellas, para que su
  // tamaño en pantalla se mantenga constante. Solo se toca cuando el
  // zoom cambió de verdad desde el último frame — con 900 estrellas no
  // hace falta reescribir su escala 60 veces por segundo si nadie está
  // haciendo zoom en ese instante.
  updateStarfieldScale() {
    const zoom = this.cameras.main.zoom;
    if (zoom === this.lastStarZoom) return;
    this.lastStarZoom = zoom;
    const inv = 1 / zoom;
    for (const star of this.stars) star.setScale(inv);
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
      // Únion real, con el personaje YA elegido. Se hace siempre aquí y no
      // se reutiliza ningún intento anterior (ver el comentario en
      // startBackgroundConnection): un intento hecho antes de conocer
      // characterId no sirve, por muy "ya en marcha" que estuviera.
      this.room = await joinRoom();
    } catch (err) {
      ui.textContent = t("hud.connectionError", { error: err.message });
      return;
    }

    this.room.send("setName", CHOSEN_NAME);
    this.room.send("setAutoTargetBack", getAutoTargetBackPref());
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
        .text(0, 22, isMe ? "" : player.name, { fontSize: "10px", color: "#cfe8ff" })
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
          setBarWidth(shieldFillEl, player.shield / CRUISER_SHIELD_MAX);
          setBarWidth(structureFillEl, player.structure / CRUISER_STRUCTURE_MAX);
          structureFillEl.classList.toggle("critical", player.shield <= 0);
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

    this.npcEntities = new Map();
    this.room.state.npcs.onAdd((npc, id) => {
      const sprite = this.add.image(0, 0, `ship-${npc.shipId}`).setScale(0.5);
      sprite.setTint(0xff8866);
      // Tocable para fijar objetivo (ver el manejador de pointerdown más
      // abajo). El radio de toque es generoso a propósito: en un móvil
      // acertar justo sobre el sprite es difícil mientras la nave se mueve.
      sprite.setInteractive(
        new Phaser.Geom.Circle(sprite.width / 2, sprite.height / 2, Math.max(sprite.width, sprite.height) * 0.9),
        Phaser.Geom.Circle.Contains
      );
      sprite.combatTarget = { kind: "npc", id };
      const label = this.add
        .text(0, 22, npc.name, { fontSize: "10px", color: "#ffb8a0" })
        .setOrigin(0.5, 0);
      const container = this.add.container(npc.x, npc.y, [sprite, label]);
      this.worldLayer.add(container);
      this.npcEntities.set(id, { container, sprite, serverX: npc.x, serverY: npc.y, rotation: npc.rotation });

      npc.onChange(() => {
        const entry = this.npcEntities.get(id);
        if (!entry) return;
        entry.serverX = npc.x;
        entry.serverY = npc.y;
        entry.rotation = npc.rotation;
        if (targetInfo.kind === "npc" && targetInfo.id === id) {
          targetInfo.shield = npc.shield / 380;
          targetInfo.structure = npc.structure / 632;
          refreshTargetPanel();
        }
      });
    });
    this.room.state.npcs.onRemove((npc, id) => {
      const entry = this.npcEntities.get(id);
      if (!entry) return;
      entry.container.destroy();
      this.npcEntities.delete(id);
      if (targetInfo.kind === "npc" && targetInfo.id === id) {
        targetInfo.kind = null;
        targetInfo.id = null;
        refreshTargetPanel();
      }
    });

    this.room.state.asteroids.onAdd((asteroid, id) => {
      // Antes era un círculo gris dibujado a mano. Ahora usa el icono de
      // asteroide del atlas (frame 11), teñido de gris piedra: se lee como
      // una roca irregular y no como una pelota.
      const circle = this.add.image(asteroid.x, asteroid.y, "ui-icons", ICON_FRAMES.asteroid);
      circle.setDisplaySize(56, 56);
      circle.setTint(0x9aa4ad);
      this.worldLayer.add(circle);
      this.asteroidSprites.set(id, circle);
    });

    this.room.state.asteroids.onRemove((_, id) => {
      const circle = this.asteroidSprites.get(id);
      if (circle) circle.destroy();
      this.asteroidSprites.delete(id);
    });

    // El servidor avisa (solo a este cliente, y solo cuando cambia) de qué
    // tiene a rango. El HUD cambia el botón y en el mundo se dibuja una
    // retícula sobre el objeto elegido, para que quede claro sobre QUÉ va
    // a actuar el botón cuando hay varias cosas cerca.
    this.room.onMessage("action", (action) => {
      setContextAction(action);
      this.showActionReticle(action);
    });

    // Estado de combate: capacitor, objetivos, si se está disparando. Mensaje
    // privado, solo a este cliente, solo cuando cambia (8.4.8).
    this.room.onMessage("combat", (msg) => {
      combatState = msg;
      updateCombatHud();
      refreshTargetPanel();
    });

    // Resultado de CADA disparo propio. Se enseñan los factores por
    // separado para que el jugador entienda por qué el disparo fue flojo
    // y aprenda a colocarse, en vez de ver solo un número (8.4.10).
    this.room.onMessage("shot", (msg) => {
      if (msg.kind === targetInfo.kind && msg.id === targetInfo.id) {
        // No se conoce el máximo de vida del objetivo en el cliente, así
        // que se aproxima por la última barra conocida menos el daño
        // proporcional. Es una estimación visual, no un dato exacto.
        targetInfo.structure = Math.max(0, targetInfo.structure - msg.damage / 700);
        refreshTargetPanel();
      }
      this.showDamageNumber(msg);
    });

    // Golpe recibido de un NPC. Actualiza las barras propias sin esperar al
    // próximo latido de posición.
    this.room.onMessage("hit", (msg) => {
      // shieldFillEl y structureFillEl se refrescan solos vía onChange del
      // estado del jugador (más abajo), esto solo dispara el parpadeo rojo.
      this.flashDamage();
    });

    this.room.onMessage("destroyed", () => {
      combatState = null;
      updateCombatHud();
    });

    this.room.onMessage("respawned", () => {});

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
    // Carga y casco se muestran con icono en vez de con la palabra
    // ("Carga:", "HP:"). Ocupan menos en una pantalla de móvil, se leen de
    // un vistazo sin tener que procesar texto, y no hay que traducirlos.
    ui.innerHTML =
      escapeHtml(shipPart) +
      statChip("cargo", Math.floor(player.cargo)) +
      statChip("ship", Math.floor(player.hp)) +
      escapeHtml(pingPart + warpPart);

    updateWarpButtonVisual(player);
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
    this.actionReticle?.destroy();
    this.actionReticle = null;
    setContextAction(null);
    this.npcEntities?.forEach((e) => e.container.destroy());
    this.npcEntities?.clear();
    this.targetReticles?.forEach((r) => r.destroy());
    this.targetReticles?.clear();
    this.offscreenMarkers?.forEach((d) => d.destroy());
    this.offscreenMarkers?.clear();
    combatState = null;
    targetInfo.kind = null;
    targetInfo.id = null;
    updateCombatHud();
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
    // Teclado: 8 direcciones con magnitud fija a tope (no es analógico,
    // así que empuja siempre al máximo si hay alguna tecla). El táctil
    // manda si está activo, porque ese sí es analógico de verdad — ver
    // setupTouchMovementAndZoom.
    let kbDx = 0;
    let kbDy = 0;
    if (this.keys.W.isDown) kbDy -= 1;
    if (this.keys.S.isDown) kbDy += 1;
    if (this.keys.A.isDown) kbDx -= 1;
    if (this.keys.D.isDown) kbDx += 1;
    const kbActive = kbDx !== 0 || kbDy !== 0;

    const touchActive = this.touchInput.angle !== null && this.touchInput.magnitude > 0;

    let angle = null;
    let magnitude = 0;
    if (touchActive) {
      angle = this.touchInput.angle;
      magnitude = this.touchInput.magnitude;
    } else if (kbActive) {
      angle = Math.atan2(kbDy, kbDx);
      magnitude = 1;
    }

    return {
      angle,
      magnitude,
      mining: this.keys.SPACE.isDown || this.touchInput.mining,
    };
  }

  update(time, delta) {
    if (!this.room) return;
    this.predictLocalMovement(delta);
    this.interpolateRemotePlayers();
    this.interpolateNpcs();
    this.updateActionReticle(delta);
    this.updateTargetReticles();
    this.updateOffscreenMarkers();
    this.updateStarfieldScale();
    this.updateOwnShipIndicator();
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
    const isCruising = !!this.localPlayerState?.cruising;
    const hasDirection = !isCruising && input.angle !== null && input.magnitude > PIVOT_THRESHOLD;

    // El sonido de motor y la estela reflejan EMPUJE real, no solo
    // "hay dirección" — con el joystick a media asta (solo pivotando) el
    // motor no debería sonar como si estuviera acelerando.
    const isThrusting = hasDirection && input.magnitude > THRUST_THRESHOLD;
    this.updateEngineSound(isThrusting);

    if (this.localEntry.vx === undefined) {
      this.localEntry.vx = 0;
      this.localEntry.vy = 0;
    }
    if (this.localEntry.facing === undefined) {
      this.localEntry.facing = 0;
    }

    if (!isCruising) {
      if (hasDirection) {
        // Gira siempre a velocidad angular completa hacia el rumbo
        // deseado — igual que el servidor, un toque suave ya apunta la
        // nave aunque no empuje todavía.
        const diff = angleDiff(this.localEntry.facing, input.angle);
        const maxStep = TURN_RATE * dt;
        this.localEntry.facing += Math.abs(diff) <= maxStep ? diff : Math.sign(diff) * maxStep;

        if (isThrusting) {
          // Empuje progresivo: 0 justo en el umbral, 100% con el
          // joystick a tope — igual que el servidor, no es todo o nada.
          const thrustFactor = (input.magnitude - THRUST_THRESHOLD) / (1 - THRUST_THRESHOLD);
          const accel = ACCELERATION * thrustFactor;
          this.localEntry.vx += Math.cos(this.localEntry.facing) * accel * dt;
          this.localEntry.vy += Math.sin(this.localEntry.facing) * accel * dt;

          const speed = Math.hypot(this.localEntry.vx, this.localEntry.vy);
          if (speed > MAX_SPEED) {
            this.localEntry.vx = (this.localEntry.vx / speed) * MAX_SPEED;
            this.localEntry.vy = (this.localEntry.vy / speed) * MAX_SPEED;
          }
        }
      }

      const dragFactor = Math.max(0, 1 - DRAG * dt);
      this.localEntry.vx *= dragFactor;
      this.localEntry.vy *= dragFactor;
    }
    // En crucero: vx/vy se dejan tal cual están (sin fricción, sin
    // empuje) — la nave sigue viajando sola, igual que en el servidor.

    this.updateEngineTrailPosition(this.localEntry, isThrusting, Math.hypot(this.localEntry.vx, this.localEntry.vy));

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

  // Los NPC no necesitan el búfer de interpolación completo de los
  // jugadores: el servidor ya los mueve cada tick (no solo al pensar, ver
  // updateNpcs), así que un suavizado simple hacia la última posición
  // conocida es indistinguible y mucho más barato de mantener.
  // Número de daño flotante sobre el objetivo. Puramente cosmético — el
  // servidor ya aplicó el daño real, esto es feedback visual del disparo.
  showDamageNumber(msg) {
    let x, y;
    if (msg.kind === "npc") {
      const c = this.npcEntities?.get(msg.id)?.container;
      if (!c) return;
      x = c.x; y = c.y;
    } else {
      const c = this.playerEntities?.get(msg.id)?.container;
      if (!c) return;
      x = c.x; y = c.y;
    }
    const texto = this.add
      .text(x, y - 30, `-${msg.damage}`, {
        fontSize: "16px",
        color: msg.quality >= 70 ? "#ff5555" : "#ffaa55",
        fontStyle: "bold",
      })
      .setOrigin(0.5);
    this.worldLayer?.add(texto);
    this.tweens.add({
      targets: texto,
      y: y - 70,
      alpha: 0,
      duration: 900,
      onComplete: () => texto.destroy(),
    });
  }

  // Parpadeo rojo de pantalla al recibir daño. Breve y sutil: es un aviso,
  // no debe tapar el HUD ni distraer de pilotar.
  flashDamage() {
    if (!this.damageFlash) {
      this.damageFlash = this.add
        .rectangle(0, 0, this.scale.width, this.scale.height, 0xff0000, 0.15)
        .setOrigin(0)
        .setScrollFactor(0)
        .setDepth(1000);
      this.hudLayer?.add(this.damageFlash);
    }
    this.damageFlash.setAlpha(0.22);
    this.tweens.add({ targets: this.damageFlash, alpha: 0, duration: 250 });
  }

  interpolateNpcs() {
    this.npcEntities?.forEach((entry) => {
      entry.container.x = Phaser.Math.Linear(entry.container.x, entry.serverX, 0.25);
      entry.container.y = Phaser.Math.Linear(entry.container.y, entry.serverY, 0.25);
      entry.sprite.rotation = entry.rotation + Math.PI / 2;
    });
  }

  // Retícula de bloqueo sobre CADA objetivo fijado (no solo el activo),
  // para que el jugador vea de un vistazo a qué tiene marcado sin abrir
  // ningún panel. Se reutilizan sprites en vez de crear/destruir cada
  // frame — ver el comentario de showActionReticle sobre el mismo motivo.
  updateTargetReticles() {
    if (!this.targetReticles) this.targetReticles = new Map();
    const activos = new Set();

    (combatState?.targets || []).forEach((target) => {
      const key = `${target.kind}:${target.id}`;
      activos.add(key);

      let entidad = null;
      if (target.kind === "npc") entidad = this.npcEntities?.get(target.id)?.container;
      else if (target.kind === "player") entidad = this.playerEntities?.get(target.id)?.container;
      if (!entidad) return;

      let ret = this.targetReticles.get(key);
      if (!ret) {
        ret = this.add.image(0, 0, "ui-icons", target.locked ? ICON_FRAMES.lockDone : ICON_FRAMES.lockPending);
        ret.setDisplaySize(70, 70);
        this.worldLayer?.add(ret);
        this.targetReticles.set(key, ret);
      }
      // Naranja mientras se fija, verde una vez bloqueado — coherente con
      // la retícula de acción contextual, que usa el mismo naranja para
      // "en progreso".
      ret.setTint(target.locked ? 0x66ff88 : 0xffb066);
      ret.setFrame(target.locked ? ICON_FRAMES.lockDone : ICON_FRAMES.lockPending);
      ret.setPosition(entidad.x, entidad.y);
      ret.rotation += 0.02;
    });

    // Se retiran las retículas de objetivos que ya no están en la lista.
    this.targetReticles.forEach((ret, key) => {
      if (!activos.has(key)) {
        ret.destroy();
        this.targetReticles.delete(key);
      }
    });
  }

  // ---- Referencia fuera de pantalla / demasiado lejos para leerse ------
  // Dos problemas distintos, mismo remedio: un punto de tamaño FIJO en
  // pantalla (se contrarresta el zoom con setScale(1/zoom), así no se
  // encoge igual que el resto del mundo).
  //  1) Muy alejado el zoom: el sprite de una nave se reduce a un par de
  //     píxeles y se pierde — se sustituye por el punto en su posición
  //     real, sin esperar a que esté fuera de cámara.
  //  2) Objetivo fijado fuera de la parte de mundo visible: pasa a
  //     CUALQUIER zoom, no hace falta estar alejado — el punto se coloca
  //     en el borde de la vista, en la dirección real hacia el objetivo,
  //     para no tener que alejar la cámara solo para encontrarlo.
  // Los objetivos fijados llevan el tratamiento SIEMPRE (offscreen o
  // demasiado pequeños); el resto de naves solo cuando el zoom está muy
  // alejado — así no se llena la pantalla de puntos con zoom normal.
  updateOffscreenMarkers() {
    if (!this.offscreenMarkers) this.offscreenMarkers = new Map(); // key -> circle

    const cam = this.cameras.main;
    const view = cam.worldView;
    const marginWorld = OFFSCREEN_MARKER_MARGIN_PX / cam.zoom;
    const minX = view.x + marginWorld;
    const maxX = view.x + view.width - marginWorld;
    const minY = view.y + marginWorld;
    const maxY = view.y + view.height - marginWorld;
    const zoomTooSmall = cam.zoom < OFFSCREEN_SHIP_ZOOM_THRESHOLD;
    const invZoom = 1 / cam.zoom;

    const lockedKeys = new Set((combatState?.targets || []).map((t) => `${t.kind}:${t.id}`));
    const activeKeys = new Set();

    const consider = (key, worldX, worldY, isTarget) => {
      const offscreen = worldX < minX || worldX > maxX || worldY < minY || worldY > maxY;
      // A los objetivos fijados no les hace falta estar lejos de zoom
      // para ganarse el marcador — solo estar fuera de la vista (o,
      // igual que cualquier otra nave, ser ilegible por zoom).
      if (!offscreen && !zoomTooSmall) return;

      activeKeys.add(key);
      let dot = this.offscreenMarkers.get(key);
      if (!dot) {
        dot = this.add.circle(0, 0, 1, 0xffffff, 0.95).setDepth(80);
        this.worldLayer?.add(dot);
        this.offscreenMarkers.set(key, dot);
      }
      const clampedX = Phaser.Math.Clamp(worldX, minX, maxX);
      const clampedY = Phaser.Math.Clamp(worldY, minY, maxY);
      dot.setPosition(clampedX, clampedY);
      dot.setScale(invZoom); // tamaño constante en pantalla, no se encoge con el zoom
      dot.setRadius(isTarget ? OFFSCREEN_TARGET_RADIUS_PX : OFFSCREEN_DOT_RADIUS_PX);
      // Naranja para objetivos fijados (mismo tono que la retícula de
      // bloqueo, para que se lean como "lo mismo"); blanco para el resto.
      dot.setFillStyle(isTarget ? 0xffb066 : 0xffffff, 0.95);
    };

    this.npcEntities?.forEach((entry, id) => {
      const key = `npc:${id}`;
      consider(key, entry.container.x, entry.container.y, lockedKeys.has(key));
    });

    this.playerEntities?.forEach((entry, sessionId) => {
      if (entry.isMe) return; // la propia cámara la sigue — nunca está fuera de vista
      const key = `player:${sessionId}`;
      consider(key, entry.container.x, entry.container.y, lockedKeys.has(key));
    });

    this.offscreenMarkers.forEach((dot, key) => {
      if (!activeKeys.has(key)) {
        dot.destroy();
        this.offscreenMarkers.delete(key);
      }
    });
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

  // ---- Controles táctiles: joystick y pellizco de zoom ----
  // (El botón de minar y el de warp ahora son HTML normal, ver
  // #mine-btn/#warp-btn en index.html — solo el joystick necesita vivir
  // dentro del canvas, porque tiene que aparecer justo donde se toca.)
  //
  // Un único listener de pointerdown/move/up gestiona el joystick y el
  // pellizco de zoom a la vez. El truco para que no se disparen juntos:
  // el primer dedo NO se compromete al joystick al instante — espera un
  // margen corto (JOYSTICK_COMMIT_DELAY) por si llega un segundo dedo, en
  // cuyo caso el gesto se reinterpreta como pellizco en vez de arrancar
  // el joystick.
  //
  // --- Piloto crucero (8.4.10.3) ------------------------------------
  // Gesto: mover el joystick (empujar de verdad, por encima de
  // THRUST_THRESHOLD), soltar, y VOLVER A TOCAR sin arrastrar (un tap
  // limpio, no un nuevo arrastre) — eso bloquea la nave viajando a la
  // velocidad/rumbo que llevaba, sin tener que mantener el dedo en la
  // pantalla. Se rastrea con dos variables: `lastReleaseHadThrust`
  // (¿el joystick anterior llegó a empujar de verdad antes de soltarse?)
  // y, en cada nuevo toque, cuánto se arrastra el dedo antes de soltarlo
  // — si es un tap (arrastre mínimo) Y el anterior tuvo empuje real, se
  // manda cruiseToggle. Tocar el joystick y MOVERLO ya cancela el
  // crucero solo con eso, por el lado del servidor (ver ChunkRoom.js).
  setupTouchMovementAndZoom() {
    this.touchPurpose = new Map(); // pointer.id -> "joystick" | "pinch"
    const maxRadius = 60;
    const CENTER_DEADZONE_PX = 3; // por debajo de esto, ángulo inestable — se ignora
    const TAP_DRAG_THRESHOLD_PX = 10; // arrastre máximo para seguir contando como "tap"
    const JOYSTICK_COMMIT_DELAY = 120; // ms

    let base = null;
    let thumb = null;
    let joystickPointerId = null;
    let pendingJoystickPointer = null; // { id, x, y } — a la espera de confirmación
    let pendingTimer = null;

    let joystickMaxDragPx = 0; // arrastre máximo (px) durante este toque — decide si fue "tap"
    let joystickMaxMagnitude = 0; // magnitud máxima alcanzada — decide si hubo empuje real
    let lastReleaseHadThrust = false; // ¿el joystick ANTERIOR llegó a empujar antes de soltarse?

    const resetDirection = () => {
      this.touchInput.angle = null;
      this.touchInput.magnitude = 0;
    };

    const commitJoystick = ({ id, x, y }) => {
      joystickPointerId = id;
      this.touchPurpose.set(id, "joystick");
      joystickMaxDragPx = 0;
      joystickMaxMagnitude = 0;
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
      resetDirection();

      const wasTap = joystickMaxDragPx < TAP_DRAG_THRESHOLD_PX;
      if (wasTap && lastReleaseHadThrust) {
        // Tap limpio justo después de un uso con empuje real: activa (o
        // cancela, si ya estaba activo) el crucero con la velocidad que
        // el servidor tenga en ese momento — el cliente no manda ningún
        // número, solo el "clic".
        this.room?.send("cruiseToggle");
        lastReleaseHadThrust = false;
      } else {
        // Este toque decide si el SIGUIENTE puede activar crucero.
        lastReleaseHadThrust = joystickMaxMagnitude > THRUST_THRESHOLD;
      }
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
      // Ya no hace falta comprobar si el toque cae sobre un botón — los
      // botones de minar/warp/opciones son HTML normal, colocados por
      // encima del canvas; un toque sobre ellos ni siquiera llega hasta
      // aquí (el navegador se lo entrega al botón, no al canvas debajo).

      // Fijar objetivo: si el toque cae sobre una nave marcada como
      // tocable, se manda el mensaje de fijado y NO se interpreta como
      // inicio de joystick. Va antes que cualquier otra comprobación
      // porque, a diferencia de los botones HTML, los sprites del mundo
      // sí pasan por este mismo manejador.
      const objetos = this.input.hitTestPointer(pointer);
      const blanco = objetos.find((o) => o.combatTarget);
      if (blanco) {
        this.room?.send("lock", blanco.combatTarget);
        if (blanco.combatTarget.kind === "npc") {
          const npcState = this.room?.state.npcs.get(blanco.combatTarget.id);
          targetInfo.kind = "npc";
          targetInfo.id = blanco.combatTarget.id;
          targetInfo.name = npcState?.name || t("combat.target");
          targetInfo.shield = 1;
          targetInfo.structure = 1;
        }
        return;
      }

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
        const rawDist = Math.hypot(dx, dy);
        const dist = Math.min(rawDist, maxRadius);
        const angle = Math.atan2(dy, dx);

        thumb.x = base.x + Math.cos(angle) * dist;
        thumb.y = base.y + Math.sin(angle) * dist;

        joystickMaxDragPx = Math.max(joystickMaxDragPx, rawDist);

        if (dist < CENTER_DEADZONE_PX) {
          resetDirection();
        } else {
          // Analógico real: el servidor decide con estos mismos umbrales
          // (PIVOT_THRESHOLD/THRUST_THRESHOLD) si solo pivota o si además
          // empuja, y con qué fuerza — aquí solo se manda la magnitud tal
          // cual, 0..1, sin cuantizar a 8 direcciones.
          this.touchInput.angle = angle;
          this.touchInput.magnitude = dist / maxRadius;
          joystickMaxMagnitude = Math.max(joystickMaxMagnitude, this.touchInput.magnitude);
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

  // ---- Cierre del juego (el resto del HUD ya es HTML, ver arriba) ----

  closeGame() {
    this.manualLeave = true;
    this.room?.leave();
    this.tweens.killAll();
    this.time.removeAllEvents();
    this.scene.pause();

    gameHud.style.display = "none";
    optionsPanel.style.display = "none";
    gameClosedOverlay.textContent = `${t("menu.gameClosedLine1")}\n${t("menu.gameClosedLine2")}`;
    gameClosedOverlay.style.display = "flex";
  }
}

let gameInstance = null;

function launchGame() {
  if (gameInstance) return;
  gameInstance = new Phaser.Game({
    // Forzado a WebGL en vez de Phaser.AUTO — con AUTO, algunos
    // navegadores/dispositivos caen en el renderer de Canvas2D, que tiene
    // un historial largo de bugs justo con esto (resolution/nitidez en
    // pantallas de alta densidad). WebGL lo soporta de forma fiable desde
    // Phaser 3.60 en adelante. Prácticamente todo móvil/portátil moderno
    // soporta WebGL, así que no se pierde compatibilidad real.
    type: Phaser.WEBGL,
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
