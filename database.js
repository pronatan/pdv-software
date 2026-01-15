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
        const userData = app.getPath('userData');
        
        // Caminhos possíveis do banco antigo (PDV Desktop)
        const oldPaths = [];
        
        // 1. OneDrive/PDV Desktop
        if (oneDrive && fs.existsSync(oneDrive)) {
            oldPaths.push(path.join(oneDrive, 'PDV Desktop', 'pdv.db'));
        }
        
        // 2. Documents/PDV Desktop
        if (docs && fs.existsSync(docs)) {
            oldPaths.push(path.join(docs, 'PDV Desktop', 'pdv.db'));
        }
        
        // 3. UserData antigo (appId: com.pdv.desktop)
        // O userData do Electron muda com o appId, então precisamos calcular o caminho antigo
        const oldAppDataPath = path.join(
            process.env.APPDATA || process.env.LOCALAPPDATA || userData,
            '..', '..', 'Roaming', 'pdv-desktop'
        );
        if (fs.existsSync(oldAppDataPath)) {
            oldPaths.push(path.join(oldAppDataPath, 'pdv.db'));
        }
        
        // Caminho novo (PDV Desk)
        let baseDir = null;
        if (oneDrive && fs.existsSync(oneDrive)) {
            baseDir = path.join(oneDrive, 'PDV Desk');
        } else if (docs && fs.existsSync(docs)) {
            baseDir = path.join(docs, 'PDV Desk');
        } else {
            baseDir = userData;
        }

        const newDbPath = path.join(baseDir, 'pdv.db');

        // Procurar banco antigo
        let oldDbPath = null;
        for (const oldPath of oldPaths) {
            if (fs.existsSync(oldPath)) {
                oldDbPath = oldPath;
                console.log('📦 Banco de dados antigo encontrado em:', oldPath);
                break;
            }
        }

        // Se existe banco antigo e não existe banco novo, migrar dados
        if (oldDbPath && !fs.existsSync(newDbPath)) {
            console.log('📦 Migrando banco de dados da versão antiga (PDV Desktop) para nova versão (PDV Desk)...');
            
            // Criar diretório novo
            if (!fs.existsSync(baseDir)) {
                fs.mkdirSync(baseDir, { recursive: true });
            }

            // Copiar banco de dados
            try {
                fs.copyFileSync(oldDbPath, newDbPath);
                console.log('✅ Banco de dados migrado com sucesso!');
                console.log('   De:', oldDbPath);
                console.log('   Para:', newDbPath);
                
                // Copiar também outros arquivos do diretório antigo se existirem
                const oldDir = path.dirname(oldDbPath);
                if (fs.existsSync(oldDir)) {
                    try {
                        const oldDirFiles = fs.readdirSync(oldDir);
                        oldDirFiles.forEach(file => {
                            if (file !== 'pdv.db' && file.endsWith('.db')) {
                                const oldFile = path.join(oldDir, file);
                                const newFile = path.join(baseDir, file);
                                try {
                                    if (fs.statSync(oldFile).isFile()) {
                                        fs.copyFileSync(oldFile, newFile);
                                        console.log('   Arquivo copiado:', file);
                                    }
                                } catch (e) {
                                    console.log('   Aviso: Não foi possível copiar arquivo:', file);
                                }
                            }
                        });
                    } catch (e) {
                        console.log('   Aviso: Não foi possível ler diretório antigo:', e.message);
                    }
                }
            } catch (e) {
                console.error('❌ Erro ao migrar banco de dados:', e);
                // Se falhar, usar o banco antigo mesmo
                console.log('⚠️ Usando banco de dados antigo diretamente');
                return oldDbPath;
            }
        } else if (oldDbPath && fs.existsSync(newDbPath)) {
            // Se ambos existem, usar o novo (mais recente)
            console.log('ℹ️ Usando banco de dados da nova versão (PDV Desk)');
        } else if (oldDbPath) {
            // Se só existe o antigo, usar ele
            console.log('ℹ️ Usando banco de dados da versão antiga (PDV Desktop)');
            return oldDbPath;
        }

        // Criar diretório se não existir
        if (!fs.existsSync(baseDir)) {
            fs.mkdirSync(baseDir, { recursive: true });
        }

        return newDbPath;
    } catch (e) {
        console.error('Erro ao resolver caminho do banco:', e);
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
            foto TEXT,
            nome_comercio TEXT,
            criado_em DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    `);

    // Adicionar colunas se não existirem (para bancos antigos)
    try {
        const checkColumn = db.exec(`PRAGMA table_info(usuarios)`);
        const columns = checkColumn[0].values.map(row => row[1]);
        if (!columns.includes('foto')) {
            db.run(`ALTER TABLE usuarios ADD COLUMN foto TEXT`);
        }
        if (!columns.includes('nome_comercio')) {
            db.run(`ALTER TABLE usuarios ADD COLUMN nome_comercio TEXT`);
        }
    } catch (e) {
        console.log('Nota: Colunas podem já existir ou não puderam ser adicionadas:', e.message);
    }

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

    // Adicionar coluna foto se não existir (para bancos antigos)
    try {
        const checkColumn = db.exec(`PRAGMA table_info(produtos)`);
        const columns = checkColumn[0].values.map(row => row[1]);
        if (!columns.includes('foto')) {
            db.run(`ALTER TABLE produtos ADD COLUMN foto TEXT`);
        }
    } catch (e) {
        console.log('Nota: Coluna foto pode já existir ou não pôde ser adicionada:', e.message);
    }

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
    
    // Adicionar coluna cliente_id se não existir (para bancos antigos)
    try {
        // Verificar se a coluna já existe
        const checkColumn = db.exec(`PRAGMA table_info(vendas)`);
        const columns = checkColumn[0].values.map(row => row[1]); // Nome da coluna está na posição 1
        if (!columns.includes('cliente_id')) {
            db.run(`ALTER TABLE vendas ADD COLUMN cliente_id INTEGER REFERENCES clientes(id)`);
        }
    } catch (e) {
        // Ignorar erro se não conseguir verificar/adicionar
        console.log('Nota: Coluna cliente_id pode já existir ou não pôde ser adicionada:', e.message);
    }

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

    db.run(`
        CREATE TABLE IF NOT EXISTS sessoes (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            usuario_id INTEGER NOT NULL,
            email TEXT NOT NULL,
            criado_em DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (usuario_id) REFERENCES usuarios(id)
        )
    `);

    db.run(`
        CREATE TABLE IF NOT EXISTS clientes (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            usuario_id INTEGER,
            nome TEXT NOT NULL,
            cpf TEXT NOT NULL,
            status INTEGER NOT NULL DEFAULT 0,
            dia_cadastro INTEGER,
            mes_cadastro INTEGER,
            criado_em DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (usuario_id) REFERENCES usuarios(id),
            UNIQUE(cpf, usuario_id)
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
        const result = db.exec('SELECT id, nome, email, tipo, foto, nome_comercio FROM usuarios WHERE email = ? AND senha = ?', [email, senhaHash]);
        
        if (result.length > 0 && result[0].values.length > 0) {
            const row = result[0].values[0];
            return { 
                success: true, 
                usuario: {
                    id: row[0],
                    nome: row[1],
                    email: row[2],
                    tipo: row[3],
                    foto: row[4] || null,
                    nome_comercio: row[5] || null
                }
            };
        }
        return { success: false, error: 'Email ou senha incorretos' };
    },

    existeUsuarios() {
        const result = db.exec('SELECT COUNT(*) as count FROM usuarios');
        return result.length > 0 && result[0].values[0][0] > 0;
    },

    buscarPorId(id) {
        const result = db.exec('SELECT id, nome, email, tipo, foto, nome_comercio FROM usuarios WHERE id = ?', [id]);
        if (result.length === 0 || result[0].values.length === 0) return null;
        
        const row = result[0].values[0];
        return {
            id: row[0],
            nome: row[1],
            email: row[2],
            tipo: row[3],
            foto: row[4] || null,
            nome_comercio: row[5] || null
        };
    },

    buscarPorEmail(email) {
        const result = db.exec('SELECT id, nome, email, tipo, foto, nome_comercio FROM usuarios WHERE email = ?', [email]);
        if (result.length === 0 || result[0].values.length === 0) return null;
        
        const row = result[0].values[0];
        return {
            id: row[0],
            nome: row[1],
            email: row[2],
            tipo: row[3],
            foto: row[4] || null,
            nome_comercio: row[5] || null
        };
    },

    atualizar(id, dados) {
        try {
            // Se senha foi fornecida, atualizar também
            if (dados.senha) {
                const senhaHash = hashPassword(dados.senha);
                db.run('UPDATE usuarios SET nome = ?, email = ?, senha = ?, foto = ?, nome_comercio = ? WHERE id = ?', 
                    [dados.nome, dados.email, senhaHash, dados.foto || null, dados.nome_comercio || null, id]);
            } else {
                // Atualizar sem alterar senha
                db.run('UPDATE usuarios SET nome = ?, email = ?, foto = ?, nome_comercio = ? WHERE id = ?', 
                    [dados.nome, dados.email, dados.foto || null, dados.nome_comercio || null, id]);
            }
            saveDatabase();
            return { success: true };
        } catch (error) {
            return { success: false, error: error.message };
        }
    }
};

// Funções de Sessão
const sessoes = {
    salvar(usuario_id, email) {
        try {
            // Remove sessões antigas
            db.run('DELETE FROM sessoes');
            // Salva nova sessão
            db.run('INSERT INTO sessoes (usuario_id, email) VALUES (?, ?)', [usuario_id, email]);
            saveDatabase();
            return { success: true };
        } catch (error) {
            return { success: false, error: error.message };
        }
    },

    obter() {
        const result = db.exec('SELECT usuario_id, email FROM sessoes LIMIT 1');
        if (result.length === 0 || result[0].values.length === 0) return null;
        
        const row = result[0].values[0];
        return {
            usuario_id: row[0],
            email: row[1]
        };
    },

    remover() {
        db.run('DELETE FROM sessoes');
        saveDatabase();
        return { success: true };
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
                SET codigo = ?, nome = ?, categoria = ?, preco = ?, estoque = ?, foto = ?
                WHERE id = ?
            `, [produto.codigo, produto.nome, produto.categoria || null, produto.preco, produto.estoque, produto.foto || null, id]);
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
            // Incluir cliente_id se existir
            const clienteId = venda.cliente_id || venda.clienteId || null;
            db.run(`
                INSERT INTO vendas (usuario_id, total, desconto, forma_pagamento, cliente_id) 
                VALUES (?, ?, ?, ?, ?)
            `, [usuario_id, venda.total, venda.desconto, venda.forma_pagamento, clienteId]);

            const vendaResult = db.exec('SELECT last_insert_rowid() as id');
            const vendaId = vendaResult[0].values[0][0];

            for (const item of itens) {
                db.run(`
                    INSERT INTO venda_itens (venda_id, produto_id, quantidade, preco_unitario) 
                    VALUES (?, ?, ?, ?)
                `, [vendaId, item.id, item.quantidade, item.preco]);

                // Estoque removido do sistema - não atualiza mais
            }

            saveDatabase();
            return { success: true, id: vendaId };
        } catch (error) {
            return { success: false, error: error.message };
        }
    },

    listar(usuario_id) {
        try {
            const result = db.exec(`
                SELECT v.*, 
                       (SELECT COUNT(*) FROM venda_itens WHERE venda_id = v.id) as total_itens,
                       c.nome as cliente_nome
                FROM vendas v
                LEFT JOIN clientes c ON v.cliente_id = c.id
                WHERE v.usuario_id = ?
                ORDER BY v.data DESC
            `, [usuario_id]);
            
            if (result.length === 0) {
                console.log('📊 Nenhuma venda encontrada para usuário:', usuario_id);
                return [];
            }
            
            const columns = result[0].columns;
            const vendasList = result[0].values.map(row => {
                const obj = {};
                columns.forEach((col, i) => obj[col] = row[i]);
                return obj;
            });
            
            console.log(`📊 Encontradas ${vendasList.length} vendas para usuário ${usuario_id}`);
            
            // Buscar itens para cada venda
            const vendasComItens = vendasList.map(venda => {
                const itensResult = db.exec(`
                    SELECT vi.*, p.nome, p.codigo
                    FROM venda_itens vi
                    JOIN produtos p ON vi.produto_id = p.id
                    WHERE vi.venda_id = ?
                `, [venda.id]);
                
                if (itensResult.length > 0 && itensResult[0].values && itensResult[0].values.length > 0) {
                    venda.itens = itensResult[0].values.map(row => {
                        const item = {};
                        itensResult[0].columns.forEach((col, i) => item[col] = row[i]);
                        // Garantir campos padrão
                        item.preco = item.preco_unitario || item.preco || 0;
                        item.quantidade = item.quantidade || 0;
                        return item;
                    });
                } else {
                    venda.itens = [];
                }
                
                console.log(`  Venda #${venda.id}: ${venda.itens.length} itens, Total: R$ ${venda.total}`);
                return venda;
            });
            
            return vendasComItens;
        } catch (error) {
            console.error('❌ Erro ao listar vendas:', error);
            return [];
        }
    },

    buscarComItens(id) {
        const vendaResult = db.exec(`
            SELECT v.*, c.nome as cliente_nome, c.cpf as cliente_cpf
            FROM vendas v
            LEFT JOIN clientes c ON v.cliente_id = c.id
            WHERE v.id = ?
        `, [id]);
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
    },

    deletar(id, usuario_id) {
        try {
            // Deletar itens da venda primeiro (devido à foreign key)
            db.run('DELETE FROM venda_itens WHERE venda_id = ?', [id]);
            // Deletar a venda
            db.run('DELETE FROM vendas WHERE id = ? AND usuario_id = ?', [id, usuario_id]);
            saveDatabase();
            return { success: true };
        } catch (error) {
            return { success: false, error: error.message };
        }
    }
};

// Funções de Clientes
const clientes = {
    criar(cliente, usuario_id) {
        try {
            // Salvar dia e mês atual ao criar cliente
            const agora = new Date();
            const dia = agora.getDate();
            const mes = agora.getMonth() + 1; // getMonth() retorna 0-11, então +1 para 1-12
            
            db.run(`
                INSERT INTO clientes (usuario_id, nome, cpf, status, dia_cadastro, mes_cadastro) 
                VALUES (?, ?, ?, 0, ?, ?)
            `, [usuario_id, cliente.nome, cliente.cpf, dia, mes]);
            
            const result = db.exec('SELECT last_insert_rowid() as id');
            saveDatabase();
            return { success: true, id: result[0].values[0][0] };
        } catch (error) {
            if (error.message.includes('UNIQUE')) {
                return { success: false, error: 'CPF já cadastrado para este usuário' };
            }
            return { success: false, error: error.message };
        }
    },

    listar(usuario_id) {
        const result = db.exec(`
            SELECT * FROM clientes 
            WHERE usuario_id = ?
            ORDER BY criado_em DESC
        `, [usuario_id]);
        
        if (result.length === 0) return [];
        
        const columns = result[0].columns;
        return result[0].values.map(row => {
            const obj = {};
            columns.forEach((col, i) => obj[col] = row[i]);
            return obj;
        });
    },

    buscar(id) {
        const result = db.exec('SELECT * FROM clientes WHERE id = ?', [id]);
        if (result.length === 0) return null;
        
        const obj = {};
        result[0].columns.forEach((col, i) => obj[col] = result[0].values[0][i]);
        return obj;
    },

    atualizar(id, cliente, usuario_id) {
        try {
            const valor = parseFloat(cliente.status) || 0;
            // Se dia_cadastro e mes_cadastro foram fornecidos, atualizar; caso contrário, manter os valores existentes
            if (cliente.dia_cadastro !== undefined && cliente.mes_cadastro !== undefined) {
                db.run(`
                    UPDATE clientes 
                    SET nome = ?, cpf = ?, status = ?, dia_cadastro = ?, mes_cadastro = ?
                    WHERE id = ? AND usuario_id = ?
                `, [cliente.nome, cliente.cpf, valor, cliente.dia_cadastro, cliente.mes_cadastro, id, usuario_id]);
            } else {
                db.run(`
                    UPDATE clientes 
                    SET nome = ?, cpf = ?, status = ?
                    WHERE id = ? AND usuario_id = ?
                `, [cliente.nome, cliente.cpf, valor, id, usuario_id]);
            }
            
            saveDatabase();
            return { success: true };
        } catch (error) {
            if (error.message.includes('UNIQUE')) {
                return { success: false, error: 'CPF já cadastrado para outro cliente' };
            }
            return { success: false, error: error.message };
        }
    },

    excluir(id, usuario_id) {
        try {
            db.run('DELETE FROM clientes WHERE id = ? AND usuario_id = ?', [id, usuario_id]);
            saveDatabase();
            return { success: true };
        } catch (error) {
            return { success: false, error: error.message };
        }
    }
};

module.exports = {
    clientes,
    initDatabase,
    usuarios,
    produtos,
    vendas,
    sessoes
};
