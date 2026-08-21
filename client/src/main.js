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
import { preloadEffects, buildEffectAnimations, playStructureHit, playShipDestroyed, playShieldHit } from "./effects.js";

// Súbela en cada release — se muestra en pantalla y sirve de referencia
// rápida para saber si el cliente cargado es el último.
const GAME_VERSION = "v0.8.8";

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

// --- Decoración de fondo cósmico ------------------------------------------
// 7 "hero" (nebulosas/galaxias grandes, tier "hero" en backdrops.json) +
// 56 "medium" (recortadas de las dos hojas de sprites, las de más área de
// cada una). Lista fija en vez de leída de backdrops.json en tiempo de
// ejecución — mismo motivo que EXPLOSION_TIERS en effects.js: hace falta
// conocer los nombres ANTES de que termine de cargar el propio manifest,
// para poder encolar this.load.image de todos a la vez en preload().
// backdrops.json se conserva en el repo como referencia/documentación del
// recorte, no lo lee el juego.
const BACKDROP_FILES = [
  "hero_spiral_galaxy.png", "hero_pillars_nebula.png", "hero_butterfly_nebula.png",
  "hero_collision_a.png", "hero_pillars_b.png", "hero_spiral_b.png", "hero_collision_b.png",
  "sheet45293_obj_041.png", "sheet45293_obj_001.png", "sheet45293_obj_028.png",
  "sheet45293_obj_136.png", "sheet45293_obj_052.png", "sheet45293_obj_085.png",
  "sheet45293_obj_039.png", "sheet45293_obj_137.png", "sheet45293_obj_022.png",
  "sheet45293_obj_069.png", "sheet45293_obj_097.png", "sheet45293_obj_115.png",
  "sheet45293_obj_149.png", "sheet45293_obj_074.png", "sheet45293_obj_151.png",
  "sheet45293_obj_153.png", "sheet45293_obj_113.png", "sheet45293_obj_073.png",
  "sheet45293_obj_027.png", "sheet45293_obj_025.png", "sheet45293_obj_126.png",
  "sheet45293_obj_059.png", "sheet45293_obj_139.png", "sheet45293_obj_033.png",
  "sheet45293_obj_105.png", "sheet45293_obj_135.png", "sheet45293_obj_150.png",
  "sheet45293_obj_010.png", "sheet45294_obj_049.png", "sheet45294_obj_050.png",
  "sheet45294_obj_086.png", "sheet45294_obj_105.png", "sheet45294_obj_001.png",
  "sheet45294_obj_097.png", "sheet45294_obj_141.png", "sheet45294_obj_019.png",
  "sheet45294_obj_100.png", "sheet45294_obj_068.png", "sheet45294_obj_146.png",
  "sheet45294_obj_143.png", "sheet45294_obj_104.png", "sheet45294_obj_140.png",
  "sheet45294_obj_032.png", "sheet45294_obj_066.png", "sheet45294_obj_075.png",
  "sheet45294_obj_014.png", "sheet45294_obj_072.png", "sheet45294_obj_036.png",
  "sheet45294_obj_003.png", "sheet45294_obj_118.png", "sheet45294_obj_085.png",
  "sheet45294_obj_101.png", "sheet45294_obj_136.png", "sheet45294_obj_015.png",
  "sheet45294_obj_039.png", "sheet45294_obj_004.png",
];
const BACKDROP_HERO_COUNT = 7; // los 7 primeros de la lista de arriba

// Semilla fija: el universo es determinista por semilla (mismo principio
// que CONCORD o el mundo por chunks — ver diseño), así que la decoración
// de fondo tiene que salir IGUAL en todos los clientes sin que el
// servidor tenga que mandar ni una coordenada. Un mulberry32 simple (PRNG
// determinista de una sola función, sin dependencias) generado a partir
// de esta semilla siempre produce la misma secuencia.
const BACKDROP_SEED = 0x5eed1e5;

// --- Torretas: sistema visual, sin efecto en el daño todavía --------------
// Primera entrega (8.4.24): que existan, en su sitio, y giren hacia el
// objetivo — con una torreta PLACEHOLDER, la misma en todos los slots de
// todas las naves. El daño real sigue siendo ARMA_MEDIUM_CORTA en el
// servidor (8.4.2); esto es puramente cosmético todavía, igual que la
// retícula de bloqueo o los VFX de explosión — no cambia ni un número de
// combate. Fitting de verdad (elegir qué torreta va en cada slot) y que
// el daño salga de las torretas fijadas siguen pendientes.
const TURRET_PLACEHOLDER_ID = "kinetic_autocanon_m";
// Ligeramente por encima de 0 (profundidad por defecto del casco) para
// que las torretas se pinten ENCIMA del casco, pero muy por debajo de
// cualquier UI/VFX del mundo (retículas en 80+, explosiones sin depth
// explícito pero añadidas después).
const TURRET_DEPTH = 1;
// Velocidad de giro al apuntar a un objetivo — grados/seg convertidos a
// radianes/ms más abajo. Instantáneo se veía como un salto, no como una
// torreta girando de verdad.
const TURRET_TURN_SPEED_RAD_PER_MS = ((140 * Math.PI) / 180) / 1000;
// BUG REAL (captura de pantalla — torretas del tamaño de la nave
// entera): kinetic_autocanon_m mide 110x176px nativos, prácticamente
// IGUAL que el sprite de la propia nave (101x175px) — a la misma
// escala que el casco (0.5), la torreta salía tan grande como la nave.
// El arte de turrets.json está pensado a un tamaño "de icono/ficha de
// fitting", no a la escala real relativa al casco donde se monta; hace
// falta encogerla por su cuenta. 0.15 deja la torreta en ~15% de la
// altura del casco — una protuberancia reconocible sobre el casco, no
// una estructura que compite en tamaño con la nave.
const TURRET_RELATIVE_SCALE = 0.15;

function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

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
// Devuelve el rectángulo recortado {minX, minY, w, h} en coordenadas de
// la imagen ORIGINAL (sin recortar) — lo necesita createTurretSprites
// para poder convertir las coordenadas de turret-slots.json (en píxeles
// de esa imagen original, la que exporta la Naveteca) al sistema de
// coordenadas de la textura YA recortada que de verdad se pinta en
// pantalla. Sin este dato, una torreta calibrada sobre el sprite
// original quedaría desplazada en cuanto el recorte quita franjas de
// transparencia distintas por arriba/izquierda que por abajo/derecha
// (recorte no simétrico → el centro visual se mueve).
function trimTransparentPadding(scene, key, alphaThreshold = 8) {
  const source = scene.textures.get(key)?.getSourceImage();
  if (!source || !source.width) return null;

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

  if (maxX < minX || maxY < minY) return null; // sprite completamente vacío, no tocar

  const w = maxX - minX + 1;
  const h = maxY - minY + 1;
  if (w === full.width && h === full.height) return { minX: 0, minY: 0, w, h }; // ya estaba ajustado

  const trimmed = document.createElement("canvas");
  trimmed.width = w;
  trimmed.height = h;
  trimmed.getContext("2d").drawImage(full, minX, minY, w, h, 0, 0, w, h);

  scene.textures.remove(key);
  scene.textures.addCanvas(key, trimmed);
  return { minX, minY, w, h };
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

// Media geométrica PONDERADA hacia MIN_ZOOM (70/30, no 50/50) en escala
// logarítmica — el zoom se siente multiplicativo, así que la ponderación
// también tiene que hacerse en esa escala, no en la lineal. Con 50/50 el
// triángulo sustituía al sprite real demasiado pronto (a media distancia
// de zoom) y tapaba la nave en acercamientos moderados; con 70/30 hace
// falta alejarse bastante más para que aparezca. Por debajo de este
// umbral, el triángulo de referencia sustituye al sprite (ver
// createOwnShipIndicator).
const OWN_SHIP_INDICATOR_ZOOM_THRESHOLD = Math.exp(0.7 * Math.log(MIN_ZOOM) + 0.3 * Math.log(MAX_ZOOM));

// Referencia fuera de pantalla / demasiado lejos para leerse como sprite.
// Radios en PÍXELES DE PANTALLA (constantes, no se encogen con el zoom —
// ver updateOffscreenMarkers). Cuidado con pasarse de escala: son puntos
// de referencia, no deben competir visualmente con los sprites reales.
const OFFSCREEN_MARKER_MARGIN_PX = 36; // separación del borde real de la vista
const OFFSCREEN_SHIP_ZOOM_THRESHOLD = 0.15; // por debajo de esto, un sprite ya no se lee
const OFFSCREEN_DOT_RADIUS_PX = 4;
const OFFSCREEN_TARGET_RADIUS_PX = 6;
// Blanco para cualquier nave normal; rojo solo para lo que es hostil de
// verdad (NPCs — no hay bandera de hostilidad entre jugadores todavía).
// Mismo criterio en el marcador fuera de pantalla y en la caja de
// targeting, para que se lean como "lo mismo" (8.4.11 — sin esto, el
// velo naranja permanente sobre el sprite del NPC era la única pista).
const MARKER_COLOR_HOSTILE = 0xff5050;
const MARKER_COLOR_NEUTRAL = 0xe8f0ff;

// --- Estelas de motor: en batería paralela, según clase de nave --------
// count = nº de estelas, en fila horizontal centrada en la popa, JUNTAS
// (sin separación entre ellas — ver ENGINE_TRAIL_SPACING_PX/_THICK_PX,
// no una fracción del ancho del casco: eso las dejaba con hueco entre
// sí, como chorros independientes en vez de una sola llama ancha).
// thick = estelas más grandes/lentas para battleship/capital, en vez de
// simplemente añadir más — a esa escala una fila de 5-6 puntitos finos se
// pierde, dos chorros gruesos se leen mejor.
const ENGINE_TRAIL_LAYOUT = {
  shuttle: { count: 1, thick: false },
  frigate: { count: 1, thick: false },
  destroyer: { count: 2, thick: false },
  cruiser: { count: 3, thick: false },
  battlecruiser: { count: 4, thick: false },
  battleship: { count: 2, thick: true },
  carrier: { count: 2, thick: true },
  dreadnought: { count: 2, thick: true },
};
const ENGINE_TRAIL_DEFAULT_LAYOUT = { count: 1, thick: false };
// Separación centro a centro entre chorros contiguos — pensada para que
// el borde de un chorro toque el del siguiente (diámetro visual de la
// partícula: textura 8px * escala inicial 0.55 ≈ 4-5px; 16px*0.8≈13px
// para las gruesas), no un hueco de verdad entre ellos.
const ENGINE_TRAIL_SPACING_PX = 4;
const ENGINE_TRAIL_SPACING_THICK_PX = 11;
// Separación respecto al borde real del sprite (ya recortado de
// transparencia por trimTransparentPadding) — un margen pequeño para que
// la estela no nazca pegada al borde.
const ENGINE_TRAIL_EDGE_MARGIN_PX = 5;

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
  // Añadidos en v0.5.12 — mismo estilo (línea fina blanca, generado a
  // partir de un prompt de referencia igualado al resto del set, ver
  // 15.5.1 del diseño). La hoja crece de 4×4 a 4×6; quedan 3 huecos
  // libres (fila 6, columnas 1-3) para futuros iconos.
  shield: [0, 4], hull: [1, 4], capacitor: [2, 4], cruise: [3, 4],
  autoTargetBack: [0, 5],
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
const autoshootRowEl = document.getElementById("autoshoot-row");
const autoshootCheck = document.getElementById("autoshoot-check");
const autoshootLabel = document.getElementById("autoshoot-label");

// 4 tarjetas fijas en el HTML (una por hueco de MAX_TARGETS en el
// servidor) — updateCombatHud solo cambia contenido/visibilidad de estas,
// nunca crea ni destruye nodos.
const TARGET_CARD_SLOTS = 4;
const targetCards = Array.from({ length: TARGET_CARD_SLOTS }, (_, i) => {
  const root = document.getElementById(`target-card-${i}`);
  return {
    root,
    nameEl: root.querySelector(".target-name"),
    shieldFillEl: root.querySelector(".target-shield-fill"),
    structureFillEl: root.querySelector(".target-structure-fill"),
  };
});
targetCards.forEach((card, i) => {
  // Tocar una tarjeta desfija ESE objetivo. pointerdown (no click) para
  // que se sienta tan inmediato como el resto de la UI táctil del juego.
  card.root.addEventListener("pointerdown", () => {
    const target = combatState?.targets?.[i];
    if (!target) return;
    getActiveScene()?.room?.send("unlock", { kind: target.kind, id: target.id });
  });
});

// Último estado de combate recibido del servidor. Es la fuente de verdad
// para dibujar el HUD; el cliente no calcula nada de esto por su cuenta.
let combatState = null;

// Escudo/estructura estimados de cada objetivo fijado — combatState.targets
// (servidor) dice QUÉ hay fijado y si está bloqueado, pero no lleva vida;
// eso se sigue infiriendo del lado del cliente igual que antes (evento
// "shot" al pegar, npc.onChange para lo que cambia por otras causas), solo
// que ahora es un Map por objetivo en vez de un único targetInfo — con
// varios objetivos a la vez cada uno necesita su propia estimación.
const targetHealthByKey = new Map(); // "npc:id" -> {name, shield, structure}
const NPC_SHIELD_MAX = 380;
const NPC_STRUCTURE_MAX = 632;
// PvP de pruebas (8.4.x): un jugador también puede ser objetivo, y sus
// máximos de vida son los de la nave de jugador (más abajo,
// CRUISER_SHIELD_MAX/CRUISER_STRUCTURE_MAX), no los del NPC.
function shieldMaxFor(kind) {
  return kind === "player" ? CRUISER_SHIELD_MAX : NPC_SHIELD_MAX;
}
function structureMaxFor(kind) {
  return kind === "player" ? CRUISER_STRUCTURE_MAX : NPC_STRUCTURE_MAX;
}

function setBarWidth(el, ratio) {
  el.style.width = `${Math.max(0, Math.min(1, ratio)) * 100}%`;
}

function updateCombatHud() {
  if (!combatState) {
    combatButtonsEl.classList.add("empty");
    autoshootRowEl.classList.add("hidden");
    targetCards.forEach((card) => card.root.classList.remove("visible"));
    return;
  }

  setBarWidth(capacitorFillEl, combatState.capacitor / combatState.capacitorMax);

  const targets = combatState.targets || [];
  const activo = targets.find((t) => t.active) || null;
  const bloqueado = Boolean(activo?.locked);

  // El botón de disparo (15.4.1) solo existe con objetivo fijado Y
  // bloqueado. Sin eso no hay a qué disparar, así que no ocupa sitio.
  combatButtonsEl.classList.toggle("empty", !bloqueado);
  if (bloqueado) {
    fireBtn.classList.toggle("active", combatState.firing);
    fireBtn.classList.toggle("no-energy", combatState.capacitor < 18);
  }

  // La casilla de autodisparo es una PREFERENCIA, no algo ligado al
  // objetivo activo — se ve y se puede tocar mientras haya CUALQUIER
  // objetivo fijado (aunque esté fijándose todavía), no solo cuando el
  // arma ya tiene a quién disparar. Antes vivía dentro de #combat-buttons
  // y se ocultaba a la vez que el botón de disparo, lo que la hacía
  // intocable la mayor parte del tiempo y parecía "no funcionar".
  autoshootRowEl.classList.toggle("hidden", targets.length === 0);
  autoshootCheck.checked = combatState.autoShoot;

  // Cuadrícula de objetivos: target 1/2 arriba, 3/4 debajo (orden de la
  // propia lista del servidor, que es el orden en que se fijaron).
  targetCards.forEach((card, i) => {
    const target = targets[i];
    if (!target) {
      card.root.classList.remove("visible");
      return;
    }
    card.root.classList.add("visible");
    card.root.classList.toggle("locking", !target.locked);
    card.root.classList.toggle("locked", target.locked);
    card.root.classList.toggle("firing-at", target.active && bloqueado);

    const key = `${target.kind}:${target.id}`;
    let health = targetHealthByKey.get(key);
    if (!health) {
      // Llega aquí sin haber pasado por el tap (p. ej. auto-fijado de
      // vuelta cuando un NPC o un jugador te ataca primero — startLock en
      // el servidor, sin intervención del cliente) — se siembra con lo
      // que ya se sepa en el estado replicado, en vez de quedarse en 100%
      // fijo hasta el primer disparo.
      const scene = getActiveScene();
      const liveState =
        target.kind === "npc" ? scene?.room?.state?.npcs?.get(target.id)
        : target.kind === "player" ? scene?.room?.state?.players?.get(target.id)
        : null;
      seedTargetHealth(target.kind, target.id, liveState?.name);
      health = targetHealthByKey.get(key);
      if (liveState) {
        health.shield = liveState.shield / shieldMaxFor(target.kind);
        health.structure = liveState.structure / structureMaxFor(target.kind);
      }
    }
    card.nameEl.textContent = health.name || t("combat.target");
    setBarWidth(card.shieldFillEl, health.shield);
    setBarWidth(card.structureFillEl, health.structure);
  });

  // Los objetivos que ya no están en la lista (murieron, se desfijaron,
  // salieron de alcance) no necesitan seguir ocupando memoria.
  const activeKeys = new Set(targets.map((t) => `${t.kind}:${t.id}`));
  targetHealthByKey.forEach((_, key) => {
    if (!activeKeys.has(key)) targetHealthByKey.delete(key);
  });
}

// El servidor manda escudo/estructura del objetivo dentro de los mensajes
// de disparo (shot/hit); targetHealthByKey se rellena con lo último que
// se sepa de cada objetivo fijado, no con una réplica completa por tick.
function seedTargetHealth(kind, id, name) {
  targetHealthByKey.set(`${kind}:${id}`, { name, shield: 1, structure: 1 });
}

function applyStructureDamageEstimate(kind, id, damage) {
  const key = `${kind}:${id}`;
  const health = targetHealthByKey.get(key);
  if (!health) return;
  // No se conoce el máximo de vida exacto del objetivo en el cliente, así
  // que se aproxima por la última barra conocida menos el daño
  // proporcional. Es una estimación visual, no un dato exacto — el
  // servidor es quien de verdad decide cuándo muere.
  health.structure = Math.max(0, health.structure - damage / structureMaxFor(kind));
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

// --- Pantalla de carga (preload de Phaser + conexión) ----------------------
// Ver CSS en index.html para el motivo: sin esto, un preload lento o una
// conexión que tarda eran indistinguibles de un juego colgado de verdad
// (bug real de v0.8.0, diseño 8.4.16/8.4.17).
const loadingOverlay = document.getElementById("game-loading-overlay");
const loadingStatusEl = document.getElementById("loading-status");
const loadingBarFillEl = document.getElementById("loading-bar-fill");
const loadingRetryBtn = document.getElementById("loading-retry-btn");
loadingRetryBtn.addEventListener("click", () => location.reload());

function showLoadingOverlay(text) {
  loadingOverlay.classList.remove("error", "connecting");
  loadingBarFillEl.style.width = "0%";
  loadingStatusEl.textContent = text;
  loadingOverlay.style.display = "flex";
}
function setLoadingProgress(fraction) {
  loadingBarFillEl.style.width = `${Math.round(fraction * 100)}%`;
}
function setLoadingConnecting(text) {
  loadingOverlay.classList.add("connecting");
  loadingStatusEl.textContent = text;
}
function setLoadingError(text) {
  loadingOverlay.classList.add("error");
  loadingStatusEl.textContent = text;
}
function hideLoadingOverlay() {
  loadingOverlay.style.display = "none";
}

// Cualquier error de JS a partir de aquí se ve en pantalla, no solo en la
// consola del navegador (invisible en un móvil normal). Motivo: varias
// rondas seguidas de "se queda todo negro y no pasa nada" sin poder ver la
// consola real del dispositivo — a partir de ahora, si algo revienta, se
// lee el error de verdad en pantalla en vez de tener que adivinar a
// ciegas qué fue. Fuerza la pantalla de carga a un estado de error
// aunque ya estuviera oculta — un fallo silencioso a medio jugar es
// exactamente el mismo síntoma ("todo negro, no responde") que un fallo
// al arrancar, así que se trata igual: visible, con el texto real.
function showFatalError(message) {
  loadingOverlay.classList.add("error");
  loadingOverlay.style.display = "flex";
  loadingStatusEl.textContent = message;
}
window.addEventListener("error", (e) => {
  showFatalError(`Error: ${e.message}\n(${e.filename?.split("/").pop()}:${e.lineno})`);
});
window.addEventListener("unhandledrejection", (e) => {
  const reason = e.reason;
  const msg = reason?.stack || reason?.message || String(reason);
  showFatalError(`Error no controlado: ${msg}`);
});

const autotargetBackCheck = document.getElementById("autotarget-back-check");
const cruiseIndicatorEl = document.getElementById("cruise-indicator");
const cruiseIndicatorLabel = document.getElementById("cruise-indicator-label");
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
  cruiseIndicatorLabel.textContent = t("hud.cruising");
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
    // Progreso real del preload (nave, sonidos, catálogo, VFX — todo lo
    // que se encola en este método) en la pantalla de carga. "progress"
    // dispara con la fracción 0..1 de bytes/archivos ya resueltos.
    this.load.on("progress", (fraction) => setLoadingProgress(fraction));

    // Textura de la estela de plasma — un disco suave generado a mano,
    // sin necesidad de un asset nuevo de arte. Pequeño a propósito: con
    // el ángulo de emisión ahora fijo (chorro, no nube — ver
    // updateEngineTrailsPosition), varias partículas finas y seguidas se
    // leen como un chorro continuo, no como bolas sueltas.
    const trailGfx = this.make.graphics({ x: 0, y: 0, add: false });
    trailGfx.fillStyle(0xffffff, 1);
    trailGfx.fillCircle(4, 4, 4);
    trailGfx.generateTexture("plasma-particle", 8, 8);
    trailGfx.destroy();

    // Variante gruesa para la estela de battleship/capital (8.x) — mismo
    // disco, el doble de grande, para que dos chorros lean como motores de
    // verdad y no como la misma partícula fina repetida.
    const trailGfxThick = this.make.graphics({ x: 0, y: 0, add: false });
    trailGfxThick.fillStyle(0xffffff, 1);
    trailGfxThick.fillCircle(8, 8, 8);
    trailGfxThick.generateTexture("plasma-particle-thick", 16, 16);
    trailGfxThick.destroy();

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
    // Slots de torreta por nave (Naveteca, 8.4.23) — junto a ships.json,
    // no hay carpeta propia todavía.
    this.load.json("turretSlotsCatalog", `${base}turret-slots.json`);
    // Catálogo completo de torretas — solo se usa para sacar el tamaño y
    // el pivote de la ÚNICA torreta placeholder (TURRET_PLACEHOLDER_ID),
    // no se cargan las 32 imágenes todavía (esto es solo la primera
    // entrega visual, ver 8.4.24).
    this.load.json("turretsCatalog", `${import.meta.env.BASE_URL}turrets/turrets.json`);
    this.load.image(
      `turret-${TURRET_PLACEHOLDER_ID}`,
      `${import.meta.env.BASE_URL}turrets/sprites/${TURRET_PLACEHOLDER_ID}.png`
    );

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

    // Explosiones y chispazos de escudo (VFX de combate) — ver effects.js.
    preloadEffects(this);

    // Los fondos NO se cargan aquí a propósito — ver loadBackdropsDeferred(),
    // llamado después de conectar. 63 peticiones HTTP más en este preload()
    // bloqueante (antes de poder ver la nave o hablar con el servidor) eran
    // 63 formas nuevas de dejar el juego colgado entero por una sola
    // petición floja en datos móviles — la decoración de fondo no tiene por
    // qué poder impedir entrar a jugar (bug real de v0.8.0, ver diseño
    // 8.4.16/8.4.17).
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

    // Animaciones de explosión/escudo — una sola vez, reutilizadas por
    // todos los disparos de toda la sesión (ver effects.js).
    buildEffectAnimations(this);
    this.uiCamera.setScroll(0, 0);
    this.uiCamera.setZoom(1);
    this.uiCamera.setBackgroundColor("rgba(0,0,0,0)");
    this.cameras.main.ignore(this.hudLayer);
    this.uiCamera.ignore(this.worldLayer);

    const catalog = this.cache.json.get("shipsCatalog") || [];
    // shipId -> clase, para la batería de estelas (createEngineTrails) —
    // genérico por clase real del catálogo, no una tabla propia que haya
    // que mantener en paralelo cada vez que la Naveteca añade una nave.
    this.shipClassById = new Map(catalog.map((s) => [s.id, s.class]));
    const baseMeta = catalog.find((s) => s.id === STARTING_SHIP_ID) || null;
    const override = getLocalShipOverride(STARTING_SHIP_ID);
    this.shipMeta = override && baseMeta ? { ...baseMeta, ...override, stats: { ...baseMeta.stats, ...(override.stats || {}) } } : baseMeta;

    // spriteTrimOffsets: shipId -> {minX, minY, w, h} del recorte real
    // aplicado a su textura — createTurretSprites lo necesita para
    // convertir las coordenadas de turret-slots.json (en píxeles de la
    // imagen ORIGINAL sin recortar) al sistema de la textura que de
    // verdad se pinta. El NPC (ship-${NPC_SHIP_ID}) nunca se recorta
    // (ver más abajo), así que no tiene entrada aquí — createTurretSprites
    // trata "sin entrada" como "imagen completa, sin offset".
    this.spriteTrimOffsets = new Map();
    this.spriteTrimOffsets.set(STARTING_SHIP_ID, trimTransparentPadding(this, `ship-${STARTING_SHIP_ID}`));

    this.turretSlotsByShip = this.cache.json.get("turretSlotsCatalog") || {};
    const turretsCatalog = this.cache.json.get("turretsCatalog") || [];
    this.turretPlaceholder = turretsCatalog.find((t) => t.id === TURRET_PLACEHOLDER_ID) || null;
    // mountCache: shipId -> array de {localX, localY} en píxeles nativos
    // ya centrados (relativos al centro del sprite, antes de aplicar la
    // escala 0.5 de renderizado) — se calcula una vez por clase de nave,
    // no por cada instancia (todas las naves de la misma clase comparten
    // el mismo montaje de torretas).
    this.turretMountCache = new Map();

    this.engineSound = this.sound.add(`ship-${STARTING_SHIP_ID}-hum`, { loop: true, volume: 0.12 });

    this.starfield();
    this.drawWorldBorder();
    this.createOwnShipIndicator();
    this.setupInput();
    this.setupZoom();
    gameHud.style.display = "block"; // el HUD (versión, engranaje, botones) es HTML normal
    this.setupVisibilityRetry();

    setLoadingConnecting(t("loading.connecting"));
    await this.connectToServer();

    // Decoración de fondo: solo después de estar conectado y jugando (ver
    // loadBackdropsDeferred) — nunca antes, para que no pueda retrasar ni
    // bloquear la conexión real al servidor (bug real de v0.8.0, ver
    // diseño 8.4.16/8.4.17).
    this.loadBackdropsDeferred();
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

  // Nebulosas/galaxias de fondo, dispersas por todo el mundo con posición,
  // rotación y escala aleatorias — MISMA secuencia en todos los clientes
  // (mulberry32 con semilla fija, ver BACKDROP_SEED), así que el universo
  // se ve igual para todos sin que el servidor tenga que mandar nada.
  //
  // Capa "estrellas/galaxias de ambientación" (por debajo de planeta/
  // estación/naves — ver diseño 8.x de capas gráficas): se añaden aquí,
  // en create(), ANTES que cualquier nave, así que por orden de inserción
  // quedan siempre detrás de todo lo que se cree después (mismo truco que
  // ya usa starfield(), sin necesidad de gestionar profundidad a mano).
  //
  // scrollFactor < 1 les da algo de parallax (se sienten más lejanas que
  // las naves), y NO se contrarresta el zoom (a diferencia de las
  // estrellas-punto): son manchas de área real, tiene que dar la sensación
  // de que están ahí fuera en el mundo, no pegadas a la pantalla.
  spawnBackdropsUnsafe() {
    // BUG REAL (encontrado por eslint tras el susto de "box is not
    // defined"): esta línea se perdió sin querer al renombrar la función
    // en el fix de carga diferida (v0.8.1) — "rand" quedaba sin definir
    // en toda la función. No crasheaba nada (spawnBackdrops() ya la
    // envuelve en try/catch, ver más abajo) pero significaba que las
    // nebulosas de fondo NUNCA llegaban a aparecer, en silencio.
    const rand = mulberry32(BACKDROP_SEED);
    const half = WORLD_SIZE * 0.9; // un poco más allá del borde jugable, como el starfield
    const HERO_COUNT = 22; // dispersión rala de las grandes
    const MEDIUM_COUNT = 130; // más densas, reutilizando las 56 texturas medianas

    const place = (fileIndex, isHero) => {
      const key = `backdrop-${BACKDROP_FILES[fileIndex]}`;
      const x = (rand() * 2 - 1) * half;
      const y = (rand() * 2 - 1) * half;
      const img = this.add.image(x, y, key);
      img.setRotation(rand() * Math.PI * 2);
      // Grandes de verdad — son la capa de fondo ("ambientación", por
      // debajo de planeta/estación/naves/contenedores en la conversación
      // de capas), no un detalle discreto. 2.5-6x para las "hero",
      // 1.1-3x para las medianas.
      img.setScale((isHero ? 2.5 : 1.1) + rand() * (isHero ? 3.5 : 1.9));
      img.setAlpha((isHero ? 0.22 : 0.3) + rand() * 0.22);
      img.setScrollFactor(isHero ? 0.35 : 0.55);
      img.setBlendMode(Phaser.BlendModes.ADD);
      // Profundidad NEGATIVA explícita, no orden de inserción: desde el
      // fix de carga diferida (8.4.17/v0.8.1), los fondos se crean
      // DESPUÉS de que la propia nave (y la de cualquiera que ya esté
      // conectado) exista en worldLayer — por orden de inserción a
      // secas, se habrían pintado ENCIMA de las naves, justo al revés de
      // lo pedido ("es la capa del final, los sprites de naves,
      // estaciones, contenedores etc van encima"). Con depth negativo,
      // Phaser los ordena siempre detrás de cualquier cosa con depth 0
      // (el valor por defecto de naves/asteroides/estaciones), sin
      // importar cuándo se creó cada cosa.
      img.setDepth(-100);
      this.worldLayer.add(img);
    };

    for (let i = 0; i < HERO_COUNT; i++) {
      place(Math.floor(rand() * BACKDROP_HERO_COUNT), true);
    }
    for (let i = 0; i < MEDIUM_COUNT; i++) {
      const idx = BACKDROP_HERO_COUNT + Math.floor(rand() * (BACKDROP_FILES.length - BACKDROP_HERO_COUNT));
      place(idx, false);
    }
  }

  // Carga diferida de los 63 PNG de decoración (NO en preload(), ver el
  // comentario allí) — se lanza una SEGUNDA pasada del loader ya con el
  // juego en marcha y ya conectado, y spawnBackdrops() solo se ejecuta
  // cuando esa pasada termina. Si tarda o incluso si algún archivo falla,
  // el jugador ya está dentro y jugando; las nebulosas simplemente
  // aparecen un poco tarde (o no aparecen, en el peor caso) en vez de
  // bloquear nada (bug real de v0.8.0, ver diseño 8.4.16/8.4.17).
  loadBackdropsDeferred() {
    for (const file of BACKDROP_FILES) {
      this.load.image(`backdrop-${file}`, `${import.meta.env.BASE_URL}backdrops/${file}`);
    }
    this.load.once("complete", () => this.spawnBackdrops());
    this.load.start();
  }

  spawnBackdrops() {
    // Puramente decorativo: un fallo aquí (textura rara, lo que sea) no
    // puede tirar nada más — el jugador ya está dentro y jugando cuando
    // esto se ejecuta.
    try {
      this.spawnBackdropsUnsafe();
    } catch (err) {
      console.error("spawnBackdrops falló, se sigue sin decoración de fondo:", err);
    }
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
      // Antes este error solo se veía en una línea pequeña arriba a la
      // izquierda, fácil de no ver — con la pantalla de carga todavía
      // tapando el juego, se muestra ahí bien visible, con botón de
      // reintentar (recarga la página; más simple y fiable que intentar
      // reconstruir el estado a medias desde aquí).
      setLoadingError(t("loading.error", { error: err.message }));
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
      if (!isMe) {
        // PvP de pruebas (8.4.x): cualquier otro jugador es tocable para
        // fijar objetivo, igual que un NPC — mismo patrón de hitArea
        // generosa (difícil acertar justo sobre el sprite mientras se
        // mueve en móvil).
        sprite.setInteractive(
          new Phaser.Geom.Circle(sprite.width / 2, sprite.height / 2, Math.max(sprite.width, sprite.height) * 0.9),
          Phaser.Geom.Circle.Contains
        );
        sprite.combatTarget = { kind: "player", id: sessionId };
      }
      // El nombre no se muestra sobre la propia nave — solo tiene
      // sentido para identificar a los demás jugadores en pantalla.
      const label = this.add
        .text(0, 22, isMe ? "" : player.name, { fontSize: "10px", color: "#cfe8ff" })
        .setOrigin(0.5, 0);
      const container = this.add.container(player.x, player.y, [sprite, label]);
      this.worldLayer.add(container);

      // Batería de estelas de plasma — nº de chorros y grosor según clase
      // real de la nave (ver ENGINE_TRAIL_LAYOUT). Solo se activan
      // mientras la nave acelera (ver updateEngineTrailsPosition, llamado
      // desde predictLocalMovement para la nave propia; las remotas se
      // activan por cambio de posición).
      const engineTrails = this.createEngineTrails(container, `ship-${STARTING_SHIP_ID}`);
      // Torretas placeholder (8.4.24) — todos los jugadores usan la misma
      // nave (STARTING_SHIP_ID) hoy, así que el montaje es el mismo para
      // isMe y para el resto.
      const turrets = this.createTurretSprites(STARTING_SHIP_ID);

      const entry = {
        container,
        sprite,
        label,
        isMe,
        engineTrails,
        turrets,
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
        } else {
          // Si este jugador está entre mis objetivos fijados, su tarjeta
          // se actualiza igual que la de un NPC — cambios de vida por
          // cualquier causa (otro jugador disparándole, no solo mis
          // propios disparos).
          const health = targetHealthByKey.get(`player:${sessionId}`);
          if (health) {
            health.shield = player.shield / CRUISER_SHIELD_MAX;
            health.structure = player.structure / CRUISER_STRUCTURE_MAX;
            updateCombatHud();
          }
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
        // Esto es lo primero que confirma que ya hay algo de verdad que
        // ver en pantalla (la propia nave, ya posicionada) — el punto más
        // fiable para quitar la pantalla de carga, mejor que justo tras
        // el await de connectToServer (ahí la nave todavía podría no
        // haberse creado si el primer parche de estado llega un pelín
        // después de la confirmación de unión a la sala).
        hideLoadingOverlay();
      }
    });

    this.room.state.players.onRemove((_, sessionId) => {
      const entry = this.playerEntities.get(sessionId);
      if (entry) {
        entry.container.destroy();
        entry.engineTrails?.forEach(({ emitter }) => emitter.destroy());
        entry.turrets?.forEach(({ sprite }) => sprite.destroy());
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
      // Sin velo de color permanente: la identificación de "es hostil" la
      // da ahora el marcador (caja roja) en updateOffscreenMarkers/
      // updateTargetReticles, no un tinte encima de todo el sprite.
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
      // Torretas placeholder (8.4.24) — por clase real del NPC
      // (npc.shipId), no una nave fija: si algún día hay NPCs de varias
      // clases, cada una saca su propio montaje de turret-slots.json sin
      // tocar este código.
      const turrets = this.createTurretSprites(npc.shipId);
      this.npcEntities.set(id, { container, sprite, turrets, serverX: npc.x, serverY: npc.y, rotation: npc.rotation });

      npc.onChange(() => {
        const entry = this.npcEntities.get(id);
        if (!entry) return;
        entry.serverX = npc.x;
        entry.serverY = npc.y;
        entry.rotation = npc.rotation;
        // Actualiza SU entrada en targetHealthByKey si está fijado (no
        // hace falta que sea el objetivo activo) — con varios objetivos a
        // la vez, cualquiera de ellos puede cambiar de vida por causas
        // ajenas a los propios disparos (otro jugador, regeneración...).
        const health = targetHealthByKey.get(`npc:${id}`);
        if (health) {
          health.shield = npc.shield / NPC_SHIELD_MAX;
          health.structure = npc.structure / NPC_STRUCTURE_MAX;
          updateCombatHud();
        }
      });
    });
    this.room.state.npcs.onRemove((npc, id) => {
      const entry = this.npcEntities.get(id);
      if (!entry) return;
      entry.container.destroy();
      entry.turrets?.forEach(({ sprite }) => sprite.destroy());
      this.npcEntities.delete(id);
      // No hace falta tocar targetHealthByKey aquí: en cuanto el NPC
      // muere, el servidor lo quita de combatState.targets y el próximo
      // updateCombatHud limpia la entrada huérfana por su cuenta.
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
    });

    // Resultado de CADA disparo propio. Se enseñan los factores por
    // separado para que el jugador entienda por qué el disparo fue flojo
    // y aprenda a colocarse, en vez de ver solo un número (8.4.10).
    this.room.onMessage("shot", (msg) => {
      // shieldDamage/structureDamage ya vienen desglosados del servidor
      // (ver 8.4.13) — más preciso que estimar con el daño total, y sirve
      // igual para cualquiera de los objetivos fijados, no solo el activo.
      if (msg.structureDamage > 0) {
        applyStructureDamageEstimate(msg.kind, msg.id, msg.structureDamage);
        updateCombatHud();
      }
      this.showDamageNumber(msg);

      // VFX en el objetivo: chispazo de escudo si absorbió algo, explosión
      // de casco si llegó a estructura. Un golpe puede hacer las dos cosas
      // a la vez (escudo justo agotándose a mitad del golpe).
      const entry = this.resolveEntity(msg.kind, msg.id);
      if (entry) {
        if (msg.shieldDamage > 0) playShieldHit(this, entry.container, entry.sprite);
        if (msg.destroyed) {
          playShipDestroyed(this, entry.container.x, entry.container.y);
        } else if (msg.structureDamage > 0) {
          playStructureHit(this, entry.container.x, entry.container.y, msg.structureDamage);
        }
      }
    });

    // Golpe recibido de un NPC. Actualiza las barras propias sin esperar al
    // próximo latido de posición.
    this.room.onMessage("hit", (msg) => {
      // shieldFillEl y structureFillEl se refrescan solos vía onChange del
      // estado del jugador (más abajo), esto solo dispara el parpadeo rojo.
      this.flashDamage();

      if (this.localEntry) {
        if (msg.shieldDamage > 0) playShieldHit(this, this.localEntry.container, this.localEntry.sprite);
        if (msg.structureDamage > 0) {
          playStructureHit(this, this.localEntry.container.x, this.localEntry.container.y, msg.structureDamage);
        }
      }
    });

    this.room.onMessage("destroyed", () => {
      if (this.localEntry) {
        playShipDestroyed(this, this.localEntry.container.x, this.localEntry.container.y);
      }
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
      entry.engineTrails?.forEach(({ emitter }) => emitter.destroy());
      entry.turrets?.forEach(({ sprite }) => sprite.destroy());
    });
    this.playerEntities.clear();
    this.asteroidSprites.forEach((circle) => circle.destroy());
    this.asteroidSprites.clear();
    this.actionReticle?.destroy();
    this.actionReticle = null;
    setContextAction(null);
    this.npcEntities?.forEach((e) => {
      e.container.destroy();
      e.turrets?.forEach(({ sprite }) => sprite.destroy());
    });
    this.npcEntities?.clear();
    this.targetReticles?.forEach((r) => r.destroy());
    this.targetReticles?.clear();
    this.offscreenMarkers?.forEach((marker) => {
      marker.box?.destroy();
      marker.dot?.destroy();
      marker.destroy();
    });
    this.offscreenMarkers?.clear();
    combatState = null;
    targetHealthByKey.clear();
    updateCombatHud();
    this.localEntry = null;
    this.localPlayerState = null;
    cruiseIndicatorEl.style.display = "none";
    this.lastCruiseIndicatorShown = false;
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
    this.updateCruiseIndicator();
    this.updateAllTurrets(delta);
  }

  // Torretas (8.4.24): la nave propia apunta a su objetivo activo
  // bloqueado si tiene uno (el mismo que usa el HUD de combate, 8.4.14);
  // el resto de naves (jugadores remotos, NPCs) no tienen forma de saber
  // a quién le está disparando ESE cliente desde aquí sin que el
  // servidor lo retransmita — de momento sus torretas se quedan
  // alineadas con el casco (targetWorldX=null en updateTurretSprites).
  updateAllTurrets(deltaMs) {
    if (this.localEntry) {
      const activo = (combatState?.targets || []).find((t) => t.active && t.locked);
      let tx = null;
      let ty = null;
      if (activo) {
        const targetEntry =
          activo.kind === "npc" ? this.npcEntities?.get(activo.id) : this.playerEntities?.get(activo.id);
        if (targetEntry) {
          tx = targetEntry.container.x;
          ty = targetEntry.container.y;
        }
      }
      this.updateTurretSprites(this.localEntry, deltaMs, tx, ty);
    }
    this.playerEntities?.forEach((entry) => {
      if (entry.isMe) return; // ya actualizada arriba, con su objetivo real
      this.updateTurretSprites(entry, deltaMs);
    });
    this.npcEntities?.forEach((entry) => {
      this.updateTurretSprites(entry, deltaMs);
    });
  }

  // Único reflejo visual de player.cruising (8.4.10.3) — sin esto,
  // activar el piloto crucero no se notaba en ningún sitio salvo por
  // tacto (la nave seguía moviéndose sola sin más). Compara con el
  // último estado mostrado para no escribir en el DOM 60 veces por
  // segundo cuando no ha cambiado nada.
  updateCruiseIndicator() {
    const cruising = !!this.localPlayerState?.cruising;
    if (cruising === this.lastCruiseIndicatorShown) return;
    this.lastCruiseIndicatorShown = cruising;
    cruiseIndicatorEl.style.display = cruising ? "flex" : "none";
  }

  // Crea la batería de estelas de una nave según su clase real (catálogo
  // ships.json, resuelto en shipClassById durante create()). count chorros
  // en fila horizontal PARALELA (todos apuntando hacia atrás, no en
  // abanico), separados por igual dentro de una franja central del ancho
  // del casco — no de punta a punta, para no salir de las alas/brazos en
  // naves muy anchas. La posición y el ángulo reales de cada chorro se
  // recalculan cada frame en updateEngineTrailsPosition, esto solo crea
  // los emisores y guarda su offset lateral relativo (fracción de -1..1).
  // Posiciones de montaje de torretas para una clase de nave, en píxeles
  // nativos ya CENTRADOS (relativos al centro del sprite tal y como se
  // renderiza, no a la esquina superior izquierda de la imagen original
  // de turret-slots.json) — listas para rotar por la orientación real de
  // la nave y escalar por su sprite.scale en createTurretSprites/
  // updateTurretSprites. Se calcula una vez por clase (cacheado en
  // turretMountCache), no por cada instancia — todas las naves de la
  // misma clase comparten montaje.
  getTurretMounts(shipId) {
    if (this.turretMountCache.has(shipId)) return this.turretMountCache.get(shipId);

    const data = this.turretSlotsByShip[shipId];
    if (!data) {
      this.turretMountCache.set(shipId, []);
      return [];
    }

    // Recorte real aplicado a ESTA textura concreta (solo la nave propia
    // se recorta hoy, ver spriteTrimOffsets) — sin entrada, se asume
    // imagen completa sin offset (el caso del NPC).
    const trim = this.spriteTrimOffsets.get(shipId);
    const minX = trim?.minX ?? 0;
    const minY = trim?.minY ?? 0;
    const trimmedW = trim?.w ?? data.spriteSize.w;
    const trimmedH = trim?.h ?? data.spriteSize.h;

    const mounts = data.slots.map((slot) => ({
      localX: slot.x - minX - trimmedW / 2,
      localY: slot.y - minY - trimmedH / 2,
    }));
    this.turretMountCache.set(shipId, mounts);
    return mounts;
  }

  // Crea los sprites de torreta (placeholder, misma en todos los slots)
  // para una nave concreta — independientes del sprite del casco, no
  // hijos suyos: el casco rota aplicando `sprite.rotation` directamente
  // (no `container.rotation`, ver comentario de updateEngineTrailsPosition
  // más abajo), así que las torretas necesitan su posición y rotación
  // recalculadas a mano cada frame igual que las estelas de motor —
  // mismo patrón, mismo motivo.
  createTurretSprites(shipId) {
    if (!this.turretPlaceholder) return [];
    const mounts = this.getTurretMounts(shipId);
    if (!mounts.length) return [];

    const { size, pivot } = this.turretPlaceholder;
    const textureKey = `turret-${TURRET_PLACEHOLDER_ID}`;

    return mounts.map(({ localX, localY }) => {
      const sprite = this.add.image(0, 0, textureKey);
      // Origen en el propio pivote (centro de rotación calibrado en la
      // Naveteca), no en el centro geométrico del sprite — para que gire
      // desde donde de verdad se monta en el casco, no desde el medio de
      // la imagen del cañón.
      sprite.setOrigin(pivot.x / size.w, pivot.y / size.h);
      sprite.setDepth(TURRET_DEPTH);
      this.worldLayer.add(sprite);
      return { sprite, localX, localY, aimRotation: 0 };
    });
  }

  // Recoloca y reorienta cada torreta de una nave, cada frame. La
  // posición sale de rotar su offset local (calculado sin rotación,
  // "nave mirando hacia arriba") por la rotación REAL actual del casco —
  // mismo cálculo que el offset de las estelas de motor, aplicado por
  // torreta en vez de una sola vez detrás de la nave. La rotación PROPIA
  // de la torreta persigue el objetivo con un giro limitado
  // (TURRET_TURN_SPEED_RAD_PER_MS), no un salto instantáneo — sin
  // objetivo, se queda alineada con el casco (mirando "hacia delante").
  //
  // Puramente visual (8.4.24): no afecta a si el disparo acierta ni a
  // cuánto daño hace, eso lo sigue decidiendo el servidor sin mirar
  // hacia dónde apunta el dibujo del cañón.
  updateTurretSprites(entry, deltaMs, targetWorldX = null, targetWorldY = null) {
    if (!entry.turrets?.length) return;
    const shipRot = entry.sprite.rotation;
    const cos = Math.cos(shipRot);
    const sin = Math.sin(shipRot);
    const scale = entry.sprite.scale;

    let desiredRotation = shipRot;
    if (targetWorldX !== null) {
      desiredRotation = Math.atan2(targetWorldY - entry.container.y, targetWorldX - entry.container.x) + Math.PI / 2;
    }

    const maxStep = TURRET_TURN_SPEED_RAD_PER_MS * deltaMs;
    entry.turrets.forEach((turret) => {
      const rotatedX = turret.localX * cos - turret.localY * sin;
      const rotatedY = turret.localX * sin + turret.localY * cos;
      turret.sprite.setPosition(entry.container.x + rotatedX * scale, entry.container.y + rotatedY * scale);
      // La POSICIÓN del montaje escala con el casco (arriba, correcto:
      // es dónde en la nave está el hueco); el TAMAÑO del propio dibujo
      // de la torreta necesita además TURRET_RELATIVE_SCALE, o sale del
      // tamaño de la nave entera (ver comentario de la constante).
      turret.sprite.setScale(scale * TURRET_RELATIVE_SCALE);

      const diff = angleDiff(turret.sprite.rotation, desiredRotation);
      const step = Phaser.Math.Clamp(diff, -maxStep, maxStep);
      turret.sprite.rotation += step;
    });
  }


  createEngineTrails(container, textureKey) {
    const shipClass = this.shipClassById?.get(textureKey.replace(/^ship-/, ""));
    const layout = ENGINE_TRAIL_LAYOUT[shipClass] || ENGINE_TRAIL_DEFAULT_LAYOUT;
    const particleTexture = layout.thick ? "plasma-particle-thick" : "plasma-particle";

    const trails = [];
    for (let i = 0; i < layout.count; i++) {
      // -1..1, centrado; con count=1 el único chorro va en el centro (0).
      const lateralFrac = layout.count === 1 ? 0 : -1 + (2 * i) / (layout.count - 1);
      const emitter = this.add.particles(0, 0, particleTexture, {
        // Sin "follow": la posición se actualiza a mano cada frame
        // (updateEngineTrailsPosition) para poder colocarla detrás de la
        // nave según su orientación real, no un offset fijo en pantalla.
        // "angle" y "speed" arrancan con un valor cualquiera — se
        // sobreescriben nada más crearse la nave.
        lifespan: layout.thick ? 320 : 220,
        angle: -90,
        speed: layout.thick ? 90 : 60,
        scale: layout.thick ? { start: 0.8, end: 0 } : { start: 0.55, end: 0 },
        alpha: { start: 0.85, end: 0 },
        tint: 0x66ccff,
        frequency: layout.thick ? 14 : 18,
        emitting: false,
      });
      this.worldLayer.add(emitter);
      trails.push({ emitter, lateralFrac, thick: layout.thick });
    }
    return trails;
  }

  // Coloca CADA emisor de la batería detrás de la nave, en fila horizontal
  // paralela (todos con el mismo ángulo — el de la cola), separados
  // lateralmente entre sí. El offset hacia atrás y la separación lateral
  // salen del tamaño REAL del sprite (displayHeight/displayWidth, ya
  // recortado de transparencia por trimTransparentPadding), con un margen
  // fijo para que no nazcan pegadas al borde — así una fragata pequeña y
  // un acorazado enorme llevan la estela bien puesta sin tabla por nave.
  //
  // sprite.rotation = facing + PI/2 (el arte apunta "arriba" por defecto,
  // así que se compensa con +PI/2 — ver predictLocalMovement /
  // interpolateRemotePlayers). Para volver a la dirección física real
  // ("facing") hay que DESHACER ese +PI/2 restándolo, y luego sumar PI
  // para apuntar hacia atrás: facing + PI = (sprite.rotation - PI/2) + PI
  // = sprite.rotation + PI/2. Restar PI directamente a sprite.rotation
  // (como estaba antes) deja el offset girado 90° de más — la estela
  // salía por el lateral de la nave en vez de por la cola. La lateral
  // (perpendicular) es ese mismo ángulo menos PI/2.
  updateEngineTrailsPosition(entry, isThrusting, speed = 0) {
    if (!entry.engineTrails?.length) return;
    const back = entry.sprite.rotation + Math.PI / 2;
    const lateral = back - Math.PI / 2;

    const backOffset = entry.sprite.displayHeight / 2 + ENGINE_TRAIL_EDGE_MARGIN_PX;

    const angleDeg = Phaser.Math.RadToDeg(back);
    entry.engineTrails.forEach(({ emitter, lateralFrac, thick }) => {
      // halfSpread = (count-1)/2 * separación-entre-vecinos, así que la
      // distancia entre dos chorros CONTIGUOS siempre es exactamente
      // ENGINE_TRAIL_SPACING_PX (o su versión gruesa) sin importar
      // cuántos haya en la batería — 3 chorros de crucero o 4 de
      // battlecruiser quedan igual de juntos entre sí.
      const spacing = thick ? ENGINE_TRAIL_SPACING_THICK_PX : ENGINE_TRAIL_SPACING_PX;
      const trailCount = entry.engineTrails.length;
      const halfSpread = ((trailCount - 1) / 2) * spacing;
      const lateralOffset = lateralFrac * halfSpread;
      emitter.setPosition(
        entry.container.x + Math.cos(back) * backOffset + Math.cos(lateral) * lateralOffset,
        entry.container.y + Math.sin(back) * backOffset + Math.sin(lateral) * lateralOffset
      );

      // Chorro estrecho en vez de nube: un ÁNGULO EXACTO (no un rango
      // {min,max}) actualizado cada frame según hacia dónde apunta la
      // cola. Phaser tiene un bug conocido (#6688) donde setEmitterAngle
      // con un rango en tiempo de ejecución da resultados impredecibles —
      // con un número exacto sí es fiable, y de paso sale un chorro más
      // fino. Todos los chorros de la batería comparten el mismo ángulo
      // (paralelos, no en abanico).
      emitter.setEmitterAngle(angleDeg);
      emitter.setParticleSpeed(Phaser.Math.Clamp(60 + speed * 0.6, 60, 900));
      emitter.emitting = isThrusting;
    });
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
      this.updateEngineTrailsPosition(this.localEntry, true, warpSpeed);

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

    this.updateEngineTrailsPosition(this.localEntry, isThrusting, Math.hypot(this.localEntry.vx, this.localEntry.vy));

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
  // container+sprite de un objetivo por kind/id, o null si ya no existe
  // (destruido/desconectado justo antes de que llegara este mensaje — el
  // orden entre el mensaje de combate y el patch de estado de Colyseus no
  // está garantizado). Usado tanto para el número de daño como para los VFX.
  resolveEntity(kind, id) {
    const entry = kind === "npc" ? this.npcEntities?.get(id) : this.playerEntities?.get(id);
    return entry ?? null;
  }

  showDamageNumber(msg) {
    const entry = this.resolveEntity(msg.kind, msg.id);
    if (!entry) return;
    const x = entry.container.x;
    const y = entry.container.y;
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
  //
  // setScale(1/zoom): la retícula vive en el mundo (para seguir al
  // objetivo sin recalcular nada), pero su TAMAÑO en pantalla tiene que
  // ser constante — si no, con zoom out se encoge igual que el resto del
  // mundo hasta desaparecer, que era justo el hueco entre "se lee bien" y
  // "ya hay marcador fuera de pantalla" donde el objetivo fijado parecía
  // esfumarse (mismo truco que los marcadores de updateOffscreenMarkers).
  updateTargetReticles() {
    if (!this.targetReticles) this.targetReticles = new Map();
    const activos = new Set();
    const invZoom = 1 / this.cameras.main.zoom;

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
        ret.baseScale = ret.scaleX; // escala que da los 70px deseados a zoom 1
        this.worldLayer?.add(ret);
        this.targetReticles.set(key, ret);
      }
      // Naranja mientras se fija, verde una vez bloqueado — coherente con
      // la retícula de acción contextual, que usa el mismo naranja para
      // "en progreso".
      ret.setTint(target.locked ? 0x66ff88 : 0xffb066);
      ret.setFrame(target.locked ? ICON_FRAMES.lockDone : ICON_FRAMES.lockPending);
      ret.setPosition(entidad.x, entidad.y);
      ret.setScale(ret.baseScale * invZoom);
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

    // Marcador = punto + caja de targeting (4 esquinas) alrededor. Se
    // pidió mantener el punto (no sustituirlo), solo meterlo en una caja
    // que se lea como "esto es un contacto", distinto del fondo de
    // estrellas. Color: rojo si es hostil de verdad (NPC — no hay bandera
    // de hostilidad entre jugadores todavía), blanco si no. El tamaño de
    // caja crece un poco si además está fijado como objetivo, para que un
    // objetivo se distinga de un contacto cualquiera sin cambiar de color.
    const consider = (key, worldX, worldY, isTarget, isHostile) => {
      const offscreen = worldX < minX || worldX > maxX || worldY < minY || worldY > maxY;
      // A los objetivos fijados no les hace falta estar lejos de zoom
      // para ganarse el marcador — solo estar fuera de la vista (o,
      // igual que cualquier otra nave, ser ilegible por zoom).
      if (!offscreen && !zoomTooSmall) return;

      activeKeys.add(key);
      let marker = this.offscreenMarkers.get(key);
      // BUG REAL (v0.7.0 → v0.8.3, encontrado por el error visible en
      // pantalla de 8.4.19): "box" y "dot" se declaraban con const DENTRO
      // del bloque `if (!marker)`, con alcance solo ahí — pero se usaban
      // más abajo, fuera de ese bloque, en la misma función. En JS eso no
      // es "solo la primera vez"; ES SIEMPRE un ReferenceError, la
      // primerísima vez que se llama a consider() con cualquier marcador
      // (nuevo o no). Como esto vive en updateOffscreenMarkers(), llamado
      // desde update() en cada frame, el error cortaba TODO lo que
      // update() hace después de este punto para ese frame — de ahí que
      // el joystick, el sonido y el movimiento parecieran completamente
      // muertos (viven después en el update) mientras el HUD (HTML aparte,
      // nada que ver con el bucle de Phaser) seguía funcionando bien.
      // Arreglo: declarar box/dot en el ámbito de toda la función,
      // rellenándolos desde el marcador ya existente cuando lo hay.
      let box, dot;
      if (!marker) {
        dot = this.add.circle(0, 0, 1, 0xffffff, 0.95);
        box = this.add.graphics();
        marker = this.add.container(0, 0, [box, dot]).setDepth(80);
        marker.box = box;
        marker.dot = dot;
        this.worldLayer?.add(marker);
        this.offscreenMarkers.set(key, marker);
      } else {
        box = marker.box;
        dot = marker.dot;
      }
      const clampedX = Phaser.Math.Clamp(worldX, minX, maxX);
      const clampedY = Phaser.Math.Clamp(worldY, minY, maxY);
      marker.setPosition(clampedX, clampedY);
      marker.setScale(invZoom); // tamaño constante en pantalla, no se encoge con el zoom

      const color = isHostile ? MARKER_COLOR_HOSTILE : MARKER_COLOR_NEUTRAL;
      const dotRadius = isTarget ? OFFSCREEN_TARGET_RADIUS_PX : OFFSCREEN_DOT_RADIUS_PX;
      const boxHalf = dotRadius + (isTarget ? 7 : 4);
      // Redibujar el graphics es barato (un puñado de trazos, no cientos)
      // pero solo hace falta si algo cambió — evita rehacer el mismo
      // dibujo 60 veces por segundo para marcadores quietos.
      if (marker.lastColor !== color || marker.lastBoxHalf !== boxHalf) {
        marker.lastColor = color;
        marker.lastBoxHalf = boxHalf;
        const cornerLen = boxHalf * 0.65;
        box.clear();
        box.lineStyle(1.5, color, 0.95);
        // Cuatro esquinas sueltas (no un cuadrado completo): se lee como
        // "caja de targeting" sin tapar tanto el punto de dentro. Cada
        // esquina es una "L" que apunta hacia el centro del marcador.
        [
          [-boxHalf, -boxHalf],
          [boxHalf, -boxHalf],
          [-boxHalf, boxHalf],
          [boxHalf, boxHalf],
        ].forEach(([cx, cy]) => {
          const towardCenterX = cx > 0 ? -cornerLen : cornerLen;
          const towardCenterY = cy > 0 ? -cornerLen : cornerLen;
          box.beginPath();
          box.moveTo(cx, cy);
          box.lineTo(cx + towardCenterX, cy);
          box.moveTo(cx, cy);
          box.lineTo(cx, cy + towardCenterY);
          box.strokePath();
        });
      }
      dot.setRadius(dotRadius);
      dot.setFillStyle(color, 0.95);
    };

    this.npcEntities?.forEach((entry, id) => {
      const key = `npc:${id}`;
      consider(key, entry.container.x, entry.container.y, lockedKeys.has(key), true);
    });

    this.playerEntities?.forEach((entry, sessionId) => {
      if (entry.isMe) return; // la propia cámara la sigue — nunca está fuera de vista
      const key = `player:${sessionId}`;
      consider(key, entry.container.x, entry.container.y, lockedKeys.has(key), false);
    });

    this.offscreenMarkers.forEach((marker, key) => {
      if (!activeKeys.has(key)) {
        marker.box?.destroy();
        marker.dot?.destroy();
        marker.destroy();
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
      this.updateEngineTrailsPosition(entry, movedDist > 2, estimatedSpeed);
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
          seedTargetHealth("npc", blanco.combatTarget.id, npcState?.name || t("combat.target"));
        } else if (blanco.combatTarget.kind === "player") {
          const otherState = this.room?.state.players.get(blanco.combatTarget.id);
          seedTargetHealth("player", blanco.combatTarget.id, otherState?.name || t("combat.target"));
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

function buildGameConfig(rendererType) {
  return {
    type: rendererType,
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
    // Sin timeout, una sola petición colgada (conexión móvil floja, no
    // necesariamente el propio servidor de juego) deja el loader
    // esperando para siempre — y como preload()/create() son
    // secuenciales, eso bloqueaba TODO lo de después, incluida la
    // conexión a Colyseus (bug real de v0.8.0, ver diseño 8.4.17). 15s de
    // margen: de sobra para GitHub Pages en cualquier red normal, pero ya
    // no cuelga el juego entero por un archivo que nunca contesta.
    loader: { timeout: 15000 },
  };
}

function launchGame() {
  if (gameInstance) return;
  showLoadingOverlay(t("loading.assets"));
  try {
    // Forzado a WebGL en vez de Phaser.AUTO — con AUTO, algunos
    // navegadores/dispositivos caen en el renderer de Canvas2D, que tiene
    // un historial largo de bugs justo con esto (resolution/nitidez en
    // pantallas de alta densidad). Pero si el dispositivo NO soporta
    // WebGL de verdad, forzarlo sin más deja el juego completamente roto
    // — pantalla negra, sin input, sin sonido, indistinguible de
    // cualquier otro cuelgue (sospecha concreta tras varios reportes
    // seguidos de "todo negro y no responde nada" sin poder confirmar la
    // causa exacta). Con try/catch: si WebGL falla al crear el contexto,
    // se reintenta con Canvas2D — peor nitidez en pantallas de alta
    // densidad, pero un juego que al menos funciona es mejor que uno
    // nítido y completamente muerto.
    gameInstance = new Phaser.Game(buildGameConfig(Phaser.WEBGL));
  } catch (err) {
    console.error("WebGL falló al crear el juego, reintentando con Canvas2D:", err);
    try {
      gameInstance = new Phaser.Game(buildGameConfig(Phaser.CANVAS));
    } catch (err2) {
      showFatalError(`No se pudo iniciar el motor gráfico:\n${err2.message}`);
    }
  }
}
