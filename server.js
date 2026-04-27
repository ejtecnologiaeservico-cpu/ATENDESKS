const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const path = require('path');
const db = require('./db');
const PDFDocument = require('pdfkit');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json({ limit: '50mb' }));

// Servir arquivos estáticos da pasta 'public'
app.use(express.static(path.join(__dirname)));
app.use('/public', express.static(path.join(__dirname, 'public')));
app.use('/icon', express.static(path.join(__dirname, 'icones cartorios')));
app.use('/icones', express.static(path.join(__dirname, 'icones cartorios')));

// Servir o index.html da raiz
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

const server = http.createServer(app);
const io = new Server(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    }
});

// --- API ROUTES ---

// Pegar todo o estado inicial para os clientes
app.get('/api/data', async (req, res) => {
    try {
        const cartorios = await db.query("SELECT * FROM cartorios WHERE status = 'ativo'");
        const fila = await db.query("SELECT * FROM fila WHERE status IN ('aguardando', 'chamado', 'em_atendimento') ORDER BY hora_entrada ASC");
        const ultimaChamada = await db.get("SELECT * FROM fila WHERE status = 'chamado' ORDER BY hora_chamada DESC LIMIT 1");
        const historicoChamadas = await db.query("SELECT * FROM fila WHERE status IN ('chamado', 'em_atendimento', 'finalizado') ORDER BY hora_chamada DESC LIMIT 6");
        
        res.json({
            cartorios,
            fila,
            ultimaChamada,
            historicoChamadas
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Gerenciar Cartórios
app.get('/api/cartorios', async (req, res) => {
    try {
        const cartorios = await db.query("SELECT * FROM cartorios WHERE status = 'ativo'");
        res.json(cartorios);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/cartorios', async (req, res) => {
    try {
        const { nome, imagem } = req.body;
        const result = await db.run("INSERT INTO cartorios (nome, imagem) VALUES (?, ?)", [nome, imagem]);
        const cartorios = await db.query("SELECT * FROM cartorios WHERE status = 'ativo'");
        io.emit('CARTORIOS_ATUALIZADOS', cartorios);
        res.status(201).json({ id: result.id, nome, imagem });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.delete('/api/cartorios/:id', async (req, res) => {
    try {
        const id = parseInt(req.params.id);
        await db.run("UPDATE cartorios SET status = 'inativo' WHERE id = ?", [id]);
        const cartorios = await db.query("SELECT * FROM cartorios WHERE status = 'ativo'");
        io.emit('CARTORIOS_ATUALIZADOS', cartorios);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.put('/api/cartorios/:id', async (req, res) => {
    try {
        const id = parseInt(req.params.id);
        const { nome, imagem, senha } = req.body;
        
        let sql = "UPDATE cartorios SET nome = ?, imagem = ? WHERE id = ?";
        let params = [nome, imagem, id];
        
        if (senha) {
            sql = "UPDATE cartorios SET nome = ?, imagem = ?, senha = ? WHERE id = ?";
            params = [nome, imagem, senha, id];
        }

        await db.run(sql, params);
        const cartorios = await db.query("SELECT * FROM cartorios WHERE status = 'ativo'");
        io.emit('CARTORIOS_ATUALIZADOS', cartorios);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Gerenciar Fila / Triagem
app.get('/api/fila', async (req, res) => {
    try {
        const fila = await db.query("SELECT * FROM fila WHERE status IN ('aguardando', 'chamado', 'em_atendimento') ORDER BY hora_entrada ASC");
        res.json(fila);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Buscar Visitante por CPF (Para retorno rápido)
app.get('/api/visitante/:cpf', async (req, res) => {
    try {
        const visitante = await db.get("SELECT * FROM visitantes WHERE cpf = ?", [req.params.cpf]);
        if (visitante) {
            res.json(visitante);
        } else {
            res.status(404).json({ error: "Visitante não encontrado" });
        }
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Rota de Triagem (Portaria)
app.post('/api/triagem', async (req, res) => {
    const { nome, cpf, contato, cartorioId, nomeCartorio, foto, tipoVisita, nomeReu, comarca } = req.body;
    
    try {
        // Verificar se a pessoa já está na fila ativa
        const jaNaFila = await db.get("SELECT id FROM fila WHERE cpf = ? AND status IN ('aguardando', 'chamado', 'em_atendimento')", [cpf]);
        if (jaNaFila) {
            return res.status(400).json({ error: "Pessoa já está na fila de atendimento." });
        }

        // Upsert no cadastro de visitantes
        const visitanteExistente = await db.get("SELECT cpf FROM visitantes WHERE cpf = ?", [cpf]);
        if (visitanteExistente) {
            await db.run(
                "UPDATE visitantes SET nome = ?, contato = ?, foto = ?, ultima_visita = CURRENT_TIMESTAMP WHERE cpf = ?",
                [nome, contato, foto, cpf]
            );
        } else {
            await db.run(
                "INSERT INTO visitantes (cpf, nome, contato, foto) VALUES (?, ?, ?, ?)",
                [cpf, nome, contato, foto]
            );
        }

        // Inserir na fila com campos extras da triagem
        const result = await db.run(
            "INSERT INTO fila (nome, cpf, contato, cartorio_id, nome_cartorio, status, foto, tipo_visita, nome_reu, comarca) VALUES (?, ?, ?, ?, ?, 'aguardando', ?, ?, ?, ?)",
            [nome, cpf, contato, cartorioId, nomeCartorio, foto, tipoVisita, nomeReu, comarca]
        );

        const novaPessoa = await db.get("SELECT * FROM fila WHERE id = ?", [result.id]);
        
        // Notificar cartório específico e atualizar fila geral
        io.emit('FILA_ATUALIZADA', await db.query("SELECT * FROM fila WHERE status IN ('aguardando', 'chamado', 'em_atendimento') ORDER BY hora_entrada ASC"));
        io.emit('NOTIFICACAO_CARTORIO', { 
            cartorioId, 
            nomePessoa: nome,
            mensagem: `NOVA PESSOA NA FILA: ${nome}`,
            tipo: 'ENTRADA'
        });

        res.status(201).json(novaPessoa);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// --- NOVAS ROTAS PARA TRIAGEM WEB ---

// Registrar Ponto (Portaria)
app.post('/api/ponto', async (req, res) => {
    const { cpf, nome, tipo } = req.body; // tipo: entrada, saida
    const data = new Date().toLocaleDateString('pt-BR');
    const hora = new Date().toLocaleTimeString('pt-BR');
    
    try {
        const result = await db.run(
            "INSERT INTO ponto (visitante_cpf, nome, tipo, data, hora) VALUES (?, ?, ?, ?, ?)",
            [cpf, nome, tipo, data, hora]
        );
        res.status(201).json({ id: result.id, success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Listar Comarcas e Locais
app.get('/api/config/triagem', async (req, res) => {
    try {
        const comarcas = await db.query("SELECT * FROM comarcas ORDER BY nome ASC");
        const locais = await db.query("SELECT * FROM locais ORDER BY nome ASC");
        res.json({ comarcas, locais });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Adicionar Comarca/Local
app.post('/api/config/comarcas', async (req, res) => {
    const { nome, cidade } = req.body;
    const result = await db.run("INSERT INTO comarcas (nome, cidade) VALUES (?, ?)", [nome, cidade]);
    res.status(201).json({ id: result.id });
});

app.post('/api/config/locais', async (req, res) => {
    const { nome } = req.body;
    const result = await db.run("INSERT INTO locais (nome) VALUES (?)", [nome]);
    res.status(201).json({ id: result.id });
});

// Atualizar Status (Chamar, Atender, Finalizar)
app.patch('/api/fila/:id', async (req, res) => {
    try {
        const id = parseInt(req.params.id);
        const { status } = req.body;
        let sql = "UPDATE fila SET status = ? WHERE id = ?";
        let params = [status, id];

        if (status === 'chamado') {
            sql = "UPDATE fila SET status = ?, hora_chamada = CURRENT_TIMESTAMP WHERE id = ?";
        } else if (status === 'em_atendimento') {
            sql = "UPDATE fila SET status = ?, hora_atendimento = CURRENT_TIMESTAMP WHERE id = ?";
        } else if (status === 'finalizado') {
            sql = "UPDATE fila SET status = ?, hora_saida = CURRENT_TIMESTAMP WHERE id = ?";
        }

        await db.run(sql, params);
        const pessoa = await db.get("SELECT * FROM fila WHERE id = ?", [id]);

        if (status === 'chamado') {
            io.emit('NOVA_CHAMADA', pessoa);
            const historico = await db.query("SELECT * FROM fila WHERE status IN ('chamado', 'em_atendimento', 'finalizado') ORDER BY hora_chamada DESC LIMIT 6");
            io.emit('HISTORICO_ATUALIZADO', historico);
        }

        io.emit('FILA_ATUALIZADA', await db.query("SELECT * FROM fila WHERE status IN ('aguardando', 'chamado', 'em_atendimento') ORDER BY hora_entrada ASC"));
        res.json(pessoa);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Transferir Atendimento
app.post('/api/transferir', async (req, res) => {
    try {
        const { id, novoCartorioId, nomeNovoCartorio, origemCartorioNome } = req.body;
        
        // Marcar atual como transferido e criar novo registro
        const antigaPessoa = await db.get("SELECT * FROM fila WHERE id = ?", [id]);
        await db.run("UPDATE fila SET status = 'transferido', hora_saida = CURRENT_TIMESTAMP WHERE id = ?", [id]);
        
        const result = await db.run(
            "INSERT INTO fila (nome, cpf, contato, cartorio_id, nome_cartorio, status, foto, origem_transferencia) VALUES (?, ?, ?, ?, ?, 'aguardando', ?, ?)",
            [antigaPessoa.nome, antigaPessoa.cpf, antigaPessoa.contato, novoCartorioId, nomeNovoCartorio, antigaPessoa.foto, origemCartorioNome]
        );

        const novaPessoa = await db.get("SELECT * FROM fila WHERE id = ?", [result.id]);
        
        io.emit('FILA_ATUALIZADA', await db.query("SELECT * FROM fila WHERE status IN ('aguardando', 'chamado', 'em_atendimento') ORDER BY hora_entrada ASC"));
        io.emit('NOTIFICACAO_CARTORIO', { 
            cartorioId: novoCartorioId, 
            mensagem: `CARO COLÉGA ECAMINHEI ${antigaPessoa.nome} PARA QUE SEJA ATENDIDA AI. Enviado por: ${origemCartorioNome}`,
            tipo: 'TRANSFERENCIA'
        });

        res.json(novaPessoa);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Gerar Relatórios
app.get('/api/relatorios', async (req, res) => {
    const { tipo, cpf, formato } = req.query; // tipo: entrada, saida, fluxo; formato: pdf, texto
    
    try {
        let sql = "SELECT * FROM fila";
        let params = [];
        if (cpf) {
            sql += " WHERE cpf = ?";
            params.push(cpf);
        }
        sql += " ORDER BY hora_entrada DESC";

        const dados = await db.query(sql, params);

        if (formato === 'pdf') {
            const doc = new PDFDocument({ margin: 50 });
            res.setHeader('Content-Type', 'application/pdf');
            res.setHeader('Content-Disposition', `attachment; filename=relatorio_${tipo}.pdf`);
            doc.pipe(res);

            // Cabeçalho
            doc.rect(0, 0, 612, 100).fill('#2c3e50');
            doc.fillColor('#ffffff').fontSize(24).text('ATENDESK', 50, 35);
            doc.fontSize(12).text('Relatório de Fluxo de Atendimento', 50, 65);
            
            doc.fillColor('#000000').moveDown(4);
            doc.fontSize(14).text(`Filtro: ${tipo.toUpperCase()}`, { underline: true });
            if (cpf) doc.text(`CPF: ${cpf}`);
            doc.text(`Data de Emissão: ${new Date().toLocaleString()}`);
            doc.moveDown();

            // Tabela Simples
            let y = doc.y;
            doc.fontSize(10).fillColor('#34495e');
            
            dados.forEach((item, index) => {
                if (y > 700) {
                    doc.addPage();
                    y = 50;
                }

                doc.rect(50, y, 512, 85).stroke('#bdc3c7');
                doc.fillColor('#2c3e50').text(`Nome: ${item.nome}`, 60, y + 10);
                doc.text(`CPF: ${item.cpf}`, 300, y + 10);
                doc.text(`Cartório: ${item.nome_cartorio}`, 60, y + 25);
                doc.text(`Status: ${item.status.toUpperCase()}`, 300, y + 25);
                doc.text(`Entrada: ${item.hora_entrada}`, 60, y + 40);
                doc.text(`Saída: ${item.hora_saida || '---'}`, 300, y + 40);
                
                if (item.origem_transferencia) {
                    doc.fillColor('#e67e22').text(`Transferido de: ${item.origem_transferencia}`, 60, y + 55);
                }
                
                y += 95;
            });

            doc.end();
        } else {
            // Formato Texto Otimizado
            let output = `==================================================\n`;
            output += `            ATENDESK - RELATÓRIO\n`;
            output += `==================================================\n`;
            output += `TIPO: ${tipo.toUpperCase()}\n`;
            output += `EMISSÃO: ${new Date().toLocaleString()}\n`;
            if (cpf) output += `CPF FILTRADO: ${cpf}\n`;
            output += `==================================================\n\n`;
            
            dados.forEach(item => {
                output += `NOME: ${item.nome.padEnd(30)} CPF: ${item.cpf}\n`;
                output += `LOCAL: ${item.nome_cartorio.padEnd(29)} STATUS: ${item.status.toUpperCase()}\n`;
                output += `ENTRADA: ${item.hora_entrada.padEnd(27)} SAÍDA: ${item.hora_saida || '---'}\n`;
                if (item.origem_transferencia) {
                    output += `ORIGEM: Transferido de ${item.origem_transferencia}\n`;
                }
                output += `--------------------------------------------------\n`;
            });

            res.setHeader('Content-Type', 'text/plain');
            res.send(output);
        }
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Resetar Sistema (Apenas para Admin)
app.post('/api/reset', async (req, res) => {
    await db.run("DELETE FROM fila");
    io.emit('SISTEMA_RESETADO');
    res.json({ success: true });
});

// --- SOCKET.IO ---
io.on('connection', async (socket) => {
    console.log('Cliente conectado:', socket.id);
    
    // Enviar dados iniciais
    const cartorios = await db.query("SELECT * FROM cartorios WHERE status = 'ativo'");
    const fila = await db.query("SELECT * FROM fila WHERE status IN ('aguardando', 'chamado', 'em_atendimento') ORDER BY hora_entrada ASC");
    const ultimaChamada = await db.get("SELECT * FROM fila WHERE status = 'chamado' ORDER BY hora_chamada DESC LIMIT 1");
    const historicoChamadas = await db.query("SELECT * FROM fila WHERE status IN ('chamado', 'em_atendimento', 'finalizado') ORDER BY hora_chamada DESC LIMIT 6");

    socket.emit('DADOS_INICIAIS', {
        cartorios,
        fila,
        ultimaChamada,
        historicoChamadas
    });

    socket.on('disconnect', () => {
        console.log('Cliente desconectado');
    });
});

// --- ROTAS DE CONFIGURAÇÃO DE TIPOS DE VISITA ---
app.get('/api/config/tipos-visita', async (req, res) => {
    try {
        const tipos = await db.query("SELECT * FROM tipos_visita ORDER BY nome ASC");
        res.json(tipos);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/config/tipos-visita', async (req, res) => {
    const { nome } = req.body;
    try {
        const result = await db.run("INSERT INTO tipos_visita (nome) VALUES (?)", [nome]);
        res.status(201).json({ id: result.id, nome });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.put('/api/config/tipos-visita/:id', async (req, res) => {
    const { id } = req.params;
    const { nome } = req.body;
    try {
        await db.run("UPDATE tipos_visita SET nome = ? WHERE id = ?", [nome, id]);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.delete('/api/config/tipos-visita/:id', async (req, res) => {
    const { id } = req.params;
    try {
        await db.run("DELETE FROM tipos_visita WHERE id = ?", [id]);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

server.listen(PORT, () => {
    console.log(`Servidor rodando na porta ${PORT}`);
});

