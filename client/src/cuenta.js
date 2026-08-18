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

export const supabase = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY);

export const MAX_CHARACTERS = 5;

// --- Sesión ----------------------------------------------------------------

export async function getSession() {
  const { data } = await supabase.auth.getSession();
  return data?.session || null;
}

// Enlace mágico: el jugador escribe su correo, recibe un enlace y al pulsarlo
// vuelve al juego ya identificado. Sin contraseñas que recordar ni que se
// puedan filtrar.
//
// `emailRedirectTo` tiene que ser exactamente la dirección del juego, y esa
// misma dirección tiene que estar autorizada en el panel de Supabase; si no,
// el enlace lleva a una página de error.
export async function sendMagicLink(email) {
  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: { emailRedirectTo: window.location.origin + window.location.pathname },
  });
  if (error) throw error;
}

export async function signOut() {
  await supabase.auth.signOut();
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
