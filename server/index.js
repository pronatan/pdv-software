import express from 'express';
import cors from 'cors';
import morgan from 'morgan';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import path from 'path';
import fs from 'fs';
import sqlite3 from 'sqlite3';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DATA_DIR = path.join(__dirname, 'server-data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
const DB_PATH = path.join(DATA_DIR, 'pdv-server.db');

const db = new sqlite3.Database(DB_PATH);

// Criação de tabelas
db.serialize(() => {
  db.run(`CREATE TABLE IF NOT EXISTS usuarios (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    nome TEXT NOT NULL,
    email TEXT UNIQUE NOT NULL,
    senha TEXT NOT NULL,
    tipo TEXT DEFAULT 'operador',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS produtos (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    usuario_id INTEGER NOT NULL,
    codigo TEXT NOT NULL,
    nome TEXT NOT NULL,
    categoria TEXT,
    preco REAL NOT NULL,
    estoque INTEGER NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(codigo, usuario_id),
    FOREIGN KEY(usuario_id) REFERENCES usuarios(id)
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS vendas (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    usuario_id INTEGER NOT NULL,
    total REAL NOT NULL,
    desconto REAL DEFAULT 0,
    forma_pagamento TEXT NOT NULL,
    data DATETIME DEFAULT CURRENT_TIMESTAMP,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(usuario_id) REFERENCES usuarios(id)
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS venda_itens (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    venda_id INTEGER NOT NULL,
    produto_id INTEGER NOT NULL,
    quantidade INTEGER NOT NULL,
    preco_unitario REAL NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(venda_id) REFERENCES vendas(id),
    FOREIGN KEY(produto_id) REFERENCES produtos(id)
  )`);
});

const app = express();
app.use(cors());
app.use(express.json());
app.use(morgan('dev'));

const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret';

function genToken(user) {
  return jwt.sign({ id: user.id, email: user.email, nome: user.nome }, JWT_SECRET, { expiresIn: '7d' });
}

function auth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Token ausente' });
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = decoded;
    next();
  } catch {
    return res.status(401).json({ error: 'Token inválido' });
  }
}

// Auth
app.post('/auth/register', (req, res) => {
  const { nome, email, senha } = req.body;
  if (!nome || !email || !senha) return res.status(400).json({ error: 'Dados obrigatórios' });
  const senhaHash = bcrypt.hashSync(senha, 10);
  const stmt = db.prepare('INSERT INTO usuarios (nome, email, senha) VALUES (?, ?, ?)');
  stmt.run([nome, email, senhaHash], function(err) {
    if (err) {
      return res.status(400).json({ error: 'Email já cadastrado?' });
    }
    const user = { id: this.lastID, nome, email };
    return res.json({ success: true, token: genToken(user), usuario: user });
  });
});

app.post('/auth/login', (req, res) => {
  const { email, senha } = req.body;
  db.get('SELECT id, nome, email, senha FROM usuarios WHERE email = ?', [email], (err, row) => {
    if (err || !row) return res.status(401).json({ error: 'Credenciais inválidas' });
    if (!bcrypt.compareSync(senha, row.senha)) return res.status(401).json({ error: 'Credenciais inválidas' });
    const user = { id: row.id, nome: row.nome, email: row.email };
    return res.json({ success: true, token: genToken(user), usuario: user });
  });
});

// Produtos
app.get('/produtos', auth, (req, res) => {
  db.all('SELECT * FROM produtos WHERE usuario_id = ? ORDER BY nome', [req.user.id], (err, rows) => {
    if (err) return res.status(500).json({ error: 'Erro ao listar' });
    return res.json(rows);
  });
});

app.post('/produtos', auth, (req, res) => {
  const { codigo, nome, categoria, preco, estoque } = req.body;
  const stmt = db.prepare(`INSERT INTO produtos (usuario_id, codigo, nome, categoria, preco, estoque) VALUES (?, ?, ?, ?, ?, ?)`);
  stmt.run([req.user.id, codigo, nome, categoria || null, preco, estoque], function(err) {
    if (err) return res.status(400).json({ error: 'Código já existe?' });
    return res.json({ id: this.lastID });
  });
});

app.put('/produtos/:id', auth, (req, res) => {
  const { id } = req.params;
  const { codigo, nome, categoria, preco, estoque } = req.body;
  const stmt = db.prepare(`UPDATE produtos SET codigo=?, nome=?, categoria=?, preco=?, estoque=?, updated_at=CURRENT_TIMESTAMP WHERE id=? AND usuario_id=?`);
  stmt.run([codigo, nome, categoria || null, preco, estoque, id, req.user.id], function(err) {
    if (err) return res.status(400).json({ error: 'Erro ao atualizar' });
    return res.json({ success: this.changes > 0 });
  });
});

app.delete('/produtos/:id', auth, (req, res) => {
  const { id } = req.params;
  const stmt = db.prepare('DELETE FROM produtos WHERE id=? AND usuario_id=?');
  stmt.run([id, req.user.id], function(err) {
    if (err) return res.status(400).json({ error: 'Erro ao excluir' });
    return res.json({ success: this.changes > 0 });
  });
});

// Vendas
app.get('/vendas', auth, (req, res) => {
  db.all(`SELECT v.*, (SELECT COUNT(*) FROM venda_itens vi WHERE vi.venda_id=v.id) as total_itens
          FROM vendas v WHERE v.usuario_id=? ORDER BY v.data DESC`, [req.user.id], (err, rows) => {
    if (err) return res.status(500).json({ error: 'Erro ao listar' });
    return res.json(rows);
  });
});

app.post('/vendas', auth, (req, res) => {
  const { total, desconto, forma_pagamento, itens } = req.body;
  db.run(`INSERT INTO vendas (usuario_id, total, desconto, forma_pagamento) VALUES (?, ?, ?, ?)`,
    [req.user.id, total, desconto || 0, forma_pagamento], function(err) {
      if (err) return res.status(400).json({ error: 'Erro ao criar venda' });
      const vendaId = this.lastID;
      const stmt = db.prepare(`INSERT INTO venda_itens (venda_id, produto_id, quantidade, preco_unitario) VALUES (?, ?, ?, ?)`);
      for (const item of itens || []) {
        stmt.run([vendaId, item.id, item.quantidade, item.preco]);
        db.run('UPDATE produtos SET estoque = estoque - ? WHERE id = ? AND usuario_id = ?', [item.quantidade, item.id, req.user.id]);
      }
      return res.json({ id: vendaId });
    });
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`PDV Server rodando na porta ${PORT}`);
});


