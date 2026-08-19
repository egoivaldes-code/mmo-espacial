// ============================================================================
// Catálogo de estadísticas de nave — servidor
//
// Copia recortada de client/public/ships/ships.json: solo lo que la
// simulación necesita (id, clase, HP, velocidad máxima), sin sprites,
// sonidos ni descripciones. Vive aquí en vez de leerse cruzando a
// client/public/ para que el servidor no dependa de rutas fuera de su
// propia carpeta al desplegarse en Render.
//
// Si se edita el catálogo de naves (Naveteca, nueva nave, rebalanceo de
// HP/velocidad), esta tabla hay que actualizarla a mano con los mismos
// números — no se genera sola todavía.
//
// --- Masa, no giro/aceleración fijos --------------------------------------
// La aceleración y el giro NO son números sueltos por clase: salen de
// dividir el empuje/par del motor (fijo por clase, es el diseño del
// casco) entre la MASA de la nave (por nave individual). Es el modelo de
// físicas real (F = m·a), y es importante para el juego por un motivo muy
// concreto: cuando en el futuro haya carga en bodega, blindaje extra o
// módulos de estabilización de inercia, todos esos sistemas van a querer
// cambiar "cuánto pesa la nave ahora mismo" — y con masa como número
// central, cambiar UN valor ya cambia giro Y aceleración de forma
// coherente, sin tener que retocar dos stats a mano cada vez.
//
// Simplificación de este prototipo: masa = HP. No es realista (el HP
// mezcla blindaje, casco e interior, que no pesan igual), pero es
// consistente y da una nave más pesada dentro de su propia clase un
// pelín más torpe que una más ligera — el mismo tipo de variación que ya
// tenían HP y velocidad entre naves de la misma clase. El día que haya un
// sistema de masa "real" (separado del HP, con bodega/blindaje sumando
// masa aparte), esto se sustituye sin tocar el resto del código: solo
// cambia de dónde sale ship.mass.
//
// EMPUJE y PAR son del CASCO (fijos por clase, no por nave): representan
// los motores instalados de fábrica según el diseño del casco, igual
// para toda la clase. Se definen como
//   empuje/par = aceleración/giro OBJETIVO en la masa de REFERENCIA de la
//   clase (la que ya se usó para generar el catálogo de HP/velocidad de
//   client/public/ships/ships.json) — así el manejo real de cada nave
//   queda muy cerca del objetivo de diseño, con una pequeña variación
//   según si esa nave concreta es más pesada o más ligera que la media de
//   su clase.
// ============================================================================

const SHIP_BASE = {
  shuttle_01: { class: "shuttle", hp: 57, speed: 405 },
  shuttle_02: { class: "shuttle", hp: 57, speed: 434 },
  shuttle_03: { class: "shuttle", hp: 64, speed: 387 },
  shuttle_04: { class: "shuttle", hp: 63, speed: 438 },
  shuttle_05: { class: "shuttle", hp: 61, speed: 376 },
  shuttle_06: { class: "shuttle", hp: 57, speed: 381 },
  frigate_01: { class: "frigate", hp: 137, speed: 349 },
  frigate_02: { class: "frigate", hp: 145, speed: 334 },
  frigate_03: { class: "frigate", hp: 153, speed: 328 },
  frigate_04: { class: "frigate", hp: 152, speed: 356 },
  frigate_05: { class: "frigate", hp: 139, speed: 351 },
  frigate_06: { class: "frigate", hp: 142, speed: 319 },
  destroyer_01: { class: "destroyer", hp: 331, speed: 292 },
  destroyer_02: { class: "destroyer", hp: 310, speed: 274 },
  destroyer_03: { class: "destroyer", hp: 348, speed: 256 },
  destroyer_04: { class: "destroyer", hp: 331, speed: 278 },
  destroyer_05: { class: "destroyer", hp: 301, speed: 261 },
  destroyer_06: { class: "destroyer", hp: 338, speed: 303 },
  destroyer_07: { class: "destroyer", hp: 312, speed: 304 },
  destroyer_08: { class: "destroyer", hp: 323, speed: 269 },
  destroyer_09: { class: "destroyer", hp: 297, speed: 263 },
  cruiser_01: { class: "cruiser", hp: 698, speed: 242 }, // FHI Warden — nave del jugador
  cruiser_02: { class: "cruiser", hp: 612, speed: 238 },
  cruiser_03: { class: "cruiser", hp: 610, speed: 239 },
  cruiser_04: { class: "cruiser", hp: 632, speed: 248 }, // FHI Bastion — nave del NPC hostil
  cruiser_05: { class: "cruiser", hp: 713, speed: 233 },
  cruiser_06: { class: "cruiser", hp: 711, speed: 209 },
  battlecruiser_01: { class: "battlecruiser", hp: 1203, speed: 187 },
  battlecruiser_02: { class: "battlecruiser", hp: 1318, speed: 189 },
  battlecruiser_03: { class: "battlecruiser", hp: 1155, speed: 204 },
  battlecruiser_04: { class: "battlecruiser", hp: 1180, speed: 184 },
  battlecruiser_05: { class: "battlecruiser", hp: 1135, speed: 176 },
  battleship_01: { class: "battleship", hp: 2284, speed: 138 },
  battleship_02: { class: "battleship", hp: 2335, speed: 138 },
  battleship_03: { class: "battleship", hp: 2440, speed: 145 },
  battleship_04: { class: "battleship", hp: 2319, speed: 128 },
  battleship_05: { class: "battleship", hp: 2166, speed: 149 },
  carrier_01: { class: "carrier", hp: 3817, speed: 104 },
  carrier_02: { class: "carrier", hp: 3998, speed: 91 },
  carrier_03: { class: "carrier", hp: 4197, speed: 103 },
  dreadnought_01: { class: "dreadnought", hp: 7769, speed: 56 },
};

// HP medio de la clase (el mismo que se usó como base al generar el
// catálogo) — es la "masa de referencia" contra la que se calibran
// empuje y par. Objetivo de giro (°/s) y aceleración (u/s²) en esa masa
// de referencia: mismos números que el catálogo anterior, así el manejo
// real que va a sentir quien juegue apenas cambia — la diferencia ahora
// es que sale de dividir fuerza/masa en vez de ser un número suelto.
const CLASS_PHYSICS = {
  shuttle: { referenceMass: 60, turnRateDegAtRef: 260, accelerationAtRef: 520 },
  frigate: { referenceMass: 150, turnRateDegAtRef: 190, accelerationAtRef: 420 },
  destroyer: { referenceMass: 320, turnRateDegAtRef: 130, accelerationAtRef: 330 },
  cruiser: { referenceMass: 650, turnRateDegAtRef: 85, accelerationAtRef: 250 },
  battlecruiser: { referenceMass: 1200, turnRateDegAtRef: 55, accelerationAtRef: 180 },
  battleship: { referenceMass: 2400, turnRateDegAtRef: 34, accelerationAtRef: 120 },
  carrier: { referenceMass: 4200, turnRateDegAtRef: 18, accelerationAtRef: 65 },
  dreadnought: { referenceMass: 8000, turnRateDegAtRef: 9, accelerationAtRef: 30 },
};

const DEG_TO_RAD = Math.PI / 180;

// thrust (empuje, en "unidades de masa × u/s²") y torque (par, en
// "unidades de masa × rad/s") por clase — se calculan una sola vez desde
// CLASS_PHYSICS. thrust = mass_ref × accel_objetivo; torque = mass_ref ×
// turnRate_objetivo. Luego, para CUALQUIER masa: aceleración = thrust /
// masa, giro = torque / masa — el modelo F=m·a de verdad.
const CLASS_ENGINE = Object.fromEntries(
  Object.entries(CLASS_PHYSICS).map(([className, p]) => [
    className,
    {
      thrust: p.referenceMass * p.accelerationAtRef,
      torque: p.referenceMass * (p.turnRateDegAtRef * DEG_TO_RAD),
    },
  ])
);

// Escudo como fracción del HP — 0.6 es el ratio que ya se usaba a mano
// para el Warden (420/698) y el Bastion (380/632). Se generaliza igual
// para todas las clases: sin datos de balance real todavía, mantener el
// mismo ratio en todo el catálogo es más seguro que inventar uno nuevo
// por clase.
const SHIELD_RATIO = 0.6;

// Firma = k × √HP. k se eligió para que un crucero (Warden, HP 698) dé
// ≈120 de firma, que es el valor fijo que ya llevaba todo el juego
// (jugador, NPC, y signatureRef del arma en 8.4.3). Así el crucero no
// cambia apenas, y el resto de clases queda escalado de forma
// consistente a partir de ese punto de referencia real.
const SIGNATURE_K = 4.54;

/**
 * Devuelve las estadísticas completas (físicas y de combate) de una nave
 * por su id de catálogo. Si el id no existe, cae a cruiser_01 (Warden)
 * para no romper la sala — pero avisa por consola, porque no debería
 * pasar nunca en producción.
 */
function getShipStats(shipId) {
  const base = SHIP_BASE[shipId];
  if (!base) {
    console.error(
      `[shipStats] shipId desconocido: "${shipId}". Usando cruiser_01 (Warden) de reserva.`
    );
    return getShipStats("cruiser_01");
  }

  const engine = CLASS_ENGINE[base.class];
  const mass = base.hp; // simplificación del prototipo — ver cabecera del archivo
  const shield = Math.round(base.hp * SHIELD_RATIO);
  const signature = Math.round(SIGNATURE_K * Math.sqrt(base.hp));

  return {
    shipId,
    class: base.class,
    hp: base.hp,
    mass,
    shield,
    signature,
    maxSpeed: base.speed,
    turnRate: engine.torque / mass, // rad/s
    acceleration: engine.thrust / mass, // unidades/s²
  };
}

module.exports = { getShipStats, SHIP_BASE, CLASS_PHYSICS, CLASS_ENGINE };

