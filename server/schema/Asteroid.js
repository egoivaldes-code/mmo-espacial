const { Schema, type } = require("@colyseus/schema");

/**
 * Asteroide fijo y minable dentro del chunk. Fase 0: sin tipos de mineral,
 * solo una cantidad de recurso que se agota al minar.
 */
class Asteroid extends Schema {
  constructor(id, x, y, amount = 100) {
    super();
    this.id = id;
    this.x = x;
    this.y = y;
    this.amount = amount;
  }
}
type("string")(Asteroid.prototype, "id");
type("number")(Asteroid.prototype, "x");
type("number")(Asteroid.prototype, "y");
type("number")(Asteroid.prototype, "amount");

module.exports = { Asteroid };
