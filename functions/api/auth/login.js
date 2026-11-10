import { createHash, randomBytes } from "node:crypto";
import {
  verificarContrasena,
  hashToken
} from "../../../lib/autenticacion.js";

// Proteccion basica: 5 intentos incorrectos dentro de 10 minutos
// para una combinacion de usuario y origen de conexion.
// Es una capa adicional, no sustituye reglas anti-bots en Cloudflare.
const VENTANA_SEGUNDOS = 600;
const INTENTOS_MAXIMOS = 5;

function respuesta(datos, status = 200, cabeceras = {}) {
  return Response.json(datos, {
    status,
    headers: { "Cache-Control": "no-store", ...cabeceras }
  });
}

function claveDeLimite(request, usuario) {
  // En Cloudflare, CF-Connecting-IP identifica la conexion de origen.
  // En local es una simulacion y no debe considerarse seguro ante suplantacion.
  const ip = request.headers.get("CF-Connecting-IP") || "entorno-local";
  const texto = `login-v1|${usuario}|${ip}`;
  return createHash("sha256").update(texto).digest("hex");
}

async function estaBloqueado(db, clave) {
  const fila = await db.prepare(`
    SELECT bloqueado_hasta > unixepoch() AS bloqueado
    FROM intentos_login
    WHERE clave = ?
  `).bind(clave).first();

  return Number(fila?.bloqueado ?? 0) === 1;
}

async function registrarFallo(db, clave) {
  // UPSERT atomico: evita perder incrementos si dos solicitudes
  // incorrectas llegan simultaneamente.
  const fila = await db.prepare(`
    INSERT INTO intentos_login (
      clave, intentos, ventana_hasta, bloqueado_hasta
    ) VALUES (?, 1, unixepoch() + ?, 0)

    ON CONFLICT(clave) DO UPDATE SET
      bloqueado_hasta = CASE
        WHEN intentos_login.ventana_hasta <= unixepoch()
          THEN 0
        WHEN intentos_login.intentos >= ? - 1
          THEN unixepoch() + ?
        ELSE intentos_login.bloqueado_hasta
      END,
      intentos = CASE
        WHEN intentos_login.ventana_hasta <= unixepoch()
          THEN 1
        ELSE intentos_login.intentos + 1
      END,
      ventana_hasta = CASE
        WHEN intentos_login.ventana_hasta <= unixepoch()
          THEN unixepoch() + ?
        ELSE intentos_login.ventana_hasta
      END

    RETURNING bloqueado_hasta > unixepoch() AS bloqueado
  `).bind(
    clave,
    VENTANA_SEGUNDOS,
    INTENTOS_MAXIMOS,
    VENTANA_SEGUNDOS,
    VENTANA_SEGUNDOS
  ).first();

  return Number(fila?.bloqueado ?? 0) === 1;
}

export async function onRequestPost({ request, env }) {
  const origen = request.headers.get("Origin");

  if (origen && origen !== new URL(request.url).origin) {
    return respuesta({ error: "Origen no autorizado" }, 403);
  }

  if (!request.headers.get("Content-Type")?.toLowerCase()
    .startsWith("application/json")) {
    return respuesta({ error: "Formato no admitido" }, 415);
  }

  try {
    const texto = await request.text();
    if (texto.length > 2048) {
      return respuesta({ error: "Solicitud demasiado grande" }, 413);
    }

    let datos;
    try {
      datos = JSON.parse(texto);
    } catch {
      return respuesta({ error: "JSON invalido" }, 400);
    }

    if (!datos || typeof datos !== "object" || Array.isArray(datos)) {
      return respuesta({ error: "Datos invalidos" }, 400);
    }

    const usuario = String(datos.usuario ?? "")
      .trim().toLowerCase();
    const contrasena = typeof datos.contrasena === "string"
      ? datos.contrasena : "";

    // Un usuario malformado no se consulta ni provoca hash costoso.
    if (!/^[a-z0-9._-]{3,32}$/.test(usuario)) {
      return respuesta({ error: "Credenciales incorrectas" }, 401);
    }

    const claveLimite = claveDeLimite(request, usuario);

    if (await estaBloqueado(env.DB, claveLimite)) {
      return respuesta(
        { error: "Demasiados intentos. Prueba nuevamente en unos minutos." },
        429,
        { "Retry-After": String(VENTANA_SEGUNDOS) }
      );
    }

    const formatoClaveValido =
      contrasena.length >= 12 && contrasena.length <= 128;

    const empleado = formatoClaveValido
      ? await env.DB.prepare(`
          SELECT id, usuario, contrasena_hash, rol, activo
          FROM empleados
          WHERE usuario = ?
        `).bind(usuario).first()
      : null;

    const accesoCorrecto = Boolean(
      empleado &&
      empleado.activo === 1 &&
      await verificarContrasena(contrasena, empleado.contrasena_hash)
    );

    if (!accesoCorrecto) {
      const bloqueado = await registrarFallo(env.DB, claveLimite);
      return bloqueado
        ? respuesta(
            { error: "Demasiados intentos. Prueba nuevamente en unos minutos." },
            429,
            { "Retry-After": String(VENTANA_SEGUNDOS) }
          )
        : respuesta({ error: "Credenciales incorrectas" }, 401);
    }

    // Solo elimina el contador de la combinacion que ha iniciado sesion.
    await env.DB.prepare(
      "DELETE FROM intentos_login WHERE clave = ?"
    ).bind(claveLimite).run();

    const token = randomBytes(32).toString("hex");
    const expira = Math.floor(Date.now() / 1000) + 30 * 86400;

    await env.DB.prepare(`
      INSERT INTO sesiones (token_hash, empleado_id, expira_en)
      VALUES (?, ?, ?)
    `).bind(hashToken(token), empleado.id, expira).run();

    const seguro = new URL(request.url).protocol === "https:"
      ? "; Secure" : "";

    const cookie =
      `pausa_sesion=${token}; Path=/; Max-Age=2592000; ` +
      `HttpOnly; SameSite=Strict${seguro}`;

    return respuesta(
      { usuario: empleado.usuario, rol: empleado.rol },
      200,
      { "Set-Cookie": cookie }
    );
  } catch (error) {
    console.error("Error de autenticacion:", error);
    return respuesta({ error: "No se pudo iniciar sesion" }, 500);
  }
}
