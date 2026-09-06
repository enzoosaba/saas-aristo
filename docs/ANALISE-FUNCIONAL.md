# Análise funcional — Mentoria Coelho

Escopo: inspeção das cinco rotas, componentes e armazenamento; reprodução em navegador local. Nenhuma regra funcional da aplicação foi alterada nesta análise.

## Diagnóstico
A aplicação é um protótipo interativo, com navegação funcional e algumas operações persistidas no navegador. Ainda não é uma plataforma multiusuário: não há autenticação, API de domínio, banco de dados, isolamento por aluno ou autorização por vínculo mentor/aluno na base inspecionada.

## Achados por prioridade

### Alta — dados e integridade
1. Hábitos iniciais usam useState(habitosIniciais) em src/app/rotina/page.tsx:22. Marcar Dormir antes das 23h e recarregar perde a alteração. Hábitos personalizados usam outro modelo e persistem. Unificar as duas fontes antes de expandir os módulos.
2. Início, missões, XP, nível, sequência e desempenho leem src/lib/mock-data.ts. Conclusões reais não alimentam esses indicadores. Criar registros de atividade e derivar métricas deles.
3. src/lib/study-items.ts:22 e :45 salvam todos os itens em uma chave local. Não há separação por conta, sincronização entre dispositivos ou cópia no servidor. Em produção, armazenamento deve ser associado ao usuário autenticado, com autorização no servidor.
4. Hábitos guardam um único value/done, sem registros por data. frequency é exibida como texto, sem gerar ocorrências. Não há histórico diário ou regra de sequência. Modelar definição do hábito separadamente de suas realizações por dia.

### Média — fluxos incompletos
5. src/app/page.tsx:18: Continuar estudando leva a /rotina. Não existe rota de aula/player/progresso de conteúdo.
6. src/app/perfil/page.tsx passa o período somente para as métricas; PerformancePanels não recebe esse estado. No navegador, 7 dias altera os números, mas mantém a evolução. Aplicar o filtro a todos os painéis ou explicitar o escopo.
7. src/components/PersonalItems.tsx:10 filtra somente por tipo. Tarefas são listadas sem seleção de dia, ordenação temporal, atraso ou divisão entre abertas/concluídas. Não há edição, exclusão ou arquivamento de itens.
8. src/app/calendario/page.tsx usa agenda, sequência e contagem regressiva fixas. Minhas tarefas fica separada da Agenda de hoje; a página inicial também não recebe os novos compromissos.
9. src/app/planos/page.tsx:14 salva um único documento, sem data/histórico, e instruções do mentor são texto fixo. Não existe troca com o mentor nem geração de tarefas a partir do plano.
10. Questões, simulados, sessões de foco, ranking e conquistas exibem resumos, sem seus respectivos fluxos de criação/registro/cálculo. Perfil exibe identidade fixa, sem edição de conta.

### Manutenção e confiabilidade
- JSX extenso e compactado, especialmente StudyPanels e páginas, dificulta revisão das regras futuras.
- globals.css acumula revisões e theme.css adiciona overrides. Consolidar gradualmente os tokens e estilos por componente para reduzir regressões.
- Leitura de armazenamento inválido retorna lista vazia silenciosamente; um salvamento posterior pode substituir o conteúdo corrompido. Considerar recuperação/versionamento durante a migração.
- Os scripts Playwright existentes cobrem interfaces e persistência básica; não há comando test em package.json nem integração de testes em CI identificada no escopo desta inspeção. Falta cobertura de calendário, virada do dia e consistência entre módulos.

## Sequência recomendada
1. Definir o núcleo funcional: hábitos, realizações por data, tarefas e agenda compartilhando dados e regras.
2. Adicionar edição/arquivamento, recorrência, filtros e histórico. Critério: concluir um hábito aparece em Início/Rotina e continua correto depois de recarregar e na mudança de dia.
3. Antes do uso por alunos reais, adicionar contas, persistência no servidor e isolamento dos dados. Preparar entidade de vínculo mentor/aluno e autorização por vínculo sem construir a interface do mentor agora.
4. Conectar metas, XP, sequência e gráficos ao histórico real, com regras explícitas e sem premiar repetidamente a mesma conclusão.
5. Implementar aulas, questões e simulados conforme o escopo escolhido para o produto; só então apresentar métricas desses módulos como dados reais.

## Verificação executada
- npm.cmd run lint: aprovado.
- artifacts/quick-add.mjs: criação, persistência, progresso, conclusão, tamanho do modal, Escape, retorno de foco e falha de armazenamento aprovados.
- artifacts/sidebar.mjs: busca, atalho, recolhimento e grupos aprovados.
- artifacts/functional-audit.mjs: confirmou perda dos hábitos iniciais após reload, gráficos inalterados após mudança do período e destino /rotina para a aula.
- Os primeiros testes encontraram o servidor local desligado; após iniciar next dev, foram reexecutados com sucesso. Isso não é um defeito funcional da aplicação.

Limites: não foi executada auditoria de segurança, carga, dependências ou infraestrutura de produção. Os achados de arquitetura são baseados no código disponível, sem supor serviços externos não conectados.
