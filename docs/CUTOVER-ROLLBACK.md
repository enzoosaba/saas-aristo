# Fase 3B parte 7 — cutover e rollback (aristo_app)

## O que o cutover realmente é

Uma única variável de ambiente: `APP_DATABASE_URL`.

`src/server/database.ts`'s `pool()` conecta usando `APP_DATABASE_URL` se
ela estiver definida; caso contrário usa `DATABASE_URL` (o dono do schema,
que ignora RLS). Nenhum outro código muda entre os dois estados. Nenhuma
migração de schema, nenhum dado é reescrito.

## Como fazer o cutover

1. No ambiente em questão (produção, ou onde o app estiver rodando),
   definir `APP_DATABASE_URL` com a connection string de `aristo_app`
   (gerada por `pnpm db:provision-app-role` — ver `scripts/provision-app-role.mjs`).
2. Reiniciar o processo do app (`node server.js` / container / `next start`).
3. Pronto — o app agora conecta como `aristo_app` (RLS ativo).

## Como reverter (rollback)

1. Remover a variável `APP_DATABASE_URL` do ambiente (ou apontá-la de
   volta para o mesmo valor de `DATABASE_URL`, o que produz o mesmo
   efeito).
2. Reiniciar o processo do app.
3. Pronto — o app volta a conectar como `postgres` (dono, RLS inerte),
   exatamente como se o cutover nunca tivesse acontecido.

Nenhum passo acima toca em schema, policy, ou dado. É reversível pelas
mesmas duas ações (trocar variável + restart) em qualquer direção,
quantas vezes for preciso.

## O que observar depois do cutover, e o que cada sintoma significa

- **Erro genérico "new row violates row-level security policy" ou 403
  inesperado em qualquer rota** → uma policy está mais restritiva do que
  deveria para um caso de uso real que os 7 lotes não cobriram. Reverter
  imediatamente; investigar com calma depois (não corrigir a policy em
  produção sob pressão).
- **Uma ação relatada como bem-sucedida mas sem efeito perceptível**
  (ex.: "salvei o perfil mas o nome não mudou") → candidato ao padrão já
  mapeado nesta fase: uma policy excluiu a linha via `USING`, a
  `UPDATE`/`DELETE` afetou 0 linhas silenciosamente, e a rota não checou
  o resultado. Reverter; depois localizar a rota específica (a auditoria
  de rowCount feita antes do cutover já cobriu os pontos conhecidos —
  qualquer caso novo é uma rota não mapeada).
- **Erro 500 não catalogado em qualquer fluxo de escrita
  (`INSERT ... ON CONFLICT DO UPDATE`)** → uma policy rejeitou uma
  atualização que deveria ser permitida (esse tipo de upsert lança erro
  em vez de silenciar, ao contrário de um `UPDATE ... WHERE` comum —
  verificado empiricamente durante a auditoria pré-parte-6). Reverter;
  investigar qual policy.
- **Lentidão perceptível** → não esperado (as policies usam funções
  `STABLE`/índices já existentes), mas se aparecer, não é motivo de
  rollback por si só — investigar via `EXPLAIN ANALYZE` antes de decidir.

## Fluxos que precisam ter sido exercitados sem erro antes de considerar o
## cutover estável (mapeados lote a lote ao longo da Fase 3B)

- Registro de conta nova (users + profiles + tenant_members +
  organization_members, tudo numa transação — o gap que quase passou
  despercebido antes da parte 6).
- Login e resolução de sessão (`resolve_session_user`).
- Edição de perfil (nome, avatar).
- Troca de senha (autenticado) e recuperação de senha (token, sem sessão).
- Mentor adicionando aluno (`addStudent`) e removendo aluno
  (`removeStudent`, incluindo o caso de liberar a matrícula quando o
  aluno fica sem nenhum mentor).
- Leitura do roster do mentor e do resumo diário de um aluno específico.
- Ranking da mentoria (`get_mentor_ranking`).
- Criação/edição/exclusão de items, records, plans, questions,
  study_sessions.
- Logout e revogação de sessões (troca de senha derruba outras sessões).

Todos os fluxos acima são exercitados automaticamente por
`pnpm test:postgres`, que agora roda a suíte completa de e2e **duas
vezes** — uma como `postgres` (paridade), outra como `aristo_app` (RLS
real) — contra dois bancos Postgres descartáveis independentes. Rodar
essa suíte com sucesso é a evidência mínima de que o cutover é seguro
antes de tocar no ambiente real.
