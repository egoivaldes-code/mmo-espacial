const { Schema, type, MapSchema } = require("@colyseus/schema");
const { Player } = require("./Player");
const { Asteroid } = require("./Asteroid");

class ChunkState extends Schema {
  constructor() {
    super();
    this.players = new MapSchema();
    this.asteroids = new MapSchema();
  }
}
type({ map: Player })(ChunkState.prototype, "players");
type({ map: Asteroid })(ChunkState.prototype, "asteroids");

module.exports = { ChunkState };
