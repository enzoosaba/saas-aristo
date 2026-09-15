# Entrega — 22 de setembro de 2026

## Escopo preparado

- Aplicação Next.js com conta individual, hábitos, tarefas, planejamento semanal, questões, gráficos, perfil e temas existentes.
- Banco selecionado pelo ambiente: SQLite local ou PostgreSQL/Supabase com `DATABASE_URL`.
- Autenticação existente preservada: senhas scrypt, cookies HttpOnly e sessões revogáveis. Esta integração usa o banco do Supabase, não o Supabase Auth.
- Schema privado `coelho`, RLS habilitada sem políticas públicas e consultas apenas no backend autenticado. **Não exponha `coelho` na Data API.** A conexão do servidor precisa ser proprietária das tabelas (a conexão PostgreSQL fornecida pelo painel atende a esse modelo); não use chave pública no lugar de uma conexão PostgreSQL.
- Migrações transacionais com checksum, importação com backup e verificação de contagens, sem sobrescrever banco de destino ocupado.
- Alterações concorrentes serializadas por usuário no PostgreSQL; versões antigas retornam conflito.
- Recuperação de senha com token aleatório armazenado como hash, validade de 30 minutos, uso único e revogação das sessões. Requer remetente Resend configurado. Sem configuração, a interface informa indisponibilidade.
- Área de alunos do mentor: vincular/remover alunos e consultar atividades, planejamento e questões. Papel de mentor concedido apenas pelo operador.

## Configuração de Supabase e hospedagem

1. No projeto Supabase, abra **Connect** e obtenha a conexão PostgreSQL. Para hospedagem serverless, use o pooler em modo transaction; para ferramentas de migração/backup, use conexão direta ou session pooler. Consulte a [documentação de conexão](https://supabase.com/docs/guides/database/connecting-to-postgres).
2. Coloque `DATABASE_URL` nos segredos do host e em `.env.local` apenas na máquina de administração. Nunca use prefixo `NEXT_PUBLIC_`. A aplicação valida certificados TLS. Se a cadeia precisar do CA do Supabase, defina `DATABASE_SSL_CA` com o PEM fornecido no painel.
3. Configure `APP_ORIGIN=https://dominio-real` e Node >=22.18. Na Vercel, a ausência de `DATABASE_URL` causa erro em vez de criar um SQLite efêmero.
4. Execute `npm run db:migrate` e `npm run db:check`. Migrações não rodam automaticamente durante requests ou build.
5. Para levar os dados locais: interrompa novas escritas, confirme `DATABASE_PATH`, execute `npm run db:import` contra o destino vazio e confira as contagens. O script guarda um snapshot antes da importação. Senhas e IDs permanecem; sessões antigas não são importadas.
6. Publique com `npm run build`. Em host Node/container, execute `npm start`; em Vercel, mantenha o preset Next.js. Teste `/api/health`, login, criação/edição, recarregamento e permissões na URL HTTPS final.
7. Configure `RESEND_API_KEY` e `EMAIL_FROM` com domínio verificado no Resend, mantendo `APP_ORIGIN` no domínio oficial. Teste entrega real, link expirado e redefinição. [API do remetente](https://resend.com/docs/api-reference/emails/send-email).

Se o destino já tiver usuários, o importador cancela. Não apague o destino para contornar isso: faça conciliação separada.

## Operação e recuperação

- `npm run backup`: backup SQLite com verificação de integridade.
- `npm run backup:postgres`: `pg_dump` em formato custom e conferência com `pg_restore --list`; requer ferramentas PostgreSQL compatíveis instaladas e conexão direta/session pooler. A senha é passada por ambiente, não por argumentos.
- Ative a política de backups do projeto Supabase. Guarde cópia fora do host de produção e valide restauração em um projeto separado antes da entrega; listar um dump não comprova a restauração completa.
- `npm run set-mentor -- email@dominio`: promove uma conta existente usando o banco configurado. Não existe senha administrativa padrão.
- Monitore `/api/health` e erros de servidor. Logs de falha incluem identificador de request sem imprimir senha/conexão. `password_reset_email_failed` indica falha no provedor de e-mail.
- Rollback de aplicação: republique a versão anterior compatível com o schema. Não restaure banco antigo por cima de novas escritas. Durante migração inicial, conserve o SQLite congelado até homologar o destino.

## Validação reproduzível

```sh
npm ci
npm run verify
npm run build
npm run test:e2e
npm run test:postgres
```

O primeiro E2E usa SQLite descartável. O segundo usa PostgreSQL embarcado via PGlite/socket e o driver `pg` real, com migrações repetidas e os mesmos fluxos de navegador. Isso valida a integração local, mas não simula latência, limites ou TLS do Supabase. O workflow de CI acrescenta uma instância PostgreSQL 17 real para repetir os E2E. Execução desse workflow depende do repositório remoto.

## Pendências externas para a entrega

Validação local de 15/09: lint e TypeScript sem erros; build de produção aprovado; 15 testes automatizados aprovados, incluindo migração e integridade; testes de navegador executados em SQLite e PostgreSQL embarcado. As suítes incluem 84 combinações de rota/tema/largura sem overflow, 36 scans de acessibilidade sem violações detectadas, 10 verificações do planejamento e fluxos de conta, mentor e recuperação. A auditoria npm das dependências de produção retornou zero vulnerabilidades conhecidas. Isso não representa auditoria de segurança externa nem teste do Supabase em nuvem.

- Projeto Supabase, conexão secreta e hospedagem/domínio ainda precisam ser fornecidos/configurados.
- Executar migração e smoke test no Supabase real e publicar a URL HTTPS.
- Configurar remetente e testar recebimento de e-mail de recuperação.
- Testar restauração do backup em ambiente separado e definir responsável pela operação.
- Homologar com uma conta de aluno e uma de mentor no ambiente final.

## Limites de produto explícitos

- As abas Financeiro e Frases do mentor ainda são placeholders de etapa futura. Não há cobrança, pagamentos ou editor de frases implementados.
- Não há verificação de endereço de e-mail no cadastro, autenticação social, MFA nem biblioteca de videoaulas/simulados. A recuperação de senha não equivale à verificação de cadastro.
- Dados de demonstração continuam identificados como demonstração. Decidir se a conta de apresentação será mantida separada das contas dos alunos.
- Nenhuma publicação, migração no Supabase real ou entrega real de e-mail foi executada sem o ambiente externo.
