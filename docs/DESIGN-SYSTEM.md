# Plataforma Coelho — interface responsiva

## Escopo e stack
As cinco abas existentes: Início, Rotina, Planos, Calendário e Perfil. Next.js 16, React 19, TypeScript, Tailwind CSS 4 e CSS global. Componentes em PascalCase; classes próprias em kebab-case, combinadas com utilitários Tailwind.

## Componentes reaproveitados e hierarquia
- RootLayout
  - TopBar: marca e acesso ao perfil
  - MainNav: cinco links, rota ativa via aria-current
  - main
    - DesktopOverview: resumo horizontal no desktop
    - Página atual
      - Card: superfície e padding compartilhados
      - ProgressBar: porcentagem limitada a 0–100 e nome acessível contextual
      - MissionsPanel, QuestionsPanel: resumo de estudo
      - PerformancePanels, PeriodSwitch: gráficos, lista e filtro
  - loading.tsx: reserva de espaço durante carregamento de rota
  - error.tsx: explicação, foco no título e ação de tentar novamente

Novos componentes de botão/cartão não foram necessários: a estrutura existente atende ao escopo. Os boundaries de rota são novos porque o projeto ainda não tratava esses estados.

## Tokens preservados
Fonte Geist, fundos escuros e gradiente da marca, sem novas fontes ou paleta.
- Fundo: #101013; cartões: #1c1c1d.
- Texto principal: #f3f1ee; secundário: #bcb9b2.
- Gradiente: #ffd000 → #ff8615 → #ff3c19.
- Bordas: #343330; raio de cartão 12 px; controles 8 px.
- Espaçamento: escala existente de 4 px, nomeada em --space-1/2/3/4/5/6/8 (4/8/12/16/20/24/32 px).
- Área interativa mínima: --touch-target, 44 px.

Os tokens e ajustes ficam em src/app/globals.css. Há estilos legados com valores literais e regras históricas; os tokens introduzidos consolidam a escala para manutenção futura, sem afirmar que todo o CSS já foi migrado.

## Layout e breakpoints
- Base mobile: uma coluna, navegação inferior fixa e espaço de segurança do dispositivo.
- 768 px: navegação lateral, distribuição de painéis em duas colunas quando houver largura.
- 1100 px: composição desktop em grade, resumo do aluno e conteúdo secundário lado a lado.
- 1600 px: ajustes de largura, dentro do limite de leitura existente.
- Regras legadas em 359/480/900 px permanecem para pequenos ajustes.

O banner de aula e o painel de rotina têm linhas distintas para evitar sobreposição. No Perfil, filtros, métricas e gráficos ocupam linhas explícitas. A barra inferior reserva espaço no conteúdo; ela não depende de um rodapé vazio para manter controles acessíveis.

## Estados e acessibilidade
- Hover, foco visível e pressionado compartilham o tratamento existente da marca.
- Botões de quantidade ficam desabilitados no mínimo e no máximo.
- Campos têm label, descrição e feedback; falhas de armazenamento são anunciadas como alerta e preservam o rascunho.
- O carregamento de rota usa status/busy e cartões de tamanho reservado, sem animação obrigatória.
- Erros de rota movem o foco para uma explicação e oferecem nova tentativa.
- Estados vazios de calendário permanecem explícitos.
- Imagens têm dimensões reservadas; gráficos usam viewBox e descrições acessíveis.
- Link de salto, aria-current, aria-pressed e nomes contextuais de progresso são mantidos.
- Texto principal e secundário sobre cartões escuros excedem contraste AA. Isto não equivale a certificação WCAG de todos os pixels/estados; gradientes, gráficos e leitores de tela requerem auditoria completa separada.

## Verificação
- npm.cmd run lint
- npm.cmd run build
- node artifacts/check.mjs: cinco rotas em 320, 390, 768, 1024, 1280, 1440 e 1920 px; rolagem/navegação fixa, transbordamento e interações.
- node artifacts/accessibility.mjs: alvos de toque da aplicação em 390 px, limite desabilitado, teclado/link de salto, falha de salvamento e preservação do texto.
- Capturas em artifacts/home-390.png, home-1440.png, profile-390.png e profile-1440.png.

Os dados continuam demonstrativos. O planejamento é local ao navegador, sem sincronização com servidor. Os boundaries de rota passaram por compilação; a simulação de erro coberta pelo navegador é a falha de salvamento, não uma falha de servidor.


## Criação rápida
MainNav contém QuickAdd, com botão de 52 px e halo de 72 px. No mobile, fica elevado sobre o centro da barra de 72 px, com ícones de 24 px e textos de 12 px. As cinco abas continuam acessíveis abaixo do botão. QuickAdd usa dialog nativo: foco contido, Escape, retorno ao acionador e fechamento pelo fundo.

O seletor abre formulário de hábito (frequência, tipo, quantidade/unidade, horário, notas) ou tarefa (data, prioridade, horário, notas). PersonalItems mostra os itens na Rotina e as tarefas no Calendário. StudyProvider.tsx sincroniza os componentes a partir do estado do servidor. Dados ficam na conta, não no navegador; não há reinício automático diário nem notificações agendadas.

Teste adicional: node artifacts/quick-add.mjs cobre criação, persistência, conclusão, contagem, erro de armazenamento, Escape e restauração do foco.


## Revisão mobile — referência de cartões arredondados
A segunda referência fornecida é a base estrutural. No celular, os cartões usam raio de 20 px, há atalhos compactos após a saudação e o destaque duplicado de rotina cede espaço à aula em andamento. Os indicadores ficam em pares; o restante dos painéis é preservado abaixo.

MainNav é um dock flutuante de 72 px, afastado 16 px das bordas e do limite inferior mais safe area, com as cinco abas existentes. QuickAdd agora pertence a TopBar: acionador de 44 px no canto superior direito, sem botão elevado na navegação. A marca, paleta escura, gradiente, dados e funções da mentoria são preservados; não se trata de uma cópia literal das telas de meditação.


## Revisão atual — temas, tipografia e desktop
Esta revisão substitui as descrições anteriores de paleta e navegação. A fonte principal é Onest, identificada na primeira referência, carregada com next/font. A segunda referência não identifica outra família. O laranja #ff5d00 e o laranja queimado #e85002 compõem o gradiente; superfícies escuras quentes e o branco #f9f9f9 formam os dois temas. Textos pequenos usam tons de laranja ajustados para legibilidade, em vez de gradiente sobre branco.

Tokens semânticos ficam em src/app/theme.css: background, foreground, surface-card, surface-raised, surface-input, text-secondary, border-default, accent-text e brand-gradient. Os componentes existentes Card, ProgressBar, StudyPanels, DesktopOverview, MainNav e QuickAdd foram reaproveitados. A escala de espaçamento e os breakpoints existentes (768 e 1100 px) foram mantidos.

Estrutura: RootLayout → ScrollEffects + TopBar (ThemeToggle e QuickAdd) + DashboardSidebar + conteúdo da rota. MainNav preserva as cinco abas no dock mobile. A sidebar desktop agrupa Início em Visão geral; Rotina, Planos e Calendário em Organizar & estudar; Perfil em Minha evolução. Busca, recolhimento e atalhos de teclado continuam funcionais.

ThemeToggle fica no canto superior direito, ao lado de Meu perfil no desktop; permanece no cabeçalho mobile. A escolha é salva em coelho-theme e aplicada antes da renderização visual. Se o armazenamento estiver indisponível, a troca continua funcionando na aba atual.

O desktop usa o mesmo vocabulário de cartões arredondados do mobile, com aula em destaque ocupando duas colunas, indicadores na terceira e painéis de missões, questões e agenda alinhados. Um destaque duplicado foi removido da apresentação para manter um CTA principal. O botão de adicionar permanece no topo; formulários abrem em sheet no mobile e modal no desktop.

ScrollEffects anima a entrada dos cartões com deslocamento de 12 px e duração de 420 ms, uma vez por cartão em cada rota. O conteúdo nunca fica oculto à espera do JavaScript. prefers-reduced-motion desativa as animações; não há alteração da velocidade de rolagem do navegador.

### Validação desta revisão
- Lint e build de produção aprovados.
- artifacts/themes.mjs: cinco rotas em 320, 390, 768, 1100 e 1440 px, nos dois temas, sem transbordamento horizontal; persistência, troca por teclado, armazenamento bloqueado e recolhimento da sidebar aprovados.
- artifacts/motion.mjs: animações presentes com movimento permitido e zero chamadas com movimento reduzido.
- artifacts/accessibility.mjs: áreas de toque de pelo menos 44 px nos controles verificados em 390 px, link de salto, teclado, estados desabilitados e recuperação de erro aprovados.
- artifacts/quick-add.mjs: criação no tema claro, persistência, progresso, conclusão, Escape, retorno de foco e falha de armazenamento aprovados.
- artifacts/sidebar.mjs: busca, atalho, recolhimento e os três grupos com cinco destinos aprovados.
- Inspeção visual das capturas desktop/mobile, temas claro/escuro e criação rápida. A verificação básica não substitui uma auditoria completa com leitores de tela.
