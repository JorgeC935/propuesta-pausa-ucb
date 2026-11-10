
export async function onRequestGet({ env }) {
  try {
    const consulta = await env.DB.prepare(
      `SELECT clave, valor
       FROM configuracion
       WHERE clave IN ('whatsapp_contacto', 'meta_sellos')`
    ).all();

    const valores = Object.fromEntries(
      consulta.results.map((fila) => [fila.clave, fila.valor])
    );

    const meta = Number(valores.meta_sellos);

    return Response.json(
      {
        whatsapp_contacto: valores.whatsapp_contacto ?? "",
        meta_sellos:
          Number.isInteger(meta) && meta >= 1 && meta <= 100
            ? meta
            : 10,
      },
      {
        headers: { "Cache-Control": "no-store" },
      }
    );
  } catch (error) {
    console.error("Error consultando configuracion:", error);

    return Response.json(
      { error: "No se pudo cargar la configuracion" },
      { status: 503 }
    );
  }
}
