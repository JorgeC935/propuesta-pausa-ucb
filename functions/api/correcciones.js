
import {
  empleadoAutenticado
} from "../../lib/autenticacion.js";

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function responder(datos, status = 200) {
  return Response.json(datos, {
    status,
    headers: { "Cache-Control": "no-store" }
  });
}

export async function onRequestPost({ request, env }) {
  if (request.headers.get("Origin") !== new URL(request.url).origin) {
    return responder({ error: "Origen no autorizado" }, 403);
  }

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

  let datos;

  try {
    const texto = await request.text();

    if (texto.length > 1500) {
      return responder({ error: "Solicitud demasiado grande" }, 413);
    }

    datos = JSON.parse(texto);

    if (!datos || typeof datos !== "object" ||
        Array.isArray(datos)) {
      return responder({ error: "Datos invalidos" }, 400);
    }
  } catch {
    return responder({ error: "JSON invalido" }, 400);
  }

  const movimientoId = String(datos.movimiento_id ?? "");
  const clave = String(datos.clave_operacion ?? "");
  const tipo = String(datos.tipo ?? "");
  const motivo = String(datos.motivo ?? "").trim();

  const destino = tipo === "trasladar"
    ? String(datos.telefono_destino ?? "").trim()
    : null;

  if (!UUID.test(movimientoId) || !UUID.test(clave)) {
    return responder({ error: "Identificador invalido" }, 400);
  }

  if (!["anular", "trasladar"].includes(tipo)) {
    return responder({ error: "Correccion invalida" }, 400);
  }

  if (motivo.length < 3 || motivo.length > 200) {
    return responder({
      error: "Indica un motivo de 3 a 200 caracteres"
    }, 400);
  }

  if (tipo === "trasladar" && !/^[0-9]{8}$/.test(destino)) {
    return responder({
      error: "El nuevo telefono debe tener ocho digitos"
    }, 400);
  }

  const correccionId = crypto.randomUUID();
  const reversoId = crypto.randomUUID();
  const creditoId = tipo === "trasladar"
    ? crypto.randomUUID()
    : null;

  try {
    // El INSERT inicial decide si se permite corregir.
    // Si no inserta ninguna fila, los pasos siguientes
    // tampoco realizan cambios.
    const insertarCorreccion = env.DB.prepare(`
      INSERT INTO correcciones (
        id,
        clave_operacion,
        movimiento_original_id,
        empleado_id,
        tipo,
        telefono_destino,
        motivo,
        movimiento_reverso_id,
        movimiento_credito_id
      )

      SELECT ?, ?, m.id, ?, ?, ?, ?, ?, ?
      FROM movimientos m
      JOIN clientes c ON c.id = m.cliente_id

      WHERE m.id = ?
        AND m.tipo = 'compra'
        AND m.sellos = 1

        AND (
          ? = 'administrador'
          OR (
            m.empleado_id = ?
            AND m.creado_en >= unixepoch() - 900
          )
        )

        AND COALESCE((
          SELECT SUM(s.sellos)
          FROM movimientos s
          WHERE s.cliente_id = m.cliente_id
        ), 0) >= 1

        AND (
          ? = 'anular'
          OR ? <> c.telefono
        )

        AND NOT EXISTS (
          SELECT 1 FROM correcciones anterior
          WHERE anterior.movimiento_original_id = m.id
        )

      ON CONFLICT DO NOTHING
    `).bind(
      correccionId,
      clave,
      empleado.id,
      tipo,
      destino,
      motivo,
      reversoId,
      creditoId,
      movimientoId,
      empleado.rol,
      empleado.id,
      tipo,
      destino
    );

    // Crear el cliente destino solamente si
    // el traslado fue autorizado.
    const crearDestino = env.DB.prepare(`
      INSERT INTO clientes (id, telefono, qr_id)

      SELECT ?, cor.telefono_destino, ?
      FROM correcciones cor
      WHERE cor.id = ?
        AND cor.tipo = 'trasladar'

      ON CONFLICT(telefono) DO NOTHING
    `).bind(
      crypto.randomUUID(),
      crypto.randomUUID(),
      correccionId
    );

    // Reversar el sello original.
    const quitarSello = env.DB.prepare(`
      INSERT INTO movimientos (
        id,
        cliente_id,
        empleado_id,
        tipo,
        sellos,
        clave_operacion,
        observacion
      )

      SELECT
        cor.movimiento_reverso_id,
        original.cliente_id,
        cor.empleado_id,
        'ajuste',
        -1,
        cor.clave_operacion || ':reverso',
        'Correccion de ' || original.id

      FROM correcciones cor
      JOIN movimientos original
        ON original.id = cor.movimiento_original_id

      WHERE cor.id = ?
    `).bind(correccionId);

    // Acreditar al numero correcto, solo
    // cuando la operacion es un traslado.
    const acreditarDestino = env.DB.prepare(`
      INSERT INTO movimientos (
        id,
        cliente_id,
        empleado_id,
        tipo,
        sellos,
        clave_operacion,
        observacion
      )

      SELECT
        cor.movimiento_credito_id,
        destino.id,
        cor.empleado_id,
        'ajuste',
        1,
        cor.clave_operacion || ':credito',
        'Traslado de ' || cor.movimiento_original_id

      FROM correcciones cor
      JOIN clientes destino
        ON destino.telefono = cor.telefono_destino

      WHERE cor.id = ?
        AND cor.tipo = 'trasladar'
    `).bind(correccionId);

    await env.DB.batch([
      insertarCorreccion,
      crearDestino,
      quitarSello,
      acreditarDestino
    ]);

    // Comprobar el resultado real, incluidos
    // los reintentos de una solicitud anterior.
    const registro = await env.DB.prepare(`
      SELECT
        cor.*,
        original.cliente_id AS cliente_origen
      FROM correcciones cor
      JOIN movimientos original
        ON original.id = cor.movimiento_original_id
      WHERE cor.clave_operacion = ?
    `).bind(clave).first();

    if (!registro) {
      return responder({
        error:
          "No se puede corregir este movimiento. " +
          "Puede estar fuera del plazo, ya corregido " +
          "o tener sellos insuficientes."
      }, 409);
    }

    if (
      registro.movimiento_original_id !== movimientoId ||
      registro.empleado_id !== empleado.id ||
      registro.tipo !== tipo ||
      registro.telefono_destino !== destino ||
      registro.motivo !== motivo
    ) {
      return responder({
        error: "Identificador utilizado en otra operacion"
      }, 409);
    }

    const saldoOrigen = await env.DB.prepare(`
      SELECT COALESCE(SUM(sellos), 0) AS saldo
      FROM movimientos
      WHERE cliente_id = ?
    `).bind(registro.cliente_origen).first();

    return responder({
      corregido: registro.id === correccionId,
      repetido: registro.id !== correccionId,
      tipo,
      saldo_origen: Number(saldoOrigen?.saldo ?? 0),
      telefono_destino: destino
    });

  } catch (error) {
    console.error("Error corrigiendo movimiento:", error);

    return responder({
      error: "No se pudo confirmar la correccion"
    }, 503);
  }
}
