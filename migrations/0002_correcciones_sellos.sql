
-- PAUSA V2
-- Migracion 2: correcciones auditables

CREATE TABLE IF NOT EXISTS correcciones (
    id TEXT PRIMARY KEY,
    clave_operacion TEXT NOT NULL UNIQUE,
    movimiento_original_id TEXT NOT NULL UNIQUE,
    empleado_id TEXT NOT NULL,
    tipo TEXT NOT NULL
        CHECK (tipo IN ('anular', 'trasladar')),
    telefono_destino TEXT,
    motivo TEXT NOT NULL
        CHECK (length(trim(motivo)) BETWEEN 3 AND 200),
    movimiento_reverso_id TEXT NOT NULL UNIQUE,
    movimiento_credito_id TEXT UNIQUE,
    creado_en INTEGER NOT NULL DEFAULT (unixepoch()),

    FOREIGN KEY (movimiento_original_id)
        REFERENCES movimientos(id),

    FOREIGN KEY (empleado_id)
        REFERENCES empleados(id),

    CHECK (
        (tipo = 'anular'
          AND telefono_destino IS NULL
          AND movimiento_credito_id IS NULL)
        OR
        (tipo = 'trasladar'
          AND telefono_destino IS NOT NULL
          AND movimiento_credito_id IS NOT NULL)
    )
);

CREATE INDEX IF NOT EXISTS idx_correcciones_fecha
    ON correcciones(creado_en);

CREATE INDEX IF NOT EXISTS idx_correcciones_empleado
    ON correcciones(empleado_id);
