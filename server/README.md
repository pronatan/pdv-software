PDV Server (Node.js + Express)

Como rodar

1. Entre na pasta server:
   cd server

2. Instale dependências:
   npm install

3. (Opcional) Crie um .env para configurar porta/segredo JWT:
   JWT_SECRET=troque-este-segredo
   PORT=3001

4. Inicie:
   npm start

Endpoints principais

- POST /auth/register { nome, email, senha }
- POST /auth/login { email, senha }
- GET /produtos (Bearer token)
- POST /produtos (Bearer token)
- PUT /produtos/:id (Bearer token)
- DELETE /produtos/:id (Bearer token)
- GET /vendas (Bearer token)
- POST /vendas (Bearer token)  body: { total, desconto, forma_pagamento, itens:[{id, quantidade, preco}] }

Banco de dados

- SQLite salvo em server/server-data/pdv-server.db
- Tabelas: usuarios, produtos, vendas, venda_itens
- Campos updated_at para futuras sincronizações por data de alteração


