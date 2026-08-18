// ============================================================================
// Combate — fórmulas
//
// Todo el cálculo de si un disparo hace daño y cuánto vive aquí, separado de
// la sala para poder tocarlo sin riesgo de romper la simulación.
//
// REGLA QUE MANDA (ver 8.4.2 del documento de diseño): los disparos NO son
// objetos que vuelan. Se resuelven en el instante con una cuenta. El cliente
// dibuja la traza, pero eso es decoración: para el servidor el disparo ocurre
// y termina en el mismo tick.
//
// La alternativa —cada disparo como entidad con posición, comprobada contra
// cada nave 20 veces por segundo— funciona con cuatro amigos probando y funde
// el servidor el día que hay batalla de verdad.
// ============================================================================

// --- Cómo se decide cuánto daño entra --------------------------------------
//
// No hay acierto/fallo. El daño es CONTINUO: un disparo mal encarado hace
// poco daño en vez de fallar del todo. Se elige así porque es mucho más
// legible para el jugador — ve el número bajar y entiende que está mal
// colocado, en lugar de ver "fallo" y pensar que tuvo mala suerte.
//
// Dos factores lo multiplican:
//
//   1. ANGULAR — si el arma consigue seguir al objetivo. Lo que importa NO es
//      lo rápido que va el otro, sino lo rápido que cruza tu punto de mira.
//      Una nave que se aleja en línea recta a toda velocidad es facilísima de
//      acertar; la misma nave orbitándote de cerca es casi imposible. Esto es
//      lo que convierte el pilotaje en la defensa activa del juego (8.4.10).
//
//   2. RANGO — dentro del alcance óptimo el arma pega entero; más allá, el
//      daño cae rápido.

// Velocidad angular del objetivo respecto al tirador, en radianes por segundo.
// Es la componente de su velocidad perpendicular a la línea que los une,
// dividida por la distancia. De ahí que acercarse dispare la velocidad
// angular: el mismo movimiento lateral cruza mucho más rápido el punto de
// mira cuanto más cerca estás.
function velocidadAngular(tirador, objetivo) {
  const dx = objetivo.x - tirador.x;
  const dy = objetivo.y - tirador.y;
  const dist = Math.hypot(dx, dy);
  if (dist < 1) return 0;

  // Velocidad relativa (si el tirador también se mueve, cuenta la diferencia).
  const vx = (objetivo.vx || 0) - (tirador.vx || 0);
  const vy = (objetivo.vy || 0) - (tirador.vy || 0);

  // Componente perpendicular a la línea tirador→objetivo.
  const transversal = Math.abs((vx * -dy + vy * dx) / dist);
  return transversal / dist;
}

// Factor 0..1 por seguimiento. La firma del objetivo entra aquí: un objetivo
// grande es más fácil de seguir aunque cruce igual de rápido, y por eso un
// arma Medium sufre contra una fragata y no contra otro crucero.
function factorAngular(arma, tirador, objetivo) {
  const velAng = velocidadAngular(tirador, objetivo);
  if (velAng <= 0) return 1;

  const trackingEfectivo = arma.tracking * (objetivo.signature / arma.signatureRef);
  if (trackingEfectivo <= 0) return 0;

  const ratio = velAng / trackingEfectivo;
  // Cuadrático: penaliza poco los errores pequeños y mucho los grandes, que
  // es lo que hace que colocarse bien se note.
  return 1 / (1 + ratio * ratio);
}

// Factor 0..1 por distancia. Dentro del óptimo, entero. Fuera, cae rápido.
function factorRango(arma, distancia) {
  if (distancia <= arma.optimal) return 1;
  if (arma.falloff <= 0) return 0;
  const exceso = (distancia - arma.optimal) / arma.falloff;
  return Math.pow(0.5, exceso * exceso);
}

// Resultado completo de un ciclo de arma. Devuelve también los factores por
// separado para que el cliente pueda enseñar POR QUÉ el disparo fue flojo:
// sin esa información el jugador no aprende a colocarse y concluye que su
// pilotaje no sirve para nada (8.4.10).
function resolverDisparo(arma, tirador, objetivo) {
  const distancia = Math.hypot(objetivo.x - tirador.x, objetivo.y - tirador.y);

  // Fuera de alcance máximo no se dispara siquiera: no se gasta energía ni
  // se manda mensaje.
  if (distancia > arma.optimal + arma.falloff * 3) return null;

  const angular = factorAngular(arma, tirador, objetivo);
  const rango = factorRango(arma, distancia);
  const calidad = angular * rango;

  return {
    damage: arma.damage * calidad,
    quality: calidad,
    angular,
    rango,
    distancia,
  };
}

// --- Aplicación del daño ---------------------------------------------------
//
// Escudo primero, estructura después (8.4.3). Sin tercera capa de armadura:
// la estructura representa casco, blindaje y compartimentos a la vez.
//
// Las resistencias por tipo de daño todavía no existen; cuando existan entran
// justo aquí, entre el daño bruto y el reparto entre capas.
function aplicarDano(entidad, cantidad) {
  let restante = cantidad;
  let aEscudo = 0;
  let aEstructura = 0;

  if (entidad.shield > 0) {
    aEscudo = Math.min(entidad.shield, restante);
    entidad.shield -= aEscudo;
    restante -= aEscudo;
  }
  if (restante > 0) {
    aEstructura = Math.min(entidad.structure, restante);
    entidad.structure -= aEstructura;
  }

  return { aEscudo, aEstructura, destruida: entidad.structure <= 0 };
}

// Regeneración natural del escudo. La estructura NO se regenera sola: para
// eso hará falta un reparador, y esa asimetría es lo que hace que perder el
// escudo importe.
function regenerarEscudo(entidad, maxShield, regenPorSegundo, dt) {
  if (entidad.shield >= maxShield) return;
  entidad.shield = Math.min(maxShield, entidad.shield + regenPorSegundo * dt);
}

module.exports = {
  velocidadAngular,
  factorAngular,
  factorRango,
  resolverDisparo,
  aplicarDano,
  regenerarEscudo,
};
