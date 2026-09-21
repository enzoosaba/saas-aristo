# Mentoria Coelho

Aplicação de estudos com Next.js, React, TypeScript, Tailwind, Onest e a identidade laranja aprovada. O núcleo funcional usa contas individuais, sessões no servidor, hábitos recorrentes, tarefas, planejamento por data e progresso derivado do histórico.

**Estado:** núcleo funcional e integração PostgreSQL validados localmente. A publicação externa e sua verificação não foram executadas. A recuperação de senha está implementada e precisa de remetente configurado; verificação de e-mail no cadastro ainda não existe. A área do mentor em /mentoria tem testes de permissões e acompanhamento de alunos. Financeiro e Frases permanecem etapas futuras. Veja o roteiro abaixo para homologação e operação de produção.

## Entrega de setembro

Veja [o roteiro de entrega e configuração do Supabase](docs/ENTREGA-22-SETEMBRO.md) para o estado atual, migração de dados, recuperação de senha, testes e pendências externas. `DATABASE_URL` ativa PostgreSQL; sem ela, o desenvolvimento local continua com SQLite.

## Executar

Requer Node >=22.18 e pnpm (a versão fica fixada no campo `packageManager` do `package.json`; o lockfile único é o `pnpm-lock.yaml`). O projeto usa `node:sqlite`, que pode emitir aviso experimental dependendo da versão do Node. Não requer PostgreSQL ou credenciais externas para executar localmente.

```sh
pnpm install --frozen-lockfile
pnpm dev
```

Abra http://localhost:3000 e escolha **Criar minha conta**. Não existe senha padrão nem conta administrativa embutida. A senha deve ter entre 8 e 128 caracteres.

No PowerShell, use `pnpm.cmd` caso a política local bloqueie `pnpm.ps1`.

## Variáveis

Copie `.env.example` para `.env.local` no desenvolvimento. Em produção, forneça as variáveis diretamente ao processo/container.

| Variável | Uso |
|---|---|
| DATABASE_PATH | Caminho do arquivo SQLite; padrão local `data/coelho.sqlite`. Em produção, use caminho absoluto em volume persistente. |
| DATABASE_URL | Conexão PostgreSQL/Supabase privada; tem prioridade sobre SQLite. |
| DATABASE_SSL_CA | Certificado CA opcional para TLS do banco. |
| RESEND_API_KEY / EMAIL_FROM | Envio de recuperação de senha por remetente verificado. |
| APP_ORIGIN | Origem exata, sem barra final. Ex.: `https://seu-dominio`. Mutações com outra origem são rejeitadas. |
| PORT | Porta HTTP; padrão 3000. |
| BIND_HOST | Bind do launcher local; padrão 0.0.0.0. |

Não publique arquivos `.env`, banco, backups ou cookies. `.gitignore` exclui dados e caches. `.env.example` não contém segredo.

## Build e produção local

```sh
pnpm verify
pnpm build
pnpm start
```

O launcher prepara os assets e executa o servidor standalone do Next. Contas e dados ficam no banco, não no localStorage. Cookies de sessão são Secure em produção; use HTTPS no host público. Localhost é usado pelos testes de navegador.

## Funcionalidades entregues

- Cadastro, login, logout e troca de senha, com revogação das outras sessões.
- Sessões opacas em cookies HttpOnly/SameSite; o banco guarda somente o hash do token.
- Senhas derivadas com scrypt e salt aleatório; consultas SQL parametrizadas.
- API com Zod, limite de tamanho, verificação de origem, rate limiting e autorização por proprietário.
- Criar/editar/arquivar hábitos e tarefas; arquivamento preserva realizações anteriores.
- Hábitos diários, dias úteis ou fins de semana, com contagem ou checklist.
- Realizações por data, sem sobrescrever outros dias. A conclusão de tarefa fica registrada na data em que foi feita, separada da data agendada.
- Rotina e agenda compartilham os mesmos registros; tarefas atrasadas são identificadas em Todos os itens.
- Planejamento independente para cada dia, com detecção de edição concorrente.
- XP, nível, sequência e gráfico semanal derivados dos registros. Contas preenchidas com dados fictícios mostram a identificação de demonstração.
- Cada realização concluída vale 20 XP, cada nível corresponde a 200 XP. Desmarcar ajusta os pontos. A sequência conta dias consecutivos com alguma conclusão, não apenas acessos.
- Perfil editável, exportação dos dados ativos/histórico da conta e temas claro/escuro persistentes.
- Falhas de rede preservam os formulários; escrita offline não é enfileirada.

Itens antigos do protótipo continuam no armazenamento do navegador, mas não são importados automaticamente: o navegador pode ter sido compartilhado por mais de uma pessoa. Os módulos de protótipo mock-data.ts e study-items.ts foram removidos; toda a leitura vem do servidor.

## Estrutura

```text
src/
  app/
    api/auth/route.ts       cadastro, login, logout e senha
    api/study/route.ts      leitura e mutações autorizadas
    api/health/route.ts     disponibilidade do banco
    page.tsx               início com dados reais
    rotina/page.tsx         itens e registros por dia
    calendario/page.tsx     agenda por data
    planos/page.tsx         planejamento persistente
    perfil/page.tsx         conta, histórico e exportação
    layout.tsx             navegação e identidade visual
    globals.css            estilos existentes
    theme.css              tokens claro/escuro
    functional.css         novos formulários e estados
  components/
    auth/AuthForm.tsx
    StudyProvider.tsx      estado compartilhado e sincronização
    QuickAdd.tsx           criação/edição em dialog
    PersonalItems.tsx      contagem, conclusão e arquivamento
    PasswordForm.tsx
    StudyPanels.tsx        indicadores reais
    DesktopOverview.tsx / MobileStudyCards.tsx
    QuestionAnalytics.tsx  desempenho em questões
    WeeklyPlanner.tsx      sessões de estudo da semana
    MainNav.tsx / TopBar.tsx / ThemeToggle.tsx / ScrollEffects.tsx
    ui/                    Card, ProgressBar e DashboardSidebar
  lib/domain.ts            tipos e regras puras de data/progresso
  server/
    db.ts / database.ts    acesso assíncrono SQLite/PostgreSQL e transações
    sqlite.ts              schema local e compatibilidade dos dados existentes
    auth.ts                senha e sessão
    http.ts                origem, corpo, erros e limites
    validation.ts          schemas Zod
    study.ts               consultas e regras do domínio
scripts/
  start.mjs                launcher standalone
  run-e2e.mjs              banco e servidor de testes isolados
  backup.mjs               backup consistente + integrity_check
tests/domain.test.mjs
artifacts/production-e2e.mjs
artifacts/quality.mjs
.github/workflows/ci.yml
Dockerfile / .dockerignore / .env.example
```

## Testes

```sh
pnpm verify
pnpm build
pnpm test:e2e
```

`verify` executa ESLint, TypeScript e testes de regras de negócio. O E2E inicia o build de produção em porta 3101 com um banco novo, testa contas reais de teste e encerra o servidor. No Windows usa Edge instalado; no Linux instale `npx playwright install --with-deps chromium`.

Os 16 cenários incluem cadastro/login, CRUD com arquivamento, recarregamento, isolamento entre contas/dias, conflitos, data inválida/futura, erro de rede, troca de senha, revogação e cinco rotas em cinco larguras. O resultado é salvo em `test-results/functional-report.json`.

Para auditoria local com o servidor já iniciado:

```sh
# TEST_BASE_URL deve apontar para o servidor em execução.
pnpm test:quality
```

O script usa porta DevTools 9225, testa ambos os temas em 390/1440 px com axe e mede Lighthouse na página inicial autenticada. Salva os resultados em test-results. Esses testes são locais, não uma auditoria do host público; Lighthouse não fornece uma nota de segurança da aplicação. Scripts antigos em artifacts registram a etapa visual anterior e não são a suíte vigente de autenticação.

## CI/CD

O workflow em `.github/workflows/ci.yml` executa instalação, lint, tipos, unitários, build, Playwright, upload dos relatórios e build Docker. O CI foi configurado, mas não executado no GitHub: não há remoto configurado. Husky executa lint antes do commit após `npm install`/`npm run prepare`.

Não há deploy automático com credenciais fictícias. Configure o host e seu mecanismo de entrega depois da revisão do ambiente.

## Implantação em host com Docker

```sh
docker build -t mentoria-coelho .
docker volume create coelho-data
docker run -d --name mentoria-coelho --restart unless-stopped   -p 3000:3000 -e APP_ORIGIN=https://seu-dominio   -v coelho-data:/app/data mentoria-coelho
```

Coloque um proxy HTTPS à frente do container. Configure a origem real, monitore `/api/health` e restrinja o acesso ao volume. Esta arquitetura exige **uma instância com disco persistente**; não use SQLite local em função efêmera da Vercel/Netlify. Para múltiplas réplicas, migrar persistência e rate limiting para serviços compartilhados antes de escalar.

Docker não está disponível neste ambiente; o Dockerfile não foi executado aqui. Não há URL pública criada, conta de hospedagem ou credenciais de deploy configuradas.

## Backup e recuperação

```sh
pnpm backup
```

Cria uma cópia consistente em `data/backups` usando a API de backup SQLite e valida `PRAGMA integrity_check`. O processo não sobrescreve backups existentes. Testado com banco de E2E. Agende a execução e copie backups para armazenamento privado fora do host.

Para restaurar, pare o serviço e preserve o diretório de dados atual. Aponte DATABASE_PATH para uma cópia verificada do backup em um caminho novo; inicie o serviço e confira o login e os registros. Não sobreponha um banco aberto nem misture arquivos WAL de versões diferentes. Backups contêm dados pessoais e hashes de senha/sessão: proteja acesso e retenção.

## Limites e próximas etapas

- Não há ainda recuperação de senha por e-mail, verificação de e-mail ou MFA. Integrar um provedor antes de um lançamento amplo.
- CSP atual restringe recursos e enquadramento, mas mantém inline scripts/styles exigidos pelo layout existente; uma política com nonce é uma etapa de endurecimento futura.
- Rate limiting usa o banco e um limite global conservador de autenticação, sem confiar em cabeçalhos IP enviados pelo cliente. Ajustar no proxy conhecido antes de atender grande volume.
- Sem filas offline, streaming em tempo real, upload de materiais, player, banco de questões, correção de simulados ou cobrança. Esses módulos não foram apresentados como prontos.
- Sincronização consulta o servidor ao voltar à aba e a cada 30 segundos enquanto visível. Conflitos de escrita são rejeitados explicitamente.
- O papel mentor e o vínculo mentor/aluno existem no schema; não há painel nem concessão pública desse papel. A autorização do mentor deve ser implementada no servidor quando essa etapa começar.
- Não houve teste de carga, pentest, execução remota de CI, build Docker ou verificação pós-deploy. Consulte docs/EXECUCAO.md para evidência real, sem resultados simulados.
