
-- PAUSA V2
-- Migración 1: estructura inicial

-- Clientes de la cafetería
CREATE TABLE IF NOT EXISTS clientes (
    id TEXT PRIMARY KEY,
    telefono TEXT NOT NULL UNIQUE
        CHECK (
            length(telefono) = 8
            AND telefono NOT GLOB '*[^0-9]*'
        ),
    qr_id TEXT NOT NULL UNIQUE,
    creado_en INTEGER NOT NULL DEFAULT (unixepoch())
);

-- Empleados y administradores
CREATE TABLE IF NOT EXISTS empleados (
    id TEXT PRIMARY KEY,
    usuario TEXT NOT NULL COLLATE NOCASE UNIQUE,
    contrasena_hash TEXT NOT NULL,
    rol TEXT NOT NULL
        CHECK (rol IN ('empleado', 'administrador')),
    activo INTEGER NOT NULL DEFAULT 1
        CHECK (activo IN (0, 1)),
    creado_en INTEGER NOT NULL DEFAULT (unixepoch())
);

-- Sesiones persistentes del personal
CREATE TABLE IF NOT EXISTS sesiones (
    token_hash TEXT PRIMARY KEY,
    empleado_id TEXT NOT NULL,
    expira_en INTEGER NOT NULL,
    creado_en INTEGER NOT NULL DEFAULT (unixepoch()),

    FOREIGN KEY (empleado_id)
        REFERENCES empleados(id)
        ON DELETE CASCADE
);

-- Historial de sellos y canjes
CREATE TABLE IF NOT EXISTS movimientos (
    id TEXT PRIMARY KEY,
    cliente_id TEXT NOT NULL,
    empleado_id TEXT NOT NULL,
    tipo TEXT NOT NULL
        CHECK (tipo IN ('compra', 'canje', 'ajuste')),
    sellos INTEGER NOT NULL CHECK (sellos <> 0),
    clave_operacion TEXT NOT NULL UNIQUE,
    observacion TEXT,
    creado_en INTEGER NOT NULL DEFAULT (unixepoch()),

    FOREIGN KEY (cliente_id)
        REFERENCES clientes(id),

    FOREIGN KEY (empleado_id)
        REFERENCES empleados(id)
);

-- Configuraciones editables del negocio
CREATE TABLE IF NOT EXISTS configuracion (
    clave TEXT PRIMARY KEY,
    valor TEXT NOT NULL,
    actualizado_en INTEGER NOT NULL DEFAULT (unixepoch())
);

-- Índices para consultas frecuentes
CREATE INDEX IF NOT EXISTS idx_movimientos_cliente
    ON movimientos(cliente_id, creado_en);

CREATE INDEX IF NOT EXISTS idx_sesiones_empleado
    ON sesiones(empleado_id);

-- Configuración inicial de prueba
INSERT OR IGNORE INTO configuracion (clave, valor)
VALUES ('meta_sellos', '10');

INSERT OR IGNORE INTO configuracion (clave, valor)
VALUES ('whatsapp_contacto', '');
