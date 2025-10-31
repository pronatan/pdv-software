const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const { initDatabase, usuarios, produtos, vendas } = require('./database');

let mainWindow;
let usuarioLogado = null;
let serverToken = null;
const SERVER_URL = process.env.PDV_SERVER_URL || 'http://localhost:3001';

async function tryServer(pathname, options = {}) {
  try {
    const res = await fetch(`${SERVER_URL}${pathname}`, options);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } catch (e) {
    return null;
  }
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false
    },
    autoHideMenuBar: true,
    title: 'PDV Desktop - Sistema de Vendas',
    icon: path.join(__dirname, 'build', 'icon.png')
  });

  mainWindow.loadFile('pdv-standalone.html');

  // Abrir DevTools em desenvolvimento
  // mainWindow.webContents.openDevTools();
}

// Inicializar banco de dados
app.whenReady().then(async () => {
  // Garante integração correta com a Pesquisa/Start do Windows
  try { app.setAppUserModelId('com.pdv.desktop'); } catch (e) {}
  await initDatabase();
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

// IPC Handlers - Usuários
ipcMain.handle('verificar-primeiro-acesso', () => {
  return !usuarios.existeUsuarios();
});

ipcMain.handle('criar-usuario', async (event, { nome, email, senha }) => {
  // Tenta no servidor
  const serverResp = await tryServer('/auth/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ nome, email, senha })
  });
  if (serverResp && serverResp.success) {
    serverToken = serverResp.token;
    // garante usuário também local
    const local = usuarios.criar(nome, email, senha);
    return { success: true, id: serverResp.usuario.id };
  }
  // Fallback local
  return usuarios.criar(nome, email, senha);
});

ipcMain.handle('login', async (event, { email, senha }) => {
  // Tenta no servidor
  const serverResp = await tryServer('/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, senha })
  });
  if (serverResp && serverResp.success) {
    serverToken = serverResp.token;
    usuarioLogado = serverResp.usuario;
    return { success: true, usuario: usuarioLogado };
  }
  // Fallback local
  const result = usuarios.login(email, senha);
  if (result.success) {
    usuarioLogado = result.usuario;
  }
  return result;
});

ipcMain.handle('logout', () => {
  usuarioLogado = null;
  serverToken = null;
  return { success: true };
});

ipcMain.handle('get-usuario-logado', () => {
  return usuarioLogado;
});

// IPC Handlers - Produtos
ipcMain.handle('produtos-listar', async () => {
  if (!usuarioLogado) return [];
  if (serverToken) {
    const data = await tryServer('/produtos', { headers: { Authorization: `Bearer ${serverToken}` } });
    if (data) return data;
  }
  return produtos.listar(usuarioLogado.id);
});

ipcMain.handle('produto-criar', async (event, produto) => {
  if (!usuarioLogado) return { success: false, error: 'Usuário não logado' };
  if (serverToken) {
    const resp = await tryServer('/produtos', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${serverToken}` },
      body: JSON.stringify(produto)
    });
    if (resp && resp.id) return { success: true, id: resp.id };
  }
  return produtos.criar(produto, usuarioLogado.id);
});

ipcMain.handle('produto-atualizar', async (event, { id, produto }) => {
  if (serverToken) {
    const resp = await tryServer(`/produtos/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${serverToken}` },
      body: JSON.stringify(produto)
    });
    if (resp && resp.success) return { success: true };
  }
  return produtos.atualizar(id, produto);
});

ipcMain.handle('produto-deletar', async (event, id) => {
  if (serverToken) {
    const resp = await tryServer(`/produtos/${id}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${serverToken}` }
    });
    if (resp && resp.success) return { success: true };
  }
  return produtos.deletar(id);
});

ipcMain.handle('produto-buscar-codigo', (event, codigo) => {
  if (!usuarioLogado) return null;
  // Apenas local por enquanto
  return produtos.buscarPorCodigo(codigo, usuarioLogado.id);
});

// IPC Handlers - Vendas
ipcMain.handle('venda-criar', async (event, { venda, itens }) => {
  if (!usuarioLogado) return { success: false, error: 'Usuário não logado' };
  if (serverToken) {
    const resp = await tryServer('/vendas', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${serverToken}` },
      body: JSON.stringify({ ...venda, itens })
    });
    if (resp && resp.id) return { success: true, id: resp.id };
  }
  return vendas.criar(venda, itens, usuarioLogado.id);
});

ipcMain.handle('vendas-listar', async () => {
  if (!usuarioLogado) return [];
  if (serverToken) {
    const data = await tryServer('/vendas', { headers: { Authorization: `Bearer ${serverToken}` } });
    if (data) return data;
  }
  return vendas.listar(usuarioLogado.id);
});

ipcMain.handle('venda-buscar', (event, id) => {
  return vendas.buscarComItens(id);
});

ipcMain.handle('vendas-estatisticas', () => {
  if (!usuarioLogado) return { vendasHoje: 0, vendasMes: 0, totalProdutos: 0 };
  return vendas.estatisticas(usuarioLogado.id);
});

