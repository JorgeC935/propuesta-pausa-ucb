
function responder(datos, estado = 200) {
  return Response.json(datos, {
    status: estado,
    headers: { "Cache-Control": "no-store" }
  });
}

export async function onRequestGet({ request, env }) {
  const url = new URL(request.url);
  const telefono = url.searchParams.get("telefono") ?? "";

  if (!/^[0-9]{8}$/.test(telefono)) {
    return responder({
      error: "Introduce un numero de ocho digitos"
    }, 400);
  }

  try {
    const datos = await env.DB.prepare(`
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

    return responder({
      saldo: Number(datos?.saldo ?? 0),
      meta_sellos: Number(datos?.meta_sellos ?? 10)
    });

  } catch (error) {
    console.error("Error consultando sellos:", error);

    return responder({
      error: "No se pudo consultar el saldo"
    }, 503);
  }
}
