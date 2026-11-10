
import { empleadoAutenticado } from "../../../lib/autenticacion.js";

function respuesta(datos, estado = 200) {
  return Response.json(datos, {
    status: estado,
    headers: { "Cache-Control": "no-store" }
  });
}

export async function onRequestPost({ request, env }) {
  // Rechazar solicitudes de otros sitios.
  const origen = request.headers.get("Origin");

  if (origen !== new URL(request.url).origin) {
    return respuesta({ error: "Origen no autorizado" }, 403);
  }

  // Solo empleados autenticados.
  const empleado = await empleadoAutenticado(env, request);

  if (!empleado) {
    return respuesta({ error: "Sesion no autorizada" }, 401);
  }

  if (!request.headers.get("Content-Type")?.toLowerCase()
      .startsWith("application/json")) {
    return respuesta({ error: "Formato no admitido" }, 415);
  }

  let datos;

  try {
    datos = await request.json();
  } catch {
    return respuesta({ error: "JSON invalido" }, 400);
  }

  const telefono = String(datos?.telefono ?? "").trim();
  const claveOperacion = String(
    datos?.clave_operacion ?? ""
  ).trim();

  if (!/^[0-9]{8}$/.test(telefono)) {
    return respuesta({
      error: "El telefono debe tener 8 digitos"
    }, 400);
  }

  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
      .test(claveOperacion)) {
    return respuesta({
      error: "Identificador de operacion invalido"
    }, 400);
  }

  const nuevoMovimientoId = crypto.randomUUID();

  try {
    // Comprobar si esta solicitud ya fue procesada.
    const anterior = await env.DB.prepare(`
      SELECT m.id, c.telefono, m.empleado_id
      FROM movimientos m
      JOIN clientes c ON c.id = m.cliente_id
      WHERE m.clave_operacion = ?
    `).bind(claveOperacion).first();

    if (anterior && (
      anterior.telefono !== telefono ||
      anterior.empleado_id !== empleado.id
    )) {
      return respuesta({
        error: "Identificador ya utilizado en otra operacion"
      }, 409);
    }

    if (!anterior) {
      // Ambas operaciones se ejecutan en una transaccion.
      try {
        await env.DB.batch([
          env.DB.prepare(`
            INSERT INTO clientes (id, telefono, qr_id)
            VALUES (?, ?, ?)
            ON CONFLICT(telefono) DO NOTHING
          `).bind(
            crypto.randomUUID(),
            telefono,
            crypto.randomUUID()
          ),

          env.DB.prepare(`
            INSERT INTO movimientos (
              id, cliente_id, empleado_id,
              tipo, sellos, clave_operacion
            )
            SELECT ?, id, ?, 'compra', 1, ?
            FROM clientes
            WHERE telefono = ?
          `).bind(
            nuevoMovimientoId,
            empleado.id,
            claveOperacion,
            telefono
          )
        ]);
      } catch (error) {
        // Un reintento concurrente puede causar una
        // colision de clave. Se verifica mas abajo.
        console.error("Registro no insertado:", error);
      }
    }

    const movimiento = await env.DB.prepare(`
      SELECT m.id, m.cliente_id, m.empleado_id,
             m.tipo, c.telefono
      FROM movimientos m
      JOIN clientes c ON c.id = m.cliente_id
      WHERE m.clave_operacion = ?
    `).bind(claveOperacion).first();

    if (!movimiento) {
      return respuesta({
        error: "No se pudo confirmar el registro"
      }, 503);
    }

    if (
      movimiento.telefono !== telefono ||
      movimiento.empleado_id !== empleado.id ||
      movimiento.tipo !== "compra"
    ) {
      return respuesta({
        error: "Conflicto de identificador"
      }, 409);
    }

    const saldo = await env.DB.prepare(`
      SELECT COALESCE(SUM(sellos), 0) AS total
      FROM movimientos
      WHERE cliente_id = ?
    `).bind(movimiento.cliente_id).first();

    const repetido = movimiento.id !== nuevoMovimientoId;

    return respuesta({
      registrado: !repetido,
      repetido,
      telefono,
      sellos_agregados: repetido ? 0 : 1,
      saldo_actual: Number(saldo?.total ?? 0)
    });

  } catch (error) {
    console.error("Error al registrar sello:", error);

    return respuesta({
      error: "No se pudo completar la operacion"
    }, 503);
  }
}
