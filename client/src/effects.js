// Explosiones y chispazos de escudo — capa visual pura. El servidor decide
// cuánto daño va a escudo/estructura (combat.js, aplicarDano); este módulo
// solo traduce esos números en qué animación tocar y dónde. Nada de aquí
// afecta al estado real del juego, así que puede fallar (textura no
// cargada, nave ya destruida, etc.) sin romper nada más.
//
// Diseñado para ser genérico por clase de nave, no por nave concreta (8.x):
// el tamaño del anillo de escudo y si es circular u ovalado sale de la
// proporción real del sprite de la nave en tiempo de ejecución, no de una
// tabla por shipId. Añadir una clase de nave nueva (destroyer, battleship,
// carrier...) no requiere tocar este archivo.

const BASE = `${import.meta.env.BASE_URL}effects/`;

// Debe coincidir con effects.json (mismo recorte, mismo orden). Se repite
// aquí en vez de leerlo por fetch para poder precargar las texturas en el
// preload() de Phaser sin un segundo paso de carga asíncrona.
const EXPLOSION_TIERS = {
  pequena: 13,
  mediana: 10,
  grande: 7,
  critica: 6,
};
const SHIELD_PHASES = {
  circular: { aparicion: 7, mantenido: 7, disipacion: 7 },
  ovalado: { aparicion: 6, mantenido: 6, disipacion: 6 },
};

// Tamaño nativo aproximado del frame "mantenido" de cada forma de escudo
// (medido de los PNG recortados). Solo se usa para calcular el factor de
// escala que hace que el anillo case con el casco de CADA nave.
const SHIELD_NATIVE_WIDTH = { circular: 82, ovalado: 92 };

function pad(n) {
  return String(n).padStart(2, "0");
}

function explosionKey(tier, i) {
  return `fx-explosion-${tier}-${pad(i)}`;
}
function shieldKey(shape, phase, i) {
  return `fx-shield-${shape}-${phase}-${pad(i)}`;
}

// --- Carga (llamar desde preload()) -----------------------------------

export function preloadEffects(scene) {
  for (const [tier, count] of Object.entries(EXPLOSION_TIERS)) {
    for (let i = 1; i <= count; i++) {
      scene.load.image(explosionKey(tier, i), `${BASE}explosions/${tier}/explosion_${tier}_${pad(i)}.png`);
    }
  }
  for (const [shape, phases] of Object.entries(SHIELD_PHASES)) {
    for (const [phase, count] of Object.entries(phases)) {
      for (let i = 1; i <= count; i++) {
        scene.load.image(
          shieldKey(shape, phase, i),
          `${BASE}shields/${shape}/${phase}/escudo_${shape}_${phase}_${pad(i)}.png`
        );
      }
    }
  }
}

// --- Animaciones (llamar una vez desde create()) -----------------------

let animsBuilt = false;

export function buildEffectAnimations(scene) {
  if (animsBuilt) return;
  animsBuilt = true;

  for (const [tier, count] of Object.entries(EXPLOSION_TIERS)) {
    scene.anims.create({
      key: `explosion-${tier}`,
      frames: Array.from({ length: count }, (_, i) => ({ key: explosionKey(tier, i + 1) })),
      frameRate: 18,
      repeat: 0,
    });
  }

  for (const [shape, phases] of Object.entries(SHIELD_PHASES)) {
    for (const [phase, count] of Object.entries(phases)) {
      scene.anims.create({
        key: `shield-${shape}-${phase}`,
        frames: Array.from({ length: count }, (_, i) => ({ key: shieldKey(shape, phase, i + 1) })),
        frameRate: phase === "mantenido" ? 10 : 16,
        repeat: phase === "mantenido" ? -1 : 0,
      });
    }
  }
}

// --- Explosiones ---------------------------------------------------------

// Umbrales sobre el daño APLICADO a estructura en este golpe (no el daño
// bruto del disparo — un golpe que solo roza la estructura tras vaciar el
// escudo no debería verse tan grande como uno que la destroza entera).
// Referencia: ARMA_MEDIUM_CORTA hace hasta 170 de daño con calidad perfecta.
function tierForStructureDamage(dmg) {
  if (dmg < 40) return "pequena";
  if (dmg < 90) return "mediana";
  if (dmg < 140) return "grande";
  return "critica";
}

// scale 1 ≈ mismo tamaño con el que se diseñó el recorte (ver naveteca).
// Las naves se pintan a escala 0.5 (setScale(0.5) en main.js), así que ese
// es también el punto de partida por defecto para que la explosión no
// aplaste ni desborde la nave.
export function playExplosion(scene, x, y, tier, scale = 0.5) {
  if (!scene?.worldLayer) return;
  const sprite = scene.add.sprite(x, y, explosionKey(tier, 1)).setScale(scale);
  scene.worldLayer.add(sprite);
  sprite.play(`explosion-${tier}`);
  sprite.once("animationcomplete", () => sprite.destroy());
}

export function playStructureHit(scene, x, y, structureDamage) {
  playExplosion(scene, x, y, tierForStructureDamage(structureDamage));
}

export function playShipDestroyed(scene, x, y) {
  playExplosion(scene, x, y, "critica", 0.85);
}

// --- Escudo ----------------------------------------------------------------

// Circular si el casco es aproximadamente tan ancho como alto; ovalado si
// está claramente alargado en un eje. Genérico por forma real del sprite,
// no por shipId — ver cabecera del archivo.
function shieldShapeFor(sprite) {
  const w = sprite.displayWidth || sprite.width;
  const h = sprite.displayHeight || sprite.height;
  if (!w || !h) return "ovalado";
  const ratio = Math.min(w, h) / Math.max(w, h);
  return ratio >= 0.8 ? "circular" : "ovalado";
}

// Un chispazo de escudo por golpe: aparición corta, un instante mantenido
// (una sola vuelta, no en bucle indefinido — si llegan golpes seguidos cada
// uno relanza su propio chispazo), y disipación. Vive colgado del container
// de la nave para heredar su posición/rotación sin recalcular nada cada
// frame (mismo patrón que sprite/label existentes en main.js).
export function playShieldHit(scene, container, hullSprite) {
  if (!container) return;
  const shape = shieldShapeFor(hullSprite);
  const nativeW = SHIELD_NATIVE_WIDTH[shape];
  const targetW = (hullSprite.displayWidth || hullSprite.width) * 1.3;
  const scale = targetW / nativeW;

  const ring = scene.add.sprite(0, 0, shieldKey(shape, "aparicion", 1)).setScale(scale);
  container.add(ring);

  ring.play(`shield-${shape}-aparicion`);
  ring.once("animationcomplete", () => {
    if (!ring.scene) return; // container/nave ya destruida entretanto
    ring.play(`shield-${shape}-mantenido`);
    scene.time.delayedCall(220, () => {
      if (!ring.scene) return;
      ring.play(`shield-${shape}-disipacion`);
      ring.once("animationcomplete", () => ring.destroy());
    });
  });
}
