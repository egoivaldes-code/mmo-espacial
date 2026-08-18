const { Schema, type } = require("@colyseus/schema");

/**
 * Nave NPC dentro del chunk.
 *
 * Mismo criterio que Player (8.4.8): aquí solo va lo que TODOS los clientes
 * necesitan para dibujarla y entender qué le pasa. Su objetivo actual, su
 * energía y su estado interno de IA se quedan en el servidor: son datos que
 * no cambian lo que nadie ve en pantalla, y replicarlos multiplicaría el
 * tráfico de una entidad que además va a existir por decenas.
 */
class Npc extends Schema {
  constructor() {
    super();
    this.x = 0;
    this.y = 0;
    this.rotation = 0;
    this.shipId = "cruiser_04";
    this.name = "Hostil";
    this.shield = 0;
    this.structure = 100;
    this.signature = 120;
    // Se replica para que el jugador vea que le están apuntando. Es un solo
    // booleano y es información que cambia lo que el jugador hace.
    this.firing = false;
  }
}
type("number")(Npc.prototype, "x");
type("number")(Npc.prototype, "y");
type("number")(Npc.prototype, "rotation");
type("string")(Npc.prototype, "shipId");
type("string")(Npc.prototype, "name");
type("number")(Npc.prototype, "shield");
type("number")(Npc.prototype, "structure");
type("number")(Npc.prototype, "signature");
type("boolean")(Npc.prototype, "firing");

module.exports = { Npc };
