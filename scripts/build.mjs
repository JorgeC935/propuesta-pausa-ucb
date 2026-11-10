
import { cpSync, existsSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const raiz = fileURLToPath(new URL("../", import.meta.url));
const destino = join(raiz, "dist");

const archivos = [
  "index.html",
  "puntos.html",
  "personal.html",
  "qr.html",
  "manifest.webmanifest",
  "sw.js",
  "_routes.json",
];

const carpetas = [
  "assets",
  "maquetas",
];

// Comprobar que existen todos los archivos originales.
for (const nombre of [...archivos, ...carpetas]) {
  if (!existsSync(join(raiz, nombre))) {
    throw new Error(`No se encontró: ${nombre}`);
  }
}

// Regenerar únicamente la carpeta dist.
rmSync(destino, { recursive: true, force: true });
mkdirSync(destino, { recursive: true });

for (const archivo of archivos) {
  cpSync(join(raiz, archivo), join(destino, archivo));
}

for (const carpeta of carpetas) {
  cpSync(join(raiz, carpeta), join(destino, carpeta), {
    recursive: true,
  });
}

console.log("Pausa V2: carpeta dist preparada correctamente.");
