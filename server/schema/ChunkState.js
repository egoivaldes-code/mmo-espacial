const { Schema, type, MapSchema } = require("@colyseus/schema");
const { Player } = require("./Player");
const { Asteroid } = require("./Asteroid");
const { Npc } = require("./Npc");

class ChunkState extends Schema {
  constructor() {
    super();
    this.players = new MapSchema();
    this.asteroids = new MapSchema();
    this.npcs = new MapSchema();
  }
}
type({ map: Player })(ChunkState.prototype, "players");
type({ map: Asteroid })(ChunkState.prototype, "asteroids");
type({ map: Npc })(ChunkState.prototype, "npcs");

module.exports = { ChunkState };
