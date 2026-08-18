// ============================================================================
// Cuenta y personajes — lado cliente
//
// El navegador habla con Supabase SOLO para dos cosas:
//   1. Iniciar sesión (enlace mágico al correo).
//   2. Leer, crear y borrar los personajes de esa cuenta.
//
// Todo lo demás —posición, carga, casco— lo escribe únicamente el servidor
// del juego. Las reglas de seguridad de la base de datos lo imponen: aunque
// alguien modificara este archivo, la base rechazaría cualquier intento de
// escribir en el estado de una nave desde el navegador.
//
// La clave de abajo es PÚBLICA por diseño. No es un descuido: Supabase la
// llama "publicable" precisamente porque está pensada para ir en el código
// del navegador. Lo que protege los datos no es esconderla, son las reglas
// de seguridad por fila de la base de datos.
// ============================================================================

import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = "https://knskhiyodnlocaiwqzmj.supabase.co";
const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_1T9wyOU6DGw2pafgYgohog_uPimbmVv";

// --- Dónde se guarda la sesión --------------------------------------------
//
// La casilla "mantener sesión iniciada" decide entre dos almacenes del
// navegador:
//
//   localStorage   -> sobrevive a cerrar el navegador. La sesión sigue ahí
//                     mañana. Es el comportamiento por defecto.
//   sessionStorage -> se borra al cerrar la pestaña. Para un móvil prestado
//                     o un ordenador compartido.
//
// Se resuelve en cada lectura y escritura en vez de al arrancar, porque
// cuando se crea el cliente todavía no sabemos qué va a elegir el jugador:
// la casilla se marca justo antes de entrar.
const REMEMBER_KEY = "mmo-espacial.remember";

function isRemembering() {
  try {
    return localStorage.getItem(REMEMBER_KEY) !== "0";
  } catch {
    return true;
  }
}

export function setRemember(remember) {
  try {
    localStorage.setItem(REMEMBER_KEY, remember ? "1" : "0");
  } catch {
    /* navegador sin almacenamiento: se queda en el comportamiento por defecto */
  }
}

export function getRemember() {
  return isRemembering();
}

const sessionStore = {
  getItem: (k) => (isRemembering() ? localStorage : sessionStorage).getItem(k),
  setItem: (k, v) => (isRemembering() ? localStorage : sessionStorage).setItem(k, v),
  // Al borrar se limpian LOS DOS a propósito: si el jugador cambia la casilla
  // entre sesiones, podría quedar una sesión huérfana en el otro almacén y
  // reaparecer sola más tarde.
  removeItem: (k) => {
    try { localStorage.removeItem(k); } catch { /* ignorado */ }
    try { sessionStorage.removeItem(k); } catch { /* ignorado */ }
  },
};

export const supabase = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
  auth: {
    storage: sessionStore,
    persistSession: true,
    autoRefreshToken: true,
    // Ya no hay enlaces por correo, así que no hay nada que leer de la URL.
    detectSessionInUrl: false,
  },
});

// ===========================================================================
// INTERRUPTOR DEL LOGIN
//
// false -> DORMIDO (estado actual, fase de pruebas).
//          No se pide correo ni contraseña. Al entrar se crea en silencio
//          una cuenta anónima: una cuenta de verdad en la base de datos,
//          pero sin correo asociado.
//
//          Esto NO es un atajo que se salte el sistema. Los personajes
//          siguen en la base, con su límite de 5, sus nombres únicos, sus
//          reglas de seguridad y su progreso guardado. Lo único que
//          desaparece es la pantalla de identificación. Así las pruebas
//          ejercitan exactamente el mismo camino que usará el juego final,
//          en vez de un camino paralelo que habría que volver a probar
//          entero el día que se active el login.
//
// true  -> DESPIERTO. Pantalla de correo y contraseña.
//
// Para despertarlo: cambiar a true. Nada más.
//
// Advertencia sobre las cuentas anónimas: viven en el navegador. Si se
// borran los datos del navegador, esa cuenta y sus personajes quedan
// huérfanos e irrecuperables. Es aceptable en pruebas y es exactamente
// por lo que el login existe.
// ===========================================================================
export const LOGIN_ENABLED = false;

export const MAX_CHARACTERS = 5;
export const MIN_PASSWORD = 6;

// --- Sesión ----------------------------------------------------------------

export async function getSession() {
  const { data } = await supabase.auth.getSession();
  return data?.session || null;
}

// Los errores de Supabase vienen en inglés y con redacción técnica. Se
// traducen a códigos propios para que la interfaz los muestre en el idioma
// del jugador. Se comprueba también el código cuando existe, porque el texto
// puede cambiar entre versiones sin previo aviso.
function traducirError(error) {
  const msg = (error?.message || "").toLowerCase();
  const code = error?.code || "";

  if (code === "invalid_credentials" || msg.includes("invalid login credentials")) {
    return new Error("CREDENCIALES");
  }
  if (code === "user_already_exists" || msg.includes("already registered")) {
    return new Error("CUENTA_EXISTE");
  }
  if (code === "weak_password" || msg.includes("password should be at least")) {
    return new Error("PASSWORD_CORTA");
  }
  if (msg.includes("email not confirmed")) {
    return new Error("SIN_CONFIRMAR");
  }
  if (code === "over_request_rate_limit" || msg.includes("rate limit")) {
    return new Error("DEMASIADOS_INTENTOS");
  }
  if (msg.includes("failed to fetch") || msg.includes("network")) {
    return new Error("SIN_CONEXION");
  }
  return new Error("DESCONOCIDO");
}

export async function signIn(email, password) {
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) throw traducirError(error);
}

// Crear cuenta. Con la confirmación por correo desactivada en el panel de
// Supabase, esto deja la sesión ya iniciada y se entra directo.
//
// Si la confirmación estuviera activada, Supabase devuelve un usuario SIN
// sesión y el jugador se quedaría mirando la pantalla sin entender nada; por
// eso ese caso se detecta y se avisa explícitamente.
export async function signUp(email, password) {
  const { data, error } = await supabase.auth.signUp({ email, password });
  if (error) throw traducirError(error);
  if (!data?.session) throw new Error("REQUIERE_CONFIRMACION");
}

export async function signOut() {
  await supabase.auth.signOut();
}

// Devuelve una sesión utilizable, creando una anónima si el login está
// dormido y todavía no hay ninguna.
//
// Si las sesiones anónimas no están habilitadas en el panel de Supabase,
// esto devuelve null en vez de reventar, y el juego enseña la pantalla de
// login normal. Degradar a "pide contraseña" es mucho mejor que degradar a
// "pantalla en blanco".
export async function ensureSession() {
  const existing = await getSession();
  if (existing) return existing;
  if (LOGIN_ENABLED) return null;

  const { data, error } = await supabase.auth.signInAnonymously();
  if (error || !data?.session) {
    console.warn(
      "[cuenta] No se pudo crear sesión anónima. Actívalas en Supabase " +
        "(Authentication → Sign In / Providers → Anonymous sign-ins) " +
        "o pon LOGIN_ENABLED = true.",
      error?.message || ""
    );
    return null;
  }
  return data.session;
}

// --- Personajes ------------------------------------------------------------

export async function listCharacters() {
  const { data, error } = await supabase
    .from("characters")
    .select("id, name, created_at, last_played_at")
    .order("created_at", { ascending: true });
  if (error) throw error;
  return data || [];
}

export async function createCharacter(name) {
  const { data: sessionData } = await supabase.auth.getSession();
  const userId = sessionData?.session?.user?.id;
  if (!userId) throw new Error("Sin sesión");

  const { data, error } = await supabase
    .from("characters")
    .insert({ name, user_id: userId })
    .select("id, name, created_at")
    .single();

  if (error) {
    // Se traducen los errores de la base a algo que un jugador entienda.
    // El código 23505 es "ya existe una fila igual": aquí solo puede
    // significar que el nombre está cogido, porque es el único índice único.
    if (error.code === "23505") throw new Error("NOMBRE_OCUPADO");
    // 23514 es "check_violation", el codigo con el que el disparador de la
    // base rechaza el sexto personaje. Se comprueba el CODIGO y no el texto
    // del mensaje: el texto puede cambiar de idioma o de redaccion y el
    // aviso dejaria de reconocerse en silencio.
    if (error.code === "23514" || /imite de 5/i.test(error.message || "")) {
      throw new Error("LIMITE");
    }
    throw error;
  }
  return data;
}

export async function deleteCharacter(id) {
  const { error } = await supabase.from("characters").delete().eq("id", id);
  if (error) throw error;
}
