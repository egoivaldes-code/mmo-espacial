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
  }
}
type("number")(Player.prototype, "x");
type("number")(Player.prototype, "y");
type("number")(Player.prototype, "rotation");
type("string")(Player.prototype, "name");
type("number")(Player.prototype, "hp");
type("number")(Player.prototype, "cargo");

module.exports = { Player };
