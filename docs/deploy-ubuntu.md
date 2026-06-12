# Deploy em VPS Ubuntu

URL de producao: `https://services.egautomacoes.com.br`

Este guia publica o servidor Node em uma VPS Ubuntu com PM2, Nginx, HTTPS e suporte a Socket.IO/WebSocket. Por enquanto o sistema continua usando `data/db.json`; a estrutura ja deixa `DB_CLIENT` e `DATABASE_URL` preparados para a futura migracao para PostgreSQL.

## 1. DNS

No painel do seu dominio, crie um registro `A`:

```text
services.egautomacoes.com.br -> IP_PUBLICO_DA_VPS
```

Aguarde a propagacao antes de emitir o HTTPS.

## 2. Preparar a VPS

Entre no servidor:

```bash
ssh root@IP_PUBLICO_DA_VPS
```

Atualize o Ubuntu e instale dependencias:

```bash
apt update
apt upgrade -y
apt install -y git nginx certbot python3-certbot-nginx curl build-essential
```

Instale Node.js LTS:

```bash
curl -fsSL https://deb.nodesource.com/setup_lts.x | bash -
apt install -y nodejs
node -v
npm -v
```

Instale PM2:

```bash
npm install -g pm2
```

## 3. Enviar o projeto

Exemplo usando Git:

```bash
mkdir -p /var/www
cd /var/www
git clone URL_DO_SEU_REPOSITORIO eg-services
cd /var/www/eg-services
npm ci
```

Se voce ainda nao tiver repositorio Git remoto, envie a pasta do projeto para `/var/www/eg-services` por SFTP/ZIP e rode:

```bash
cd /var/www/eg-services
npm install
```

## 4. Configurar ambiente

Crie o `.env` a partir do exemplo:

```bash
cd /var/www/eg-services
cp .env.example .env
nano .env
```

Confira estes valores:

```env
NODE_ENV=production
PUBLIC_URL=https://services.egautomacoes.com.br
HOST=0.0.0.0
PORT=3000
DB_CLIENT=json
DATA_DIR=./data
DATA_FILE=db.json
```

Enquanto estiver usando `data/db.json`, mantenha `instances: 1` no `ecosystem.config.js`. Nao use cluster com arquivo JSON, porque duas instancias poderiam gravar no mesmo arquivo ao mesmo tempo.

## 5. Testar o servidor localmente na VPS

```bash
npm run check
npm start
```

Em outro terminal da VPS:

```bash
curl http://127.0.0.1:3000/api/health
```

Se responder `ok`, pare o processo manual com `Ctrl+C`.

## 6. Subir com PM2

```bash
cd /var/www/eg-services
pm2 start ecosystem.config.js
pm2 save
pm2 startup
```

O comando `pm2 startup` vai mostrar outro comando com `sudo env ...`. Copie e execute exatamente o comando que ele mostrar.

Comandos uteis:

```bash
pm2 status
pm2 logs eg-services
pm2 restart eg-services
pm2 reload eg-services
```

## 7. Configurar Nginx com WebSocket

Copie o exemplo:

```bash
cp /var/www/eg-services/deploy/nginx/services.egautomacoes.com.br.conf /etc/nginx/sites-available/services.egautomacoes.com.br
ln -s /etc/nginx/sites-available/services.egautomacoes.com.br /etc/nginx/sites-enabled/services.egautomacoes.com.br
nginx -t
systemctl reload nginx
```

Libere firewall se estiver usando UFW:

```bash
ufw allow OpenSSH
ufw allow "Nginx Full"
ufw enable
```

## 8. Emitir HTTPS

```bash
certbot --nginx -d services.egautomacoes.com.br
```

Depois teste:

```bash
curl https://services.egautomacoes.com.br/api/health
```

## 9. Usar no APK, EXE e navegador

No app Admin ou Funcionario, abra `Conexao do servidor` e coloque:

```text
https://services.egautomacoes.com.br
```

Todos os dispositivos que apontarem para essa URL vao usar as mesmas ordens, clientes, materiais, equipes, assinaturas e status.

## 10. Backup temporario do data/db.json

Enquanto o sistema usa JSON, faca backup diario:

```bash
mkdir -p /var/backups/eg-services
cp /var/www/eg-services/data/db.json /var/backups/eg-services/db-$(date +%F-%H%M).json
```

Sugestao de cron diario as 02:00:

```bash
crontab -e
```

Adicione:

```cron
0 2 * * * cp /var/www/eg-services/data/db.json /var/backups/eg-services/db-$(date +\%F-\%H\%M).json
```

## 11. Atualizar o sistema

Se estiver usando Git:

```bash
cd /var/www/eg-services
git pull
npm ci
npm run check
pm2 reload eg-services
```

Se enviar por ZIP/SFTP, substitua os arquivos, mantenha `data/db.json` e `.env`, depois rode:

```bash
npm install
npm run check
pm2 reload eg-services
```

## 12. Preparacao para PostgreSQL

Quando for migrar:

1. Criar banco PostgreSQL.
2. Alterar `.env`:

```env
DB_CLIENT=postgres
DATABASE_URL=postgresql://usuario:senha@localhost:5432/eg_services
```

3. Implementar a camada de banco no backend usando `DATABASE_URL`.
4. Migrar os dados de `data/db.json` para tabelas.
5. Depois da migracao, o PM2 podera usar mais de uma instancia se necessario.

O projeto ainda grava em JSON mesmo se `DB_CLIENT` for alterado, ate a camada PostgreSQL ser implementada.
