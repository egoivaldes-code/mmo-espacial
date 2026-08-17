const { Schema, type } = require("@colyseus/schema");

/**
 * Estado sincronizado de una nave/jugador dentro del chunk.
 * Fase 0: solo posición, rotación y un contador simple de recurso minado.
 */
class Player extends Schema {
  constructor() {
    super();
    this.x = 0;
    this.y = 0;
    this.rotation = 0;
    this.name = "Piloto";
    this.hp = 100;
    this.cargo = 0; // recurso minado, prototipo simple sin tipos todavía
    this.warpCharging = false; // true durante la cuenta atrás de carga
    this.warpChargeRemaining = 0; // segundos restantes de carga
    this.warping = false; // true durante el viaje en línea recta a máxima velocidad
    this.invulnerable = false; // true mientras dura el warp
    this.warpCooldownRemaining = 0; // segundos restantes de enfriamiento
  }
}
type("number")(Player.prototype, "x");
type("number")(Player.prototype, "y");
type("number")(Player.prototype, "rotation");
type("string")(Player.prototype, "name");
type("number")(Player.prototype, "hp");
type("number")(Player.prototype, "cargo");
type("boolean")(Player.prototype, "warpCharging");
type("number")(Player.prototype, "warpChargeRemaining");
type("boolean")(Player.prototype, "warping");
type("boolean")(Player.prototype, "invulnerable");
type("number")(Player.prototype, "warpCooldownRemaining");

module.exports = { Player };
