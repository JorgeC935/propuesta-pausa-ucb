
import {
  empleadoAutenticado
} from "../../../lib/autenticacion.js";

function responder(datos, estado = 200) {
  return Response.json(datos, {
    status: estado,
    headers: { "Cache-Control": "no-store" }
  });
}

async function buscarMovimiento(db, clave) {
  return db.prepare(`
    SELECT
      m.id,
      m.cliente_id,
      m.empleado_id,
      m.tipo,
      m.sellos,
      c.telefono
    FROM movimientos m
    JOIN clientes c ON c.id = m.cliente_id
    WHERE m.clave_operacion = ?
  `).bind(clave).first();
}

async function consultarSaldo(db, telefono) {
  const datos = await db.prepare(`
    SELECT COALESCE(SUM(m.sellos), 0) AS saldo
    FROM clientes c
    LEFT JOIN movimientos m ON m.cliente_id = c.id
    WHERE c.telefono = ?
  `).bind(telefono).first();

  return Number(datos?.saldo ?? 0);
}

export async function onRequestPost({ request, env }) {
  const origen = new URL(request.url).origin;

  if (request.headers.get("Origin") !== origen) {
    return responder({ error: "Origen no autorizado" }, 403);
  }

  try {
    const empleado = await empleadoAutenticado(env, request);

    if (!empleado) {
      return responder({ error: "Sesion no autorizada" }, 401);
    }

    if (!["empleado", "administrador"].includes(empleado.rol)) {
      return responder({ error: "Permiso denegado" }, 403);
    }

    if (!request.headers.get("Content-Type")?.toLowerCase()
        .startsWith("application/json")) {
      return responder({ error: "Formato no admitido" }, 415);
    }

    const texto = await request.text();

    if (texto.length > 1024) {
      return responder({ error: "Solicitud demasiado grande" }, 413);
    }

    let datos;

    try {
      datos = JSON.parse(texto);
    } catch {
      return responder({ error: "JSON invalido" }, 400);
    }

    const telefono = String(datos?.telefono ?? "").trim();
    const clave = String(datos?.clave_operacion ?? "").trim();

    if (!/^[0-9]{8}$/.test(telefono)) {
      return responder({ error: "Telefono invalido" }, 400);
    }

    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
        .test(clave)) {
      return responder({
        error: "Identificador de operacion invalido"
      }, 400);
    }

    const config = await env.DB.prepare(`
      SELECT valor
      FROM configuracion
      WHERE clave = 'meta_sellos'
    `).first();

    const meta = Number(config?.valor);

    if (!Number.isInteger(meta) || meta < 1 || meta > 100) {
      return responder({
        error: "Configuracion de sellos invalida"
      }, 503);
    }

    // Una sola sentencia comprueba el saldo y registra
    // el canje. Evita separar la lectura y el descuento
    // en dos solicitudes independientes.
    let insertado = false;
    let falloSQL = false;

    try {
      const resultado = await env.DB.prepare(`
        INSERT INTO movimientos (
          id,
          cliente_id,
          empleado_id,
          tipo,
          sellos,
          clave_operacion
        )
        SELECT
          ?1,
          c.id,
          ?2,
          'canje',
          -?3,
          ?4
        FROM clientes c
        WHERE c.telefono = ?5
          AND COALESCE((
            SELECT SUM(m.sellos)
            FROM movimientos m
            WHERE m.cliente_id = c.id
          ), 0) >= ?3
          AND NOT EXISTS (
            SELECT 1
            FROM movimientos anterior
            WHERE anterior.clave_operacion = ?4
          )
      `).bind(
        crypto.randomUUID(),
        empleado.id,
        meta,
        clave,
        telefono
      ).run();

      insertado = resultado.meta.changes === 1;

    } catch (error) {
      falloSQL = true;
      console.error("Error en insercion del canje:", error);
    }

    // Comprobar si la operacion quedo registrada,
    // incluyendo los casos de reintentos.
    const movimiento = await buscarMovimiento(env.DB, clave);

    if (movimiento) {
      if (
        movimiento.telefono !== telefono ||
        movimiento.empleado_id !== empleado.id ||
        movimiento.tipo !== "canje" ||
        movimiento.sellos !== -meta
      ) {
        return responder({
          error: "Identificador utilizado en otra operacion"
        }, 409);
      }

      const saldo = await consultarSaldo(env.DB, telefono);

      return responder({
        canjeado: insertado,
        repetido: !insertado,
        sellos_descontados: insertado ? meta : 0,
        saldo_actual: saldo
      });
    }

    if (falloSQL) {
      return responder({
        error: "No se pudo confirmar el canje"
      }, 503);
    }

    const saldo = await consultarSaldo(env.DB, telefono);

    return responder({
      error: "Sellos insuficientes para realizar el canje",
      saldo_actual: saldo,
      meta_sellos: meta
    }, 409);

  } catch (error) {
    console.error("Error procesando canje:", error);

    return responder({
      error: "No se pudo procesar el canje"
    }, 503);
  }
}
