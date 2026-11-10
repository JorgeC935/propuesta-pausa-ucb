
import {
  empleadoAutenticado
} from "../../../lib/autenticacion.js";

export async function onRequestGet({ request, env }) {
  const empleado = await empleadoAutenticado(env, request);

  if (!empleado) {
    return Response.json(
      { error: "Sesion no autorizada" },
      {
        status: 401,
        headers: { "Cache-Control": "no-store" }
      }
    );
  }

  return Response.json(
    {
      id: empleado.id,
      usuario: empleado.usuario,
      rol: empleado.rol
    },
    {
      headers: { "Cache-Control": "no-store" }
    }
  );
}
