# Contribuindo com o Order Service

Obrigado por considerar contribuir. O projeto busca permanecer genérico, seguro e fácil de adaptar a qualquer empresa.

## Antes de começar

Leia o [README.md](README.md) e confirme que você tem:

- Node.js 20 ou superior;
- npm 10 ou superior;
- Git;
- ambiente local configurado;
- nenhum dado real ou segredo no diretório de trabalho.

## Fluxo recomendado

1. Abra uma issue explicando o problema, contexto e resultado esperado.
2. Atualize sua branch principal antes de começar.
3. Crie uma branch específica:

~~~bash
git switch main
git pull
git switch -c feat/nome-da-mudanca
~~~

4. Implemente uma alteração pequena e revisável.
5. Adicione ou atualize os testes.
6. Atualize a documentação.
7. Execute as validações:

~~~bash
npm run check
npm run build:frontend
npm --prefix backend run migration:check
npm --prefix backend test
~~~

8. Faça commits claros.
9. Abra o pull request descrevendo o que mudou, como testar e quais riscos existem.

## Convenção de commits

Use o formato:

~~~text
tipo: descrição curta no infinitivo
~~~

Tipos aceitos:

- `feat`: funcionalidade;
- `fix`: correção;
- `docs`: documentação;
- `test`: testes;
- `refactor`: refatoração;
- `chore`: manutenção;
- `security`: melhoria de segurança.

Exemplos:

~~~text
feat: permitir abertura de OS pelo funcionário
fix: impedir acesso a serviço de outra equipe
docs: documentar configuração local
test: cobrir permissão de finalização
~~~

## Regras para mudanças

### Backend

- Toda permissão deve ser validada no servidor.
- Não confie em IDs, preços, equipes ou papéis enviados pelo cliente.
- Preserve os contratos atuais da API quando não houver uma decisão explícita de mudança.
- Crie testes para regras de autorização e cenários de erro.
- Evite alterações destrutivas no armazenamento.
- Use mensagens de erro claras, sem expor segredos.

### Frontend

- Mantenha acessibilidade básica, labels e navegação por teclado.
- Mostre apenas ações disponíveis, sem usar isso como única camada de segurança.
- Preserve o funcionamento em telas pequenas.
- Atualize os arquivos de checagem quando adicionar novos módulos.
- Não coloque URLs ou credenciais fixas no código.

### Dados e ambiente

- Não inclua `.env`, tokens, senhas, dumps, backups ou dados reais.
- Use apenas dados fictícios nos testes e na apresentação.
- Não habilite `DEMO_MODE` em produção.
- Não altere o projeto de produção para validar uma mudança da cópia genérica.
- Não adicione nomes, logos, domínios ou regras específicas de uma empresa ao núcleo genérico.

## Pull request

O pull request deve informar:

- resumo da alteração;
- motivo da alteração;
- como testar;
- endpoints ou telas afetadas;
- riscos e pontos de atenção;
- evidência dos testes executados.

Checklist:

- [ ] alteração pequena e focada;
- [ ] testes novos ou atualizados;
- [ ] documentação atualizada;
- [ ] `npm run check` passou;
- [ ] `npm run build:frontend` passou;
- [ ] `npm --prefix backend test` passou;
- [ ] nenhuma informação sensível foi incluída;
- [ ] validações de permissão permanecem no backend.

## Reportando problemas

Ao abrir uma issue, inclua:

- sistema operacional;
- versão do Node.js e npm;
- passos para reproduzir;
- comportamento esperado;
- comportamento observado;
- logs sem tokens ou dados sensíveis;
- screenshots, quando ajudarem.

## Segurança

Não publique vulnerabilidades em uma issue pública com detalhes exploráveis. Preserve o máximo de informações e solicite um canal privado aos mantenedores antes de divulgar o problema.

