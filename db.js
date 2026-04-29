const sqlite3 = require('sqlite3').verbose();
const { Pool } = require('pg');
const path = require('path');

const isProduction = process.env.DATABASE_URL ? true : false;
let db;
let pgPool;

if (isProduction) {
    // Configuração para PostgreSQL (Produção/Web)
    pgPool = new Pool({
        connectionString: process.env.DATABASE_URL,
        ssl: {
            rejectUnauthorized: false // Necessário para Render/Heroku
        }
    });
    console.log('Usando banco de dados PostgreSQL (Produção).');
    createTablesPG();
} else {
    // Configuração para SQLite (Local)
    const DB_PATH = path.join(__dirname, 'atendesk.db');
    db = new sqlite3.Database(DB_PATH, (err) => {
        if (err) {
            console.error('Erro ao conectar ao SQLite:', err.message);
        } else {
            console.log('Conectado ao banco de dados SQLite (Local).');
            createTablesSQLite();
        }
    });
}

// --- TABELAS SQLITE ---
function createTablesSQLite() {
    db.serialize(() => {
        db.run(`CREATE TABLE IF NOT EXISTS visitantes (
            cpf TEXT PRIMARY KEY,
            nome TEXT NOT NULL,
            contato TEXT,
            foto TEXT,
            ultima_visita DATETIME DEFAULT CURRENT_TIMESTAMP
        )`);
        db.run(`CREATE TABLE IF NOT EXISTS cartorios (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            nome TEXT NOT NULL,
            imagem TEXT,
            senha TEXT,
            status TEXT DEFAULT 'ativo'
        )`);
        db.run(`CREATE TABLE IF NOT EXISTS comarcas (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            nome TEXT NOT NULL,
            cidade TEXT
        )`);
        db.run(`CREATE TABLE IF NOT EXISTS locais (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            nome TEXT NOT NULL
        )`);
        db.run(`CREATE TABLE IF NOT EXISTS ponto (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            visitante_cpf TEXT,
            nome TEXT,
            tipo TEXT,
            data TEXT,
            hora TEXT,
            FOREIGN KEY (visitante_cpf) REFERENCES visitantes (cpf)
        )`);
        db.run(`CREATE TABLE IF NOT EXISTS fila (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            nome TEXT NOT NULL,
            cpf TEXT NOT NULL,
            contato TEXT,
            cartorio_id INTEGER,
            nome_cartorio TEXT,
            status TEXT DEFAULT 'aguardando',
            hora_entrada DATETIME DEFAULT CURRENT_TIMESTAMP,
            hora_chamada DATETIME,
            hora_atendimento DATETIME,
            hora_saida DATETIME,
            foto TEXT,
            origem_transferencia TEXT,
            tipo_visita TEXT,
            nome_reu TEXT,
            comarca TEXT,
            FOREIGN KEY (cartorio_id) REFERENCES cartorios (id),
            FOREIGN KEY (cpf) REFERENCES visitantes (cpf)
        )`);
        db.run(`CREATE TABLE IF NOT EXISTS tipos_visita (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            nome TEXT NOT NULL UNIQUE
        )`);

        // Dados padrão
        db.get("SELECT COUNT(*) as count FROM tipos_visita", (err, row) => {
            if (row && row.count === 0) {
                const defaultTipos = ['VISITANTE', 'ADVOGADO', 'PARTE', 'OUTROS'];
                const stmt = db.prepare("INSERT INTO tipos_visita (nome) VALUES (?)");
                defaultTipos.forEach(t => stmt.run(t));
                stmt.finalize();
            }
        });
        db.get("SELECT COUNT(*) as count FROM cartorios", (err, row) => {
            if (row && row.count === 0) {
                const defaultCartorios = [
                    ['Cartório de Registro Civil', '02.png'],
                    ['Cartório de Notas', '03.png'],
                    ['Cartório de Imóveis', '04.png']
                ];
                const stmt = db.prepare("INSERT INTO cartorios (nome, imagem) VALUES (?, ?)");
                defaultCartorios.forEach(c => stmt.run(c));
                stmt.finalize();
            }
        });
    });
}

// --- TABELAS POSTGRESQL ---
async function createTablesPG() {
    const client = await pgPool.connect();
    try {
        await client.query(`CREATE TABLE IF NOT EXISTS visitantes (
            cpf TEXT PRIMARY KEY,
            nome TEXT NOT NULL,
            contato TEXT,
            foto TEXT,
            ultima_visita TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )`);
        await client.query(`CREATE TABLE IF NOT EXISTS cartorios (
            id SERIAL PRIMARY KEY,
            nome TEXT NOT NULL,
            imagem TEXT,
            senha TEXT,
            status TEXT DEFAULT 'ativo'
        )`);
        await client.query(`CREATE TABLE IF NOT EXISTS comarcas (
            id SERIAL PRIMARY KEY,
            nome TEXT NOT NULL,
            cidade TEXT
        )`);
        await client.query(`CREATE TABLE IF NOT EXISTS locais (
            id SERIAL PRIMARY KEY,
            nome TEXT NOT NULL
        )`);
        await client.query(`CREATE TABLE IF NOT EXISTS ponto (
            id SERIAL PRIMARY KEY,
            visitante_cpf TEXT,
            nome TEXT,
            tipo TEXT,
            data TEXT,
            hora TEXT,
            FOREIGN KEY (visitante_cpf) REFERENCES visitantes (cpf)
        )`);
        await client.query(`CREATE TABLE IF NOT EXISTS fila (
            id SERIAL PRIMARY KEY,
            nome TEXT NOT NULL,
            cpf TEXT NOT NULL,
            contato TEXT,
            cartorio_id INTEGER,
            nome_cartorio TEXT,
            status TEXT DEFAULT 'aguardando',
            hora_entrada TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            hora_chamada TIMESTAMP,
            hora_atendimento TIMESTAMP,
            hora_saida TIMESTAMP,
            foto TEXT,
            origem_transferencia TEXT,
            tipo_visita TEXT,
            nome_reu TEXT,
            comarca TEXT,
            FOREIGN KEY (cartorio_id) REFERENCES cartorios (id),
            FOREIGN KEY (cpf) REFERENCES visitantes (cpf)
        )`);
        await client.query(`CREATE TABLE IF NOT EXISTS tipos_visita (
            id SERIAL PRIMARY KEY,
            nome TEXT NOT NULL UNIQUE
        )`);

        // Dados padrão
        const resVisita = await client.query("SELECT COUNT(*) as count FROM tipos_visita");
        if (parseInt(resVisita.rows[0].count) === 0) {
            const defaultTipos = ['VISITANTE', 'ADVOGADO', 'PARTE', 'OUTROS'];
            for (const t of defaultTipos) {
                await client.query("INSERT INTO tipos_visita (nome) VALUES ($1)", [t]);
            }
        }
        const resCartorio = await client.query("SELECT COUNT(*) as count FROM cartorios");
        if (parseInt(resCartorio.rows[0].count) === 0) {
            const defaultCartorios = [
                ['Cartório de Registro Civil', '02.png'],
                ['Cartório de Notas', '03.png'],
                ['Cartório de Imóveis', '04.png']
            ];
            for (const c of defaultCartorios) {
                await client.query("INSERT INTO cartorios (nome, imagem) VALUES ($1, $2)", c);
            }
        }
    } finally {
        client.release();
    }
}

// --- WRAPPERS COMPATÍVEIS ---
const query = async (sql, params = []) => {
    if (isProduction) {
        // Converter ? para $1, $2... para PostgreSQL
        let pgSql = sql;
        params.forEach((_, i) => {
            pgSql = pgSql.replace('?', `$${i + 1}`);
        });
        const res = await pgPool.query(pgSql, params);
        return res.rows;
    } else {
        return new Promise((resolve, reject) => {
            db.all(sql, params, (err, rows) => {
                if (err) reject(err);
                else resolve(rows);
            });
        });
    }
};

const get = async (sql, params = []) => {
    if (isProduction) {
        let pgSql = sql;
        params.forEach((_, i) => {
            pgSql = pgSql.replace('?', `$${i + 1}`);
        });
        const res = await pgPool.query(pgSql, params);
        return res.rows[0];
    } else {
        return new Promise((resolve, reject) => {
            db.get(sql, params, (err, row) => {
                if (err) reject(err);
                else resolve(row);
            });
        });
    }
};

const run = async (sql, params = []) => {
    if (isProduction) {
        let pgSql = sql;
        // Converter ? para $1, $2...
        params.forEach((_, i) => {
            pgSql = pgSql.replace('?', `$${i + 1}`);
        });

        // Se for INSERT, adicionar RETURNING id para obter o lastID
        if (pgSql.trim().toUpperCase().startsWith('INSERT')) {
            pgSql += ' RETURNING id';
        }

        const res = await pgPool.query(pgSql, params);
        return { 
            id: res.rows[0] ? res.rows[0].id : null, 
            changes: res.rowCount 
        };
    } else {
        return new Promise((resolve, reject) => {
            db.run(sql, params, function(err) {
                if (err) reject(err);
                else resolve({ id: this.lastID, changes: this.changes });
            });
        });
    }
};

module.exports = {
    query,
    get,
    run,
    isProduction
};
