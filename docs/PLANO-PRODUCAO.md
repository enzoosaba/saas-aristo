# Plano de execução — Mentoria Coelho

Preservar Next.js + React + TypeScript + Tailwind e a identidade aprovada. Backend em Route Handlers, SQLite nativo do Node em volume persistente, schemas Zod e sessões opacas no servidor. SQLite evita serviço externo para execução local; exige instância única com disco persistente. Migrar para PostgreSQL antes de múltiplas réplicas. Não introduzir pagamentos, conteúdo fictício ou painel mentor. Offline de escrita adiado para evitar conflitos de histórico; falhas de rede devem preservar formulários.

## Fase 1: Base e CI
- Entregas: Preservar interface; preparar lint, tipos e testes.
- Arquivos: `package.json, .github/workflows/ci.yml`.
- Commit previsto: `chore: establish application baseline and CI`.
- E2E: Abrir cinco rotas; conferir ausência de erros.
- Verificação: Não versionar dados ou segredos.

## Fase 2: Persistência
- Entregas: Schema SQL, constraints e índices; implantação em instância única.
- Arquivos: `src/server/db.ts`.
- Commit previsto: `feat: add persistent study database`.
- E2E: Criar item e reler em nova sessão.
- Verificação: Consultas parametrizadas, backup em volume.

## Fase 3: Contas e permissões
- Entregas: Cadastro, login, logout, sessão expirada; papel aluno e vínculo futuro.
- Arquivos: `src/server/auth.ts, src/app/api/auth`.
- Commit previsto: `feat: add student accounts and sessions`.
- E2E: Login correto/incorreto, logout e acesso anônimo.
- Verificação: Hash de senha, cookie HttpOnly e limitação de tentativas.

## Fase 4: API do núcleo
- Entregas: CRUD, realizações diárias e planos por data.
- Arquivos: `src/app/api/study, src/server/validation.ts`.
- Commit previsto: `feat: add validated study API`.
- E2E: CRUD e isolamento entre duas contas.
- Verificação: Zod, tamanho de corpo, origem e ownership.

## Fase 5: Estado compartilhado
- Entregas: Carregar estado da API, atualizar após mutações.
- Arquivos: `src/components/StudyProvider.tsx`.
- Commit previsto: `feat: connect shared authenticated study state`.
- E2E: Alterar rotina e conferir painel.
- Verificação: Erros explícitos, sem cache compartilhado.

## Fase 6: Interface funcional
- Entregas: Editar e excluir itens; preservar design.
- Arquivos: `src/components/PersonalItems.tsx, QuickAdd.tsx`.
- Commit previsto: `feat: complete study item interactions`.
- E2E: CRUD mobile e teclado.
- Verificação: Alvos de toque e loading.

## Fase 7: Agenda e recorrência
- Entregas: Seleção de data, recorrência e atraso.
- Arquivos: `src/app/calendario/page.tsx`.
- Commit previsto: `feat: connect daily calendar and habit history`.
- E2E: Registrar dias diferentes sem sobrescrever.
- Verificação: Datas validadas e histórico isolado.

## Fase 8: Planejamento e busca
- Entregas: Planos por data, busca e filtro de tarefas.
- Arquivos: `src/app/planos/page.tsx`.
- Commit previsto: `feat: persist dated plans and task filters`.
- E2E: Salvar e reabrir datas diferentes.
- Verificação: Limites de texto e estado vazio.

## Fase 9: Indicadores reais
- Entregas: Derivar metas, XP e constância do histórico.
- Arquivos: `src/app/page.tsx, src/components/StudentOverview.tsx`.
- Commit previsto: `feat: derive progress from recorded activity`.
- E2E: Conclusão atualiza indicadores sem duplicar pontos.
- Verificação: Cálculo determinístico.

## Fase 10: Conta e temas
- Entregas: Perfil, logout, exportação pessoal; manter dark/light.
- Arquivos: `src/app/perfil/page.tsx`.
- Commit previsto: `feat: add account settings and data export`.
- E2E: Trocar nome e sessão; exportar somente conta atual.
- Verificação: Sem interface mentor nesta etapa.

## Fase 11: Suíte E2E
- Entregas: Contas independentes e fluxos completos.
- Arquivos: `artifacts/production-e2e.mjs`.
- Commit previsto: `test: add authenticated study end-to-end coverage`.
- E2E: Cadastro → criar → editar → concluir → excluir.
- Verificação: Banco separado de testes.

## Fase 12: Regressão
- Entregas: Mobile, teclado, erros, validação e isolamento.
- Arquivos: `artifacts/production-e2e.mjs`.
- Commit previsto: `test: verify cross-account and responsive flows`.
- E2E: Permissões, persistência e recarregamento.
- Verificação: Não usar dados reais nos testes.

## Fase 13: Segurança e desempenho
- Entregas: Headers, origem, validação e revisão.
- Arquivos: `next.config.ts, src/server/http.ts`.
- Commit previsto: `fix: harden study application boundaries`.
- E2E: Origem externa, payload inválido e sessão ausente.
- Verificação: Métricas somente medidas, sem nota inventada.

## Fase 14: CI e entrega
- Entregas: Build, testes e container com disco persistente.
- Arquivos: `Dockerfile, .github/workflows/ci.yml`.
- Commit previsto: `ci: automate verification and container delivery`.
- E2E: Teste integrado em ambiente limpo.
- Verificação: Node atualizado e usuário sem root.

## Fase 15: Documentação
- Entregas: Operação, recuperação, limites e roteiro mentor.
- Arquivos: `README.md, .env.example`.
- Commit previsto: `docs: document setup operations and limitations`.
- E2E: Seguir comandos em ambiente local.
- Verificação: Backup, HTTPS e rotação de sessão.

## Fase 16: Publicação
- Entregas: Publicar se houver conta e destino disponíveis.
- Arquivos: `Configuração de host externo`.
- Commit previsto: `chore: configure production deployment`.
- E2E: URL real: login e CRUD.
- Verificação: Bloqueado sem host/credenciais/volume.

## Fase 17: Verificação pública
- Entregas: Validar host publicado e registrar métricas reais.
- Arquivos: `docs/EXECUCAO.md`.
- Commit previsto: `test: record production smoke checks`.
- E2E: Fluxo completo na URL pública.
- Verificação: Depende da fase 16.

