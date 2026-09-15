# Revisão UX/UI das referências

## Problemas encontrados e corrigidos

- Início reunia todos os painéis, repetindo constância, agenda e motivação e exigindo uma rolagem muito longa. Agora as seções Hoje, Desempenho e Metas organizam os painéis dentro da mesma aba principal.
- Atalhos mobile consumiam quatro linhas completas. Agora usam uma grade compacta de duas colunas.
- Metas e lembretes estavam escondidos no fim do dashboard e disponíveis apenas no celular. Agora têm uma seção própria, também utilizável no desktop.
- Radar não oferecia alternativa de leitura. Agora alterna entre radar e barras com valores textuais.
- Tópicos longos dependiam de tooltip, difícil de acessar por toque. Agora expandem por toque ou teclado.
- A linha do gráfico mostrava acerto diário; a referência especificava acumulado no período. Cálculo e legenda agora correspondem ao acumulado ponderado pelo número de questões.

## Pedidos ainda não equivalentes às referências

Os prints incluem fluxos que o projeto ainda não implementa: catálogo/agendamento estruturado de simulados, cronômetro e sessões de foco, aulas e flashcards como módulos próprios, lembretes recorrentes com notificação, definição de prova-alvo para countdown e comparação de desempenho da turma. Esses dados não foram inventados nem substituídos por botões sem ação. O cartão Lembrete atual mostra tarefas futuras; não envia notificações.

Ranking atual é apenas da turma vinculada e por XP total, sem filtros semanal/mensal/divisão. A versão exclusiva do mentor permanece para uma etapa futura, conforme solicitado.

## Validação

Lint, TypeScript, testes de domínio, build e testes ponta a ponta. Revisão visual e axe nos temas claro e escuro; cobertura de navegação, metas persistidas, alternativas dos gráficos, expansão dos tópicos e larguras de celular a desktop. Relatórios em test-results/.
