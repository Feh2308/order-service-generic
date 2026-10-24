# Deploy em Ubuntu

Guia genérico para publicar o sistema de gestão de serviços.

## Configuração

1. Copie o projeto para `/var/www/service-manager`.
2. Configure `backend/.env` com os dados da sua empresa, API, frontend e banco.
3. Use um domínio próprio, por exemplo `app.suaempresa.com` e `api.suaempresa.com`.
4. Instale as dependências com `npm install` e execute o backend com PM2 usando o nome `service-manager`.
5. Configure o Nginx a partir do arquivo em `deploy/nginx`, substituindo `seu-dominio.exemplo.com` pelo domínio escolhido.
6. Emita o certificado TLS para os domínios da sua instalação.

## Variáveis essenciais

```env
APP_NAME=Gestão de Serviços
PUBLIC_URL=https://api.suaempresa.com
FRONTEND_URL=https://app.suaempresa.com
CORS_ORIGINS=https://app.suaempresa.com
DB_STORAGE_TABLE=service_manager_store
```

## Verificação

```bash
curl https://api.suaempresa.com/api/health
```

Mantenha os domínios, credenciais, nome da empresa e dados de backup específicos de cada cliente fora do código-fonte genérico.
