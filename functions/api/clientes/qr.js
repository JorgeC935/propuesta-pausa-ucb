import { empleadoAutenticado } from "../../../lib/autenticacion.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function onRequestGet({ request, env }) {
  const encabezados = { "Cache-Control": "no-store, private" };
  try {
    const personal = await empleadoAutenticado(env, request);
    if (!personal || !["empleado", "administrador"].includes(personal.rol)) {
      return Response.json({ error: "Sesion no autorizada" }, { status: 401, headers: encabezados });
    }
    const qr = new URL(request.url).searchParams.get("codigo") || "";
    if (!UUID.test(qr)) {
      return Response.json({ error: "QR no valido" }, { status: 400, headers: encabezados });
    }
    const cliente = await env.DB.prepare(
      "SELECT telefono FROM clientes WHERE qr_id = ?"
    ).bind(qr).first();
    if (!cliente) {
      return Response.json({ error: "QR no registrado" }, { status: 404, headers: encabezados });
    }
    // El QR solo identifica al cliente, nunca registra ni autoriza canjes.
    return Response.json({ telefono: cliente.telefono }, { headers: encabezados });
  } catch (error) {
    console.error("Error al identificar QR:", error);
    return Response.json({ error: "No se pudo leer el QR" }, { status: 503, headers: encabezados });
  }
}
