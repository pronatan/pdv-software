# PDV Desk

Sistema de Ponto de Venda profissional para Windows.

## 🚀 Download

**Site hospedado no Cloudflare Pages:** [Acesse o site](https://pdv-software.pages.dev) (após configurar o deploy)

Ou baixe diretamente do GitHub Releases:
- [PDV Desk Setup 1.7.0.exe](https://github.com/pronatan/pdv-software/releases/download/v1.7.0/PDV%20Desk%20Setup%201.7.0.exe)

## 📦 Estrutura do Projeto

```
pdv/
├── index.html                          # Site de download
├── instalador/
│   └── PDV Desk Setup 1.7.0.exe       # Instalador
├── build/                              # Ícones do sistema
├── main.js                             # Aplicação Electron principal
├── pdv-standalone.html                 # Interface do PDV
├── package.json                        # Configurações
└── node_modules/                       # Dependências
```

## 💻 Para Desenvolvedores

### Instalar dependências:
```bash
npm install
```

### Rodar em desenvolvimento:
```bash
npm start
```

### Gerar novo instalador:
```bash
npm run build
```

## ✨ Recursos

- ✅ Vendas rápidas
- ✅ Gestão de produtos
- ✅ Controle de estoque
- ✅ Histórico de vendas
- ✅ Múltiplas formas de pagamento
- ✅ Interface moderna
- ✅ Funciona offline

## 📋 Requisitos do Sistema

- Windows 10 ou superior
- 2 GB RAM (mínimo)
- 500 MB de espaço em disco

## 🎨 Hospedagem no Cloudflare Pages

O site está configurado para ser hospedado no Cloudflare Pages. Veja o guia completo em [`CLOUDFLARE-SETUP.md`](CLOUDFLARE-SETUP.md).

**Resumo:**
1. O instalador (79.5 MB) é muito grande para Cloudflare Pages (limite: 25 MB)
2. O instalador deve ser hospedado no GitHub Releases
3. O site (`index.html`) aponta para o GitHub Releases para download
4. Configure o deploy no Cloudflare Pages conectando este repositório

**Importante:** Antes do deploy, crie uma release no GitHub com o executável anexado.

## 📝 Licença

MIT

