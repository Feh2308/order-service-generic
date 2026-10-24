# Schema relacional Order Service

`001_create_relational_schema.sql` é uma migration exclusivamente aditiva.

- Não lê nem altera `public.service_manager_store`.
- Não contém `DELETE`, `DROP`, `TRUNCATE` ou `VACUUM`.
- Preserva IDs textuais existentes.
- Pode ser revisada com `npm run migration:check`.
- Só deve ser aplicada manualmente depois de backup e aprovação explícita.

Não existe migration automática de rollback destrutivo. Enquanto a tabela legada for mantida, o rollback operacional consiste em voltar o backend para o repositório legado.
