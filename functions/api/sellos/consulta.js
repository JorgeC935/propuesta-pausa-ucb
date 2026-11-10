import { createHmac } from "node:crypto";
import { empleadoAutenticado } from "../../../lib/autenticacion.js";

const VENTANA = 60;
const MAX_POR_ORIGEN = 30;
const MAX_POR_ORIGEN_Y_NUMERO = 6;

function responder(datos, estado = 200, otros = {}) {
  return Response.json(datos, {
    status: estado,
    headers: {
      "Cache-Control": "no-store, private",
      "Referrer-Policy": "no-referrer",
      "X-Content-Type-Options": "nosniff",
      ...otros
    }
  });
}

function telefonoValido(telefono) {
  return typeof telefono === "string" && /^[0-9]{8}$/.test(telefono);
}

async function obtenerSaldo(db, telefono) {
  const datos = await db.prepare(`
    SELECT
      COALESCE((
        SELECT SUM(m.sellos)
        FROM clientes c
        JOIN movimientos m ON m.cliente_id = c.id
        WHERE c.telefono = ?
      ), 0) AS saldo,
      COALESCE((
        SELECT CAST(valor AS INTEGER)
        FROM configuracion
        WHERE clave = 'meta_sellos'
      ), 10) AS meta_sellos
  `).bind(telefono).first();

  const meta = Number(datos?.meta_sellos);
  return {
    saldo: Math.max(0, Number(datos?.saldo ?? 0)),
    meta_sellos: Number.isInteger(meta) && meta >= 1 && meta <= 100 ? meta : 10
  };
}

function firmar(secret, texto) {
  return createHmac("sha256", secret).update(texto).digest("hex");
}

async function incrementar(db, clave) {
  const fila = await db.prepare(`
    INSERT INTO limites_consulta_publica (clave, intentos, ventana_hasta)
    VALUES (?, 1, unixepoch() + ?)
    ON CONFLICT(clave) DO UPDATE SET
      intentos = CASE
        WHEN ventana_hasta <= unixepoch() THEN 1
        ELSE intentos + 1
      END,
      ventana_hasta = CASE
        WHEN ventana_hasta <= unixepoch() THEN unixepoch() + ?
        ELSE ventana_hasta
      END
    RETURNING intentos, ventana_hasta
  `).bind(clave, VENTANA, VENTANA).first();
  if (!fila) throw new Error("No se pudo actualizar el contador");
  return fila;
}

async function limitarConsulta(db, secret, request, telefono) {
  // El proveedor establece CF-Connecting-IP en despliegues reales.
  // Localhost utiliza un identificador compartido para pruebas.
  const ip = request.headers.get("CF-Connecting-IP") || "local-pruebas";
  const origen = firmar(secret, `origen-v1|${ip}`);
  const objetivo = firmar(secret, `numero-v1|${ip}|${telefono}`);

  const total = await incrementar(db, origen);
  let porNumero = null;
  if (Number(total.intentos) <= MAX_POR_ORIGEN) {
    porNumero = await incrementar(db, objetivo);
  }

  // Limpieza oportunista para evitar acumular contadores vencidos.
  // No guarda IP ni telefono en texto claro.
  if (Math.random() < 0.01) {
    await db.prepare(`
      DELETE FROM limites_consulta_publica
      WHERE ventana_hasta < unixepoch() - 3600
    `).run();
  }

  const excedido = Number(total.intentos) > MAX_POR_ORIGEN ||
    (porNumero && Number(porNumero.intentos) > MAX_POR_ORIGEN_Y_NUMERO);
  const vencimiento = Math.max(
    Number(total.ventana_hasta),
    Number(porNumero?.ventana_hasta ?? 0)
  );
  const segundos = Math.max(1, vencimiento - Math.floor(Date.now() / 1000));
  return { excedido: Boolean(excedido), segundos };
}

// Consulta privada del personal: conserva compatibilidad con personal.js.
export async function onRequestGet({ request, env }) {
  try {
    const empleado = await empleadoAutenticado(env, request);
    if (!empleado) {
      return responder({ error: "Sesion no autorizada" }, 401);
    }
    const telefono = new URL(request.url).searchParams.get("telefono");
    if (!telefonoValido(telefono)) {
      return responder({ error: "Introduce un numero de ocho digitos" }, 400);
    }
    return responder(await obtenerSaldo(env.DB, telefono));
  } catch (error) {
    console.error("Error consultando sellos de personal:", error);
    return responder({ error: "No se pudo consultar el saldo" }, 503);
  }
}

// Consulta anonima: POST para evitar el telefono en URL, historial y referer.
export async function onRequestPost({ request, env }) {
  if (!request.headers.get("Content-Type")?.toLowerCase()
      .startsWith("application/json")) {
    return responder({ error: "Formato no admitido" }, 415);
  }
  const origen = request.headers.get("Origin");
  if (origen && origen !== new URL(request.url).origin) {
    return responder({ error: "Origen no autorizado" }, 403);
  }
  try {
    const cuerpo = await request.text();
    if (cuerpo.length > 128) {
      return responder({ error: "Solicitud demasiado grande" }, 413);
    }
    const datos = JSON.parse(cuerpo);
    const telefono = datos?.telefono;
    if (!telefonoValido(telefono)) {
      return responder({ error: "Introduce un numero de ocho digitos" }, 400);
    }
    const secret = env.PUBLIC_RATE_SECRET;
    if (typeof secret !== "string" || secret.length < 32) {
      console.error("Falta PUBLIC_RATE_SECRET: consultas anonimas deshabilitadas");
      return responder({ error: "Consulta temporalmente no disponible" }, 503);
    }

    const limite = await limitarConsulta(env.DB, secret, request, telefono);
    if (limite.excedido) {
      return responder({
        error: "Demasiadas consultas. Vuelve a intentarlo en un minuto."
      }, 429, { "Retry-After": String(limite.segundos) });
    }

    return responder(await obtenerSaldo(env.DB, telefono));
  } catch (error) {
    if (error instanceof SyntaxError) {
      return responder({ error: "JSON invalido" }, 400);
    }
    console.error("Error consultando sellos publicos:", error);
    return responder({ error: "No se pudo consultar el saldo" }, 503);
  }
}
