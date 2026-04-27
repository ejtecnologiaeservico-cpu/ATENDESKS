const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');

const DB_PATH = path.join(__dirname, 'atendesk.db');

// Inicializar banco de dados
const db = new sqlite3.Database(DB_PATH, (err) => {
    if (err) {
        console.error('Erro ao conectar ao SQLite:', err.message);
    } else {
        console.log('Conectado ao banco de dados SQLite.');
        createTables();
    }
});

function createTables() {
    db.serialize(() => {
        // Tabela de Visitantes (Para reconhecimento e histórico)
        db.run(`CREATE TABLE IF NOT EXISTS visitantes (
            cpf TEXT PRIMARY KEY,
            nome TEXT NOT NULL,
            contato TEXT,
            foto TEXT,
            ultima_visita DATETIME DEFAULT CURRENT_TIMESTAMP
        )`);

        // Tabela de Cartórios
        db.run(`CREATE TABLE IF NOT EXISTS cartorios (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            nome TEXT NOT NULL,
            imagem TEXT,
            senha TEXT,
            status TEXT DEFAULT 'ativo'
        )`);

        // Tabela de Comarcas (Migrado da Triagem)
        db.run(`CREATE TABLE IF NOT EXISTS comarcas (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            nome TEXT NOT NULL,
            cidade TEXT
        )`);

        // Tabela de Locais (Migrado da Triagem)
        db.run(`CREATE TABLE IF NOT EXISTS locais (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            nome TEXT NOT NULL
        )`);

        // Tabela de Ponto (Migrado da Triagem)
        db.run(`CREATE TABLE IF NOT EXISTS ponto (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            visitante_cpf TEXT,
            nome TEXT,
            tipo TEXT, -- entrada, saida
            data TEXT,
            hora TEXT,
            FOREIGN KEY (visitante_cpf) REFERENCES visitantes (cpf)
        )`);

        // Tabela de Fila/Atendimentos
        db.run(`CREATE TABLE IF NOT EXISTS fila (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            nome TEXT NOT NULL,
            cpf TEXT NOT NULL,
            contato TEXT,
            cartorio_id INTEGER,
            nome_cartorio TEXT,
            status TEXT DEFAULT 'aguardando', -- aguardando, chamado, em_atendimento, finalizado, transferido
            hora_entrada DATETIME DEFAULT CURRENT_TIMESTAMP,
            hora_chamada DATETIME,
            hora_atendimento DATETIME,
            hora_saida DATETIME,
            foto TEXT,
            origem_transferencia TEXT, -- Nome do cartório que transferiu
            tipo_visita TEXT, -- Migrado da Triagem
            nome_reu TEXT, -- Migrado da Triagem
            comarca TEXT, -- Migrado da Triagem
            FOREIGN KEY (cartorio_id) REFERENCES cartorios (id),
            FOREIGN KEY (cpf) REFERENCES visitantes (cpf)
        )`);

        // Tabela de Tipos de Visita
        db.run(`CREATE TABLE IF NOT EXISTS tipos_visita (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            nome TEXT NOT NULL UNIQUE
        )`);

        // Inserir tipos padrão se vazio
        db.get("SELECT COUNT(*) as count FROM tipos_visita", (err, row) => {
            if (err) {
                console.error("Erro ao verificar tipos_visita:", err.message);
                return;
            }
            if (row && row.count === 0) {
                const defaultTipos = ['VISITANTE', 'ADVOGADO', 'PARTE', 'OUTROS'];
                const stmt = db.prepare("INSERT INTO tipos_visita (nome) VALUES (?)");
                defaultTipos.forEach(t => stmt.run(t));
                stmt.finalize();
                console.log("Tipos de visita padrão inseridos.");
            }
        });

        // Inserir cartórios padrão se a tabela estiver vazia
        db.get("SELECT COUNT(*) as count FROM cartorios", (err, row) => {
            if (err) {
                console.error("Erro ao verificar cartorios:", err.message);
                return;
            }
            if (row && row.count === 0) {
                const defaultCartorios = [
                    ['Cartório de Registro Civil', '02.png'],
                    ['Cartório de Notas', '03.png'],
                    ['Cartório de Imóveis', '04.png']
                ];
                const stmt = db.prepare("INSERT INTO cartorios (nome, imagem) VALUES (?, ?)");
                defaultCartorios.forEach(c => stmt.run(c));
                stmt.finalize();
                console.log("Cartórios padrão inseridos.");
            }
        });
    });
}

// Funções utilitárias para o DB
const query = (sql, params = []) => {
    return new Promise((resolve, reject) => {
        db.all(sql, params, (err, rows) => {
            if (err) reject(err);
            else resolve(rows);
        });
    });
};

const get = (sql, params = []) => {
    return new Promise((resolve, reject) => {
        db.get(sql, params, (err, row) => {
            if (err) reject(err);
            else resolve(row);
        });
    });
};

const run = (sql, params = []) => {
    return new Promise((resolve, reject) => {
        db.run(sql, params, function(err) {
            if (err) reject(err);
            else resolve({ id: this.lastID, changes: this.changes });
        });
    });
};

module.exports = {
    query,
    get,
    run,
    db // Expor o objeto db se necessário
};
