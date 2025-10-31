const initSqlJs = require('sql.js');
const path = require('path');
const fs = require('fs');
const { app } = require('electron');
const crypto = require('crypto');

// Caminho do banco de dados (preferir pasta sincronizada)
function resolveDatabasePath() {
    try {
        const oneDrive = process.env.OneDrive || process.env.ONEDRIVE;
        const docs = app.getPath('documents');
        let baseDir = null;

        if (oneDrive && fs.existsSync(oneDrive)) {
            baseDir = path.join(oneDrive, 'PDV Desktop');
        } else if (docs && fs.existsSync(docs)) {
            baseDir = path.join(docs, 'PDV Desktop');
        } else {
            baseDir = app.getPath('userData');
        }

        if (!fs.existsSync(baseDir)) {
            fs.mkdirSync(baseDir, { recursive: true });
        }

        return path.join(baseDir, 'pdv.db');
    } catch (e) {
        return path.join(app.getPath('userData'), 'pdv.db');
    }
}

const dbPath = resolveDatabasePath();
let db = null;

// Hash de senha
function hashPassword(password) {
    return crypto.createHash('sha256').update(password).digest('hex');
}

// Inicializar banco de dados
async function initDatabase() {
    const SQL = await initSqlJs();
    
    // Carregar banco existente ou criar novo
    if (fs.existsSync(dbPath)) {
        const filebuffer = fs.readFileSync(dbPath);
        db = new SQL.Database(filebuffer);
    } else {
        db = new SQL.Database();
    }

    // Criar tabelas
    db.run(`
        CREATE TABLE IF NOT EXISTS usuarios (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            nome TEXT NOT NULL,
            email TEXT UNIQUE NOT NULL,
            senha TEXT NOT NULL,
            tipo TEXT DEFAULT 'operador',
            criado_em DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    `);

    db.run(`
        CREATE TABLE IF NOT EXISTS produtos (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            codigo TEXT NOT NULL,
            nome TEXT NOT NULL,
            categoria TEXT,
            preco REAL NOT NULL,
            estoque INTEGER NOT NULL,
            usuario_id INTEGER,
            criado_em DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (usuario_id) REFERENCES usuarios(id),
            UNIQUE(codigo, usuario_id)
        )
    `);

    db.run(`
        CREATE TABLE IF NOT EXISTS vendas (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            usuario_id INTEGER,
            total REAL NOT NULL,
            desconto REAL DEFAULT 0,
            forma_pagamento TEXT NOT NULL,
            data DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (usuario_id) REFERENCES usuarios(id)
        )
    `);

    db.run(`
        CREATE TABLE IF NOT EXISTS venda_itens (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            venda_id INTEGER,
            produto_id INTEGER,
            quantidade INTEGER NOT NULL,
            preco_unitario REAL NOT NULL,
            FOREIGN KEY (venda_id) REFERENCES vendas(id),
            FOREIGN KEY (produto_id) REFERENCES produtos(id)
        )
    `);

    saveDatabase();
    console.log('✅ Banco de dados inicializado:', dbPath);
}

// Salvar banco de dados
function saveDatabase() {
    if (db) {
        const data = db.export();
        const buffer = Buffer.from(data);
        fs.writeFileSync(dbPath, buffer);
    }
}

// Funções de Usuário
const usuarios = {
    criar(nome, email, senha) {
        const senhaHash = hashPassword(senha);
        try {
            db.run('INSERT INTO usuarios (nome, email, senha) VALUES (?, ?, ?)', [nome, email, senhaHash]);
            const result = db.exec('SELECT last_insert_rowid() as id');
            saveDatabase();
            return { success: true, id: result[0].values[0][0] };
        } catch (error) {
            return { success: false, error: error.message };
        }
    },

    login(email, senha) {
        const senhaHash = hashPassword(senha);
        const result = db.exec('SELECT id, nome, email, tipo FROM usuarios WHERE email = ? AND senha = ?', [email, senhaHash]);
        
        if (result.length > 0 && result[0].values.length > 0) {
            const row = result[0].values[0];
            return { 
                success: true, 
                usuario: {
                    id: row[0],
                    nome: row[1],
                    email: row[2],
                    tipo: row[3]
                }
            };
        }
        return { success: false, error: 'Email ou senha incorretos' };
    },

    existeUsuarios() {
        const result = db.exec('SELECT COUNT(*) as count FROM usuarios');
        return result.length > 0 && result[0].values[0][0] > 0;
    }
};

// Funções de Produto
const produtos = {
    listar(usuario_id) {
        const result = db.exec('SELECT * FROM produtos WHERE usuario_id = ? ORDER BY nome', [usuario_id]);
        if (result.length === 0) return [];
        
        const columns = result[0].columns;
        return result[0].values.map(row => {
            const obj = {};
            columns.forEach((col, i) => obj[col] = row[i]);
            return obj;
        });
    },

    criar(produto, usuario_id) {
        try {
            db.run(`
                INSERT INTO produtos (codigo, nome, categoria, preco, estoque, usuario_id) 
                VALUES (?, ?, ?, ?, ?, ?)
            `, [produto.codigo, produto.nome, produto.categoria || null, produto.preco, produto.estoque, usuario_id]);
            
            const result = db.exec('SELECT last_insert_rowid() as id');
            saveDatabase();
            return { success: true, id: result[0].values[0][0] };
        } catch (error) {
            return { success: false, error: error.message };
        }
    },

    atualizar(id, produto) {
        try {
            db.run(`
                UPDATE produtos 
                SET codigo = ?, nome = ?, categoria = ?, preco = ?, estoque = ?
                WHERE id = ?
            `, [produto.codigo, produto.nome, produto.categoria || null, produto.preco, produto.estoque, id]);
            saveDatabase();
            return { success: true };
        } catch (error) {
            return { success: false, error: error.message };
        }
    },

    deletar(id) {
        db.run('DELETE FROM produtos WHERE id = ?', [id]);
        saveDatabase();
        return { success: true };
    },

    buscarPorCodigo(codigo, usuario_id) {
        const result = db.exec('SELECT * FROM produtos WHERE codigo = ? AND usuario_id = ?', [codigo, usuario_id]);
        if (result.length === 0 || result[0].values.length === 0) return null;
        
        const columns = result[0].columns;
        const row = result[0].values[0];
        const obj = {};
        columns.forEach((col, i) => obj[col] = row[i]);
        return obj;
    }
};

// Funções de Venda
const vendas = {
    criar(venda, itens, usuario_id) {
        try {
            db.run(`
                INSERT INTO vendas (usuario_id, total, desconto, forma_pagamento) 
                VALUES (?, ?, ?, ?)
            `, [usuario_id, venda.total, venda.desconto, venda.forma_pagamento]);

            const vendaResult = db.exec('SELECT last_insert_rowid() as id');
            const vendaId = vendaResult[0].values[0][0];

            for (const item of itens) {
                db.run(`
                    INSERT INTO venda_itens (venda_id, produto_id, quantidade, preco_unitario) 
                    VALUES (?, ?, ?, ?)
                `, [vendaId, item.id, item.quantidade, item.preco]);

                db.run('UPDATE produtos SET estoque = estoque - ? WHERE id = ?', [item.quantidade, item.id]);
            }

            saveDatabase();
            return { success: true, id: vendaId };
        } catch (error) {
            return { success: false, error: error.message };
        }
    },

    listar(usuario_id) {
        const result = db.exec(`
            SELECT v.*, 
                   (SELECT COUNT(*) FROM venda_itens WHERE venda_id = v.id) as total_itens
            FROM vendas v
            WHERE v.usuario_id = ?
            ORDER BY v.data DESC
        `, [usuario_id]);
        
        if (result.length === 0) return [];
        
        const columns = result[0].columns;
        return result[0].values.map(row => {
            const obj = {};
            columns.forEach((col, i) => obj[col] = row[i]);
            return obj;
        });
    },

    buscarComItens(id) {
        const vendaResult = db.exec('SELECT * FROM vendas WHERE id = ?', [id]);
        if (vendaResult.length === 0) return null;

        const venda = {};
        vendaResult[0].columns.forEach((col, i) => venda[col] = vendaResult[0].values[0][i]);

        const itensResult = db.exec(`
            SELECT vi.*, p.nome 
            FROM venda_itens vi
            JOIN produtos p ON vi.produto_id = p.id
            WHERE vi.venda_id = ?
        `, [id]);

        if (itensResult.length > 0) {
            venda.itens = itensResult[0].values.map(row => {
                const obj = {};
                itensResult[0].columns.forEach((col, i) => obj[col] = row[i]);
                return obj;
            });
        } else {
            venda.itens = [];
        }

        return venda;
    },

    estatisticas(usuario_id) {
        const hoje = new Date().toISOString().split('T')[0];
        const mesAtual = new Date().toISOString().substring(0, 7);

        const vendasHojeResult = db.exec(`
            SELECT COALESCE(SUM(total), 0) as total 
            FROM vendas 
            WHERE usuario_id = ? AND DATE(data) = ?
        `, [usuario_id, hoje]);

        const vendasMesResult = db.exec(`
            SELECT COALESCE(SUM(total), 0) as total 
            FROM vendas 
            WHERE usuario_id = ? AND strftime('%Y-%m', data) = ?
        `, [usuario_id, mesAtual]);

        const totalProdutosResult = db.exec(`
            SELECT COUNT(*) as total 
            FROM produtos 
            WHERE usuario_id = ?
        `, [usuario_id]);

        return {
            vendasHoje: vendasHojeResult[0].values[0][0] || 0,
            vendasMes: vendasMesResult[0].values[0][0] || 0,
            totalProdutos: totalProdutosResult[0].values[0][0] || 0
        };
    }
};

module.exports = {
    initDatabase,
    usuarios,
    produtos,
    vendas
};
