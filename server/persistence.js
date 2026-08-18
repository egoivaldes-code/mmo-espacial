// ============================================================================
// Persistencia — Supabase
//
// Este módulo es lo ÚNICO del servidor que habla con la base de datos.
// Todo lo demás (la sala, la simulación) le pide cosas a través de aquí.
//
// Usa la clave de SERVICIO, que salta todas las reglas de seguridad de la
// base de datos. Es una llave maestra: por eso vive en una variable de
// entorno del servidor y nunca, bajo ningún concepto, puede aparecer en el
// código del cliente ni en el repositorio.
//
// MODO SIN BASE DE DATOS: si las variables de entorno no están puestas, el
// servidor arranca igual y el juego funciona — simplemente no guarda nada,
// como antes. Esto es deliberado: un despliegue mal configurado degrada a
// "no se guarda" en vez de caerse y dejar el juego inaccesible.
// ============================================================================

const { createClient } = require("@supabase/supabase-js");

const SUPABASE_URL = process.env.SUPABASE_URL;
// Se aceptan los dos nombres a proposito. Supabase llama a esta clave
// "service_role" en su panel, pero es facil ponerla en Render con el nombre
// mas corto. Aceptar ambos evita el fallo mas desagradable posible: el
// servidor arranca, el juego funciona, y no guarda nada sin dar ningun error.
const SUPABASE_SERVICE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;

const enabled = Boolean(SUPABASE_URL && SUPABASE_SERVICE_KEY);

const supabase = enabled
  ? createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    })
  : null;

if (!enabled) {
  console.warn(
    "[persistencia] Faltan SUPABASE_URL y/o la clave de servicio " +
      "(SUPABASE_SERVICE_ROLE_KEY o SUPABASE_SERVICE_KEY). " +
      "El juego funcionará SIN guardar progreso."
  );
} else {
  console.log("[persistencia] Supabase conectado.");
}

// ---------------------------------------------------------------------------
// Autenticación
//
// El cliente envía el token que le dio Supabase al iniciar sesión. Aquí se
// comprueba contra Supabase que ese token es auténtico y no ha caducado.
//
// Es importante entender por qué esto es necesario: el cliente también manda
// el id del personaje que quiere jugar, y sin esta comprobación cualquiera
// podría mandar el id del personaje de otro y jugar con su nave. El token
// demuestra QUIÉN eres; después se comprueba que ese personaje es tuyo.
// ---------------------------------------------------------------------------
async function verifyToken(accessToken) {
  if (!enabled || !accessToken) return null;
  try {
    const { data, error } = await supabase.auth.getUser(accessToken);
    if (error || !data?.user) return null;
    return data.user.id;
  } catch (err) {
    console.error("[persistencia] Error verificando token:", err.message);
    return null;
  }
}

// Comprueba que el personaje existe Y pertenece a este usuario. Devuelve el
// personaje con su estado guardado, o null si no es suyo.
async function loadCharacter(userId, characterId) {
  if (!enabled) return null;
  try {
    const { data, error } = await supabase
      .from("characters")
      .select("id, name, user_id, character_state(*)")
      .eq("id", characterId)
      .eq("user_id", userId)
      .maybeSingle();

    if (error || !data) return null;

    // Primera vez que se juega con este personaje: aún no tiene estado.
    const state = Array.isArray(data.character_state)
      ? data.character_state[0]
      : data.character_state;

    return { id: data.id, name: data.name, state: state || null };
  } catch (err) {
    console.error("[persistencia] Error cargando personaje:", err.message);
    return null;
  }
}

// ---------------------------------------------------------------------------
// Guardado
//
// NO se guarda en cada tick. Escribir en una base de datos veinte veces por
// segundo y por jugador la fundiría, y no haría falta para nada: si el
// servidor se cae, perder los últimos segundos de vuelo es irrelevante.
//
// Se guarda con `upsert`: crea la fila si es la primera vez, la actualiza si
// ya existe. Así no hay que distinguir entre personaje nuevo y veterano.
// ---------------------------------------------------------------------------
async function saveCharacterState(characterId, state) {
  if (!enabled) return false;
  try {
    const { error } = await supabase.from("character_state").upsert(
      {
        character_id: characterId,
        ship_id: state.shipId,
        x: state.x,
        y: state.y,
        vx: state.vx,
        vy: state.vy,
        facing: state.facing,
        hp: Math.round(state.hp),
        shield: Math.round(state.shield || 0),
        cargo: state.cargo,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "character_id" }
    );
    if (error) {
      console.error("[persistencia] Error guardando estado:", error.message);
      return false;
    }
    return true;
  } catch (err) {
    console.error("[persistencia] Error guardando estado:", err.message);
    return false;
  }
}

// Marca cuándo se jugó por última vez con este personaje. Va aparte del
// estado porque no hace falta actualizarlo cada 30 segundos: basta una vez
// al entrar.
async function touchLastPlayed(characterId) {
  if (!enabled) return;
  try {
    await supabase
      .from("characters")
      .update({ last_played_at: new Date().toISOString() })
      .eq("id", characterId);
  } catch (err) {
    console.error("[persistencia] Error marcando última partida:", err.message);
  }
}

module.exports = {
  enabled,
  verifyToken,
  loadCharacter,
  saveCharacterState,
  touchLastPlayed,
};
