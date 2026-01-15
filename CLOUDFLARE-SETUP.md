# Configuração do Cloudflare Pages

Este guia explica como hospedar o site do PDV Desk no Cloudflare Pages.

## Problema Resolvido

O Cloudflare Pages não aceita arquivos maiores que 25 MiB. O instalador `PDV Desk Setup 1.7.0.exe` tem 79.5 MiB, então foi necessário:

1. ✅ Excluir a pasta `instalador/` do deploy (via `.gitignore`)
2. ✅ Configurar o site para apontar para GitHub Releases para download do executável
3. ✅ Criar arquivo `wrangler.toml` para configuração do Cloudflare Pages

## Arquivos Criados/Modificados

### 1. `.gitignore`
Exclui a pasta `instalador/` e outros arquivos grandes do deploy.

### 2. `wrangler.toml`
Configuração básica do Cloudflare Pages.

### 3. `index.html`
Atualizado para usar URLs do GitHub Releases em vez de arquivos locais:
- `https://github.com/pronatan/pdv-software/releases/download/v1.7.0/PDV%20Desk%20Setup%201.7.0.exe`

## Passos para Deploy

### 1. Criar Release no GitHub

Antes de fazer o deploy, você precisa criar uma release no GitHub com o executável:

1. Vá para: https://github.com/pronatan/pdv-software/releases/new
2. Crie uma nova release com a tag `v1.7.0`
3. Faça upload do arquivo `instalador/PDV Desk Setup 1.7.0.exe` como anexo da release
4. Publique a release

### 2. Configurar Cloudflare Pages

1. Acesse o dashboard do Cloudflare: https://dash.cloudflare.com
2. Vá em **Pages** → **Create a project**
3. Conecte seu repositório GitHub: `pronatan/pdv-software`
4. Configure o build:
   - **Project name**: `pdv-software` (ou o nome que preferir)
   - **Production branch**: `main` (ou sua branch principal)
   - **Build command**: (deixe vazio - não precisa build)
   - **Build output directory**: `/` (raiz do projeto)
5. Clique em **Save and Deploy**

### 3. Configurações Adicionais (Opcional)

Se quiser usar um domínio personalizado:
1. No projeto do Pages, vá em **Custom domains**
2. Adicione seu domínio
3. Configure os registros DNS conforme instruções

## Estrutura de Arquivos no Deploy

O Cloudflare Pages vai fazer deploy apenas de:
- ✅ `index.html` (página principal)
- ✅ `imagem/` (imagens do site)
- ✅ Outros arquivos HTML/CSS/JS necessários

**NÃO será incluído:**
- ❌ `instalador/` (excluído via `.gitignore`)
- ❌ `node_modules/` (excluído via `.gitignore`)
- ❌ `server/` (se não for necessário para o site)

## Atualizar Versão

Quando criar uma nova versão:

1. Atualize a versão no `package.json`
2. Gere o novo instalador
3. Crie uma nova release no GitHub com a tag correspondente (ex: `v1.8.0`)
4. Faça upload do novo executável na release
5. Atualize as URLs no `index.html` para apontar para a nova versão
6. Faça commit e push - o Cloudflare Pages fará deploy automático

## Alternativa: Cloudflare R2

Se preferir não usar GitHub Releases, você pode:

1. Criar um bucket no Cloudflare R2
2. Fazer upload do executável para o R2
3. Criar uma URL pública do arquivo
4. Atualizar o `index.html` para usar essa URL

Vantagens do R2:
- Mais controle sobre o arquivo
- Pode configurar CDN
- Não depende do GitHub Releases

## Verificação

Após o deploy, verifique:
- ✅ O site carrega corretamente
- ✅ As imagens aparecem
- ✅ O botão de download funciona e aponta para o GitHub Releases
- ✅ O download do executável inicia corretamente

## Suporte

Se tiver problemas:
1. Verifique os logs do Cloudflare Pages
2. Confirme que a release do GitHub existe e está pública
3. Verifique se a URL do download está correta no `index.html`
