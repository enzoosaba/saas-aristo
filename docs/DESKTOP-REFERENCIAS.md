# Composição desktop baseada nas referências

A partir de 1024 px, a interface usa uma composição própria para desktop. Entre 1024 e 1279 px, os painéis seguem duas colunas; a partir de 1280 px, Hoje ganha uma terceira coluna auxiliar. Os estilos ficam em desktop-reference.css, preservando o fluxo mobile.

- Hoje: destaque com ação para a rotina; missões compactas em duas colunas; questões respondidas com acertos e erros; planejamento; realizações recentes e agenda.
- Desempenho: quatro indicadores do período; radar e evolução lado a lado; tópicos de revisão e distribuição dos resultados abaixo.
- Metas: indicadores de constância, compromisso, metas ajustáveis e histórico em colunas.

Os novos painéis usam registros existentes na conta. Realizações são atividades efetivamente concluídas, e não medalhas fictícias. O banner leva à rotina; não representa um player de aulas. Comparativo de turma e simulados continuam dependendo dos fluxos próprios já documentados em REVISAO-UX-REFERENCIAS.md.

Validação: build, lint, TypeScript, testes de domínio e fluxos ponta a ponta; capturas em test-results/responsive nos temas dark/light e larguras de celular e desktop.
