const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');
const { exec } = require('child_process');
const { promisify } = require('util');
const execAsync = promisify(exec);
const { initDatabase, usuarios, produtos, vendas, sessoes, clientes } = require('./database');

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
      contextIsolation: false,
      // Otimizações de performance para PCs lentos
      enableWebSQL: false,
      enableRemoteModule: false,
      // Reduzir uso de memória
      backgroundThrottling: false, // Manter app responsivo mesmo em background
      // Desabilitar recursos desnecessários
      spellcheck: false,
      // Otimizações de renderização
      offscreen: false
    },
    autoHideMenuBar: true,
    title: 'PDV Desk - Sistema de Vendas',
    icon: path.join(__dirname, 'build', 'icon.png'),
    // Otimizações visuais para melhor performance
    show: false, // Não mostrar até estar pronto
    backgroundColor: '#f0f2f5' // Cor de fundo padrão
  });
  
  // Mostrar janela apenas quando estiver pronta (melhora percepção de performance)
  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
  });

  mainWindow.loadFile('pdv-standalone.html');

  // Habilitar F12 para abrir DevTools (apenas em desenvolvimento)
  // Em produção, desabilitar DevTools para melhor performance
  const isDev = process.env.NODE_ENV === 'development' || !app.isPackaged;
  
  if (isDev) {
    mainWindow.webContents.on('before-input-event', (event, input) => {
      if (input.key === 'F12') {
        if (mainWindow.webContents.isDevToolsOpened()) {
          mainWindow.webContents.closeDevTools();
        } else {
          mainWindow.webContents.openDevTools();
        }
      }
    });
  }
  
  // Otimizações de memória e performance
  mainWindow.webContents.on('did-finish-load', () => {
    // Executar garbage collection periodicamente em PCs lentos (apenas em produção)
    if (!isDev && process.platform === 'win32') {
      // Configurar limpeza de memória a cada 5 minutos
      setInterval(() => {
        if (global.gc) {
          global.gc();
        }
      }, 300000); // 5 minutos
    }
  });
  
  // Reduzir uso de recursos quando janela está minimizada
  mainWindow.on('minimize', () => {
    if (!isDev) {
      mainWindow.webContents.setFrameRate(10); // Reduzir FPS quando minimizado
    }
  });
  
  mainWindow.on('restore', () => {
    mainWindow.webContents.setFrameRate(60); // Restaurar FPS normal
  });
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
    // Salvar sessão permanentemente
    sessoes.salvar(usuarioLogado.id, usuarioLogado.email);
    return { success: true, usuario: usuarioLogado };
  }
  // Fallback local
  const result = usuarios.login(email, senha);
  if (result.success) {
    usuarioLogado = result.usuario;
    // Salvar sessão permanentemente
    sessoes.salvar(usuarioLogado.id, usuarioLogado.email);
  }
  return result;
});

ipcMain.handle('logout', () => {
  usuarioLogado = null;
  serverToken = null;
  return { success: true };
});

ipcMain.handle('get-usuario-logado', async () => {
  // Sempre buscar do banco para garantir dados atualizados
  if (usuarioLogado) {
    const usuarioAtualizado = usuarios.buscarPorId(usuarioLogado.id);
    if (usuarioAtualizado) {
      usuarioLogado = usuarioAtualizado;
    }
  }
  return usuarioLogado;
});

ipcMain.handle('usuario-atualizar', async (event, dados) => {
  if (!usuarioLogado) return { success: false, error: 'Usuário não logado' };
  
  // Verificar se o email já está em uso por outro usuário
  if (dados.email && dados.email !== usuarioLogado.email) {
    const result = usuarios.buscarPorEmail(dados.email);
    if (result && result.id !== usuarioLogado.id) {
      return { success: false, error: 'Este email já está em uso por outro usuário' };
    }
  }
  
  const resultado = usuarios.atualizar(usuarioLogado.id, dados);
  
  if (resultado.success) {
    // Atualizar usuarioLogado local
    const usuarioAtualizado = usuarios.buscarPorId(usuarioLogado.id);
    if (usuarioAtualizado) {
      usuarioLogado = usuarioAtualizado;
    }
  }
  
  return resultado;
});

// Verificar sessão salva ao iniciar
ipcMain.handle('verificar-sessao', async () => {
  const sessao = sessoes.obter();
  if (!sessao) {
    return { success: false };
  }

  // Buscar usuário pelo ID
  const usuario = usuarios.buscarPorId(sessao.usuario_id);
  if (!usuario) {
    // Sessão inválida, remover
    sessoes.remover();
    return { success: false };
  }

  usuarioLogado = usuario;
  return { success: true, usuario: usuarioLogado };
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

ipcMain.handle('venda-buscar', async (event, id) => {
  if (!usuarioLogado) return null;
  if (serverToken) {
    const data = await tryServer(`/vendas/${id}`, { headers: { Authorization: `Bearer ${serverToken}` } });
    if (data) return data;
  }
  return vendas.buscarComItens(id);
});

ipcMain.handle('vendas-estatisticas', () => {
  if (!usuarioLogado) return { vendasHoje: 0, vendasMes: 0, totalProdutos: 0 };
  return vendas.estatisticas(usuarioLogado.id);
});

ipcMain.handle('venda-deletar', async (event, id) => {
  if (!usuarioLogado) return { success: false, error: 'Usuário não logado' };
  if (serverToken) {
    const resp = await tryServer(`/vendas/${id}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${serverToken}` }
    });
    if (resp) return { success: true };
  }
  return vendas.deletar(id, usuarioLogado.id);
});

// IPC Handlers - Clientes
ipcMain.handle('cliente-criar', async (event, cliente) => {
  if (!usuarioLogado) return { success: false, error: 'Usuário não logado' };
  if (serverToken) {
    const resp = await tryServer('/clientes', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${serverToken}` },
      body: JSON.stringify(cliente)
    });
    if (resp && resp.id) return { success: true, id: resp.id };
  }
  return clientes.criar(cliente, usuarioLogado.id);
});

ipcMain.handle('clientes-listar', async () => {
  if (!usuarioLogado) return [];
  if (serverToken) {
    const data = await tryServer('/clientes', { headers: { Authorization: `Bearer ${serverToken}` } });
    if (data) return data;
  }
  return clientes.listar(usuarioLogado.id);
});

ipcMain.handle('cliente-buscar', (event, id) => {
  return clientes.buscar(id);
});

ipcMain.handle('cliente-atualizar', async (event, { id, cliente }) => {
  if (!usuarioLogado) return { success: false, error: 'Usuário não logado' };
  if (serverToken) {
    const resp = await tryServer(`/clientes/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${serverToken}` },
      body: JSON.stringify(cliente)
    });
    if (resp) return { success: true };
  }
  return clientes.atualizar(id, cliente, usuarioLogado.id);
});

ipcMain.handle('cliente-excluir', async (event, id) => {
  if (!usuarioLogado) return { success: false, error: 'Usuário não logado' };
  if (serverToken) {
    const resp = await tryServer(`/clientes/${id}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${serverToken}` }
    });
    if (resp) return { success: true };
  }
  return clientes.excluir(id, usuarioLogado.id);
});
