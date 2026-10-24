# Migração segura do JSONB para PostgreSQL relacional

Este documento descreve uma migração opcional para instalações do Order Service. A aplicação local de apresentação continua usando JSON e não precisa desta etapa.

## Estado seguro

Mantenha estes valores até existir uma aprovação explícita para a migração:

```dotenv
DATA_REPOSITORY=legacy
MIGRATION_ALLOW_WRITES=false
OBJECT_STORAGE_ENABLED=false
```

O repositório legado (`service_manager_store`) permanece preservado. Não execute os comandos de aplicação contra o ambiente de demonstração local.

## Backup

Pré-requisitos: `backend/.env` apontando para um PostgreSQL de homologação ou produção e `pg_dump` disponível.

```powershell
npm --prefix backend run backup:postgres
```

O backup é somente leitura, cria uma nova pasta em `backups/` e salva o dump SQL, a exportação do registro legado, o manifesto e o relatório de estabilidade. Esses arquivos podem conter dados reais e não devem ser enviados ao Git.

## Object Storage

Para mídias de OS, use um bucket privado compatível com S3, como Amazon S3, Cloudflare R2 ou outro provedor equivalente:

1. Crie um bucket privado de homologação.
2. Use uma credencial limitada ao bucket.
3. Não habilite acesso público.
4. Configure CORS apenas para os domínios autorizados.
5. Comece com um bucket separado do definitivo.

```dotenv
OBJECT_STORAGE_ENABLED=false
OBJECT_STORAGE_PROVIDER=s3
OBJECT_STORAGE_ENDPOINT=https://ACCOUNT_ID.r2.cloudflarestorage.com
OBJECT_STORAGE_REGION=auto
OBJECT_STORAGE_BUCKET=order-service-private
OBJECT_STORAGE_ACCESS_KEY_ID=
OBJECT_STORAGE_SECRET_ACCESS_KEY=
OBJECT_STORAGE_MAX_BYTES=3145728
OBJECT_STORAGE_FORCE_PATH_STYLE=false
OBJECT_STORAGE_SIGNED_URL_TTL_SECONDS=300
```

As chaves de mídia seguem o formato `services/{serviceId}/photos/before/{sha256}.jpg`, `services/{serviceId}/photos/after/{sha256}.jpg` e `services/{serviceId}/signatures/{sha256}.png`. URLs de download são temporárias e não são persistidas.

## Schema relacional

Arquivo: `backend/sql/relational/001_create_relational_schema.sql`.

A migration cria apenas tabelas, índices e foreign keys com o prefixo `order_`. Ela não lê, altera ou remove `service_manager_store` e não contém operações destrutivas.

Validação estática:

```powershell
npm --prefix backend run migration:check
```

Aplicação manual futura, somente após backup, revisão e aprovação:

```powershell
psql "$env:DATABASE_URL" -v ON_ERROR_STOP=1 -f backend/sql/relational/001_create_relational_schema.sql
```

## Dry-run

O dry-run lê a origem JSONB e gera um relatório local. Não cria tabelas, não envia arquivos e não grava no banco.

```powershell
npm --prefix backend run migration:dry-run
```

Guarde o `source.sha256`. A aplicação futura exige exatamente esse valor e falha se a origem mudar.

## Aplicação futura

Não executar antes da aprovação final:

```powershell
$env:MIGRATION_ALLOW_WRITES="true"
$env:OBJECT_STORAGE_ENABLED="true"
npm --prefix backend run migration:apply -- --confirm-source-sha=SHA_EXATO_DO_DRY_RUN
```

O processo valida a origem, insere as entidades base, envia mídias com chaves determinísticas, migra serviços e eventos e registra o progresso em `order_migration_runs`. IDs são preservados e repetições usam `ON CONFLICT` para evitar duplicidade.

## Paridade e corte

```powershell
npm --prefix backend run migration:verify
```

O relatório compara contagens, IDs, códigos de OS, pagamentos recebidos, fotos, assinaturas, SHA-256 e tamanho dos arquivos. O corte só pode ocorrer quando `ok: true` e as listas `missing`, `unexpected` e `mismatches` estiverem vazias.

Durante o corte:

1. Mantenha o repositório legado disponível.
2. Faça a migração inicial em paralelo.
3. Valide o relatório em homologação.
4. Faça a troca de leitura somente após a paridade.
5. Preserve os contratos das rotas `/api/*`, Socket.IO e dos relatórios.

## Rollback

Antes ou durante a escrita espelhada:

1. Defina `DATA_REPOSITORY=legacy`.
2. Faça o redeploy do backend.
3. Não apague as tabelas relacionais nem os objetos do bucket.
4. Compare novamente o JSON legado com o manifesto.

Não há rollback destrutivo automático. A tabela legada e os backups devem permanecer disponíveis até a conclusão formal da migração.

## Testes

```powershell
npm --prefix backend run check
npm --prefix backend run migration:check
npm --prefix backend test
npm --prefix frontend run check
npm --prefix frontend run build
```
