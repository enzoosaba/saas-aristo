# Adaptação integral — Plataforma Coelho

## Estrutura reutilizada

Next.js App Router, React, TypeScript, CSS global e utilitários Tailwind. Onest, tokens Coelho e SVG da marca preservados. `Card`, `PersonalItems`, `StudyProvider`, `QuickAdd`, `ThemeToggle`, `ProgressBar`, `MissionsPanel` e `PerformancePanels` são reaproveitados.

- Layout: TopBar → MainNav mobile / DashboardSidebar desktop → conteúdo da rota.
- Início: destaque de constância → missões → acessos rápidos → QuestionAnalytics → histórico e agenda.
- Rotina: Habit tracker / Controle → cartões, timeline e metas semanais → criação de hábito.
- Planos: planejamento do dia seguinte / autorreflexão, com campos preservados entre abas.
- Calendário: mês → detalhe do dia → PersonalItems / criação de tarefa com data selecionada.
- Questões: formulário → QuestionAnalytics (anel, radar, evolução, tópicos) → histórico editável.
- Perfil: identidade, XP, constância, ranking de turma quando vinculado, histórico e conta.

## Decisões de layout

Até 767 px, uma coluna e detalhes do calendário em folha inferior. De 768 a 1023 px, duas colunas quando úteis e a mesma navegação inferior para evitar uma transição desnecessária. A partir de 1024 px, sidebar com os seis módulos. O dock tem quatro destinos: Início, Rotina, Calendário e Questões; Planos fica nos atalhos do Início e Perfil no avatar do cabeçalho. A ação de hábito fica acima do dock, reservando espaço no conteúdo e respeitando a área segura.

O destaque usa constância real, sem inventar uma data de vestibular. Ranking é restrito aos alunos vinculados à mesma mentoria, sem listar contas externas. Sem vínculo, o perfil exibe um estado vazio. A área exclusiva do mentor continua fora deste escopo.

## Dados e comportamento

Registros de questões são privados por conta, persistidos em SQLite, com controle de versão, validação de quantidades e rejeição de datas futuras. Acerto é ponderado pelo total de questões. Os filtros de período atualizam todos os gráficos. Matérias são agrupadas nas seis áreas exibidas no radar. O módulo registra resultados de prática; não oferece um catálogo de enunciados ou correção automática de provas.

O calendário respeita a recorrência dos hábitos. Metas da semana comparam atividades concluídas e programadas. Animações acompanham cartões novos e respeitam `prefers-reduced-motion`.

## Verificação

- Tokens e fontes existentes, logo laranja e temas dark/light.
- Build, lint, TypeScript e testes de domínio.
- Fluxos ponta a ponta: autenticação, rotina, planos, calendário e questões; persistência, conflitos e isolamento entre contas.
- Seis rotas em 320, 360, 390, 767, 768, 1023, 1024 e 1440 px no teste funcional.
- 84 combinações de rota, largura e tema no teste responsivo; 36 verificações axe WCAG A/AA.
- Controles de toque, foco visível, diálogos nativos e imagens com dimensões reservadas.

Executar: `npm run verify`, `npm run build`, `npm run test:e2e`. Resultados e capturas em `test-results/`. Verificação automática de acessibilidade não substitui uma avaliação manual completa com leitores de tela.
