const { Schema, type } = require("@colyseus/schema");

/**
 * Estado sincronizado de una nave/jugador dentro del chunk.
 * Solo lo que TODOS necesitan ver. Deliberadamente NO están aquí:
 *  - energía: cambia cada tick y solo le importa a su dueño → mensaje privado
 *  - objetivo fijado: idem
 *  - recarga de armas: el cliente la cuenta sola desde el disparo
 * (ver 8.4.8 del documento de diseño)
 */
class Player extends Schema {
  constructor() {
    super();
    this.x = 0;
    this.y = 0;
    this.rotation = 0;
    this.name = "Piloto";
    this.shield = 0;      // primera capa; se regenera sola
    this.structure = 100; // casco + blindaje + interior, NO se regenera solo
    this.signature = 120; // tamaño aparente: cuanto mayor, más fácil de acertar
    this.locking = false; // true mientras se está fijando un objetivo
    this.lockProgress = 0; // 0..1, para dibujar la retícula llenándose
    this.alive = true;
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
type("number")(Player.prototype, "shield");
type("number")(Player.prototype, "structure");
type("number")(Player.prototype, "signature");
type("boolean")(Player.prototype, "locking");
type("number")(Player.prototype, "lockProgress");
type("boolean")(Player.prototype, "alive");
type("number")(Player.prototype, "cargo");
type("boolean")(Player.prototype, "warpCharging");
type("number")(Player.prototype, "warpChargeRemaining");
type("boolean")(Player.prototype, "warping");
type("boolean")(Player.prototype, "invulnerable");
type("number")(Player.prototype, "warpCooldownRemaining");

module.exports = { Player };
