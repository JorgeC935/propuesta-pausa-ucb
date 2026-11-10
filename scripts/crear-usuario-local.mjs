
import {
  randomBytes,
  randomUUID,
  scryptSync
} from "node:crypto";

import {
  mkdirSync,
  writeFileSync
} from "node:fs";

const usuario = (process.env.PAUSA_USUARIO || "")
  .trim()
  .toLowerCase();

const clave = process.env.PAUSA_CLAVE || "";
const rol = process.env.PAUSA_ROL || "administrador";

if (!/^[a-z0-9._-]{3,32}$/.test(usuario)) {
  throw new Error("Usuario invalido");
}

if (clave.length < 12 || clave.length > 128) {
  throw new Error("La contrasena debe tener entre 12 y 128 caracteres");
}

if (!["empleado", "administrador"].includes(rol)) {
  throw new Error("Rol invalido");
}

const sal = randomBytes(16);

const derivado = scryptSync(clave, sal, 64, {
  N: 32768,
  r: 8,
  p: 1,
  maxmem: 64 * 1024 * 1024
});

const hash =
  `scrypt$32768$8$1$${sal.toString("hex")}$` +
  derivado.toString("hex");

const escapeSQL = (valor) =>
  String(valor).replaceAll("'", "''");

const sql = `
INSERT INTO empleados
(id, usuario, contrasena_hash, rol, activo)
VALUES (
  '${randomUUID()}',
  '${escapeSQL(usuario)}',
  '${hash}',
  '${rol}',
  1
);
`;

mkdirSync(".wrangler", { recursive: true });

writeFileSync(
  ".wrangler/alta_empleado.sql",
  sql,
  { flag: "w" }
);

console.log("SQL temporal generado correctamente.");
console.log("Usuario:", usuario);
console.log("Rol:", rol);
