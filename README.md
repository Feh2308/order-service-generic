# EG Automacoes Services

Sistema para registrar ordens de servico no painel administrativo e enviar em tempo real para o app dos funcionarios.

## Estrutura

```text
frontend/  Interface Vite para Vercel
backend/   API Express + Socket.IO para Render
```

No local, o banco pode continuar em `backend/data/db.json`. Em producao, use Neon/PostgreSQL com `DB_CLIENT=postgres` e `DATABASE_URL`.

## Rodar localmente

Instale tudo na raiz:

```bash
npm install
```

Em um terminal, suba o backend:

```bash
npm run dev:backend
```

Em outro terminal, suba o frontend:

```bash
npm run dev:frontend
```

Acesse:

- Admin: http://localhost:5173/admin/
- Funcionario: http://localhost:5173/funcionario/
- API health: http://localhost:3000/api/health

Para o frontend local apontar para a API local, use `frontend/.env` baseado em `frontend/.env.example`:

```text
VITE_API_URL=http://localhost:3000
```

## Deploy

### Frontend na Vercel

- Root Directory: `frontend`
- Build Command: `npm run build`
- Output Directory: `dist`
- Environment Variable: `VITE_API_URL=https://SUA-API-DO-RENDER`

### Backend no Render

- Root Directory: `backend`
- Build Command: `npm install`
- Start Command: `npm start`
- Environment Variables: copie de `backend/.env.example`

Variaveis importantes no Render:

```text
PORT=3000
PUBLIC_URL=https://SUA-API-DO-RENDER
FRONTEND_URL=https://services.egautomacoes.com.br
CORS_ORIGINS=https://services.egautomacoes.com.br,https://SUA-API-DO-RENDER
DB_CLIENT=postgres
DATABASE_URL=postgresql://USER:PASSWORD@HOST.neon.tech/DBNAME?sslmode=require
DATABASE_SSL=true
DB_STORAGE_TABLE=eg_services_store
DATA_DIR=./data
DATA_FILE=db.json
```

## Acessos iniciais

Admin:

- E-mail: `admin@egautomacoes.local`
- Senha: `admin123`

Funcionarios de exemplo:

- Carlos Silva: PIN `1234`
- Marina Souza: PIN `5678`

## Verificacoes

```bash
npm run check
npm run build:frontend
npm --prefix backend start
```

## Apps APK e EXE

O projeto segue preparado para empacotar a interface como Android APK com Capacitor e Windows EXE com Electron. Os comandos geram o build do frontend antes de sincronizar/abrir:

```bash
npm run android:sync
npm run android:build:debug
npm run desktop:admin
npm run desktop:funcionario
npm run desktop:build
```

## Funcionamento

- O admin cadastra clientes, materiais, funcionarios, equipes e servicos.
- O servico pode ser filtrado por cliente, equipe, periodo e status.
- O admin monta romaneio por codigo de material, com quantas pecas forem necessarias.
- O funcionario recebe a ordem de servico com cliente, materiais, data, horario, local e equipe.
- O funcionario registra localizacao pontual ao iniciar e ao finalizar. Nao ha rastreamento continuo.
- Ao finalizar, o funcionario coleta assinatura digital do cliente/responsavel.
- O admin acompanha agendados, iniciados, cancelados e finalizados em tempo real.
