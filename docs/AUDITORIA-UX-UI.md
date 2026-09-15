# Auditoria da interface — Mentoria Coelho

Data: 07/09/2026. Base analisada: acd3430. A aplicação foi aberta no navegador; não foram alterados os componentes nem as regras de negócio nesta revisão.

## Parecer
A identidade visual está consistente e o núcleo funcional já permite uso real de organização pessoal. A interface, porém, ainda tem regressões de composição e lacunas de interação que os testes gerais anteriores não cobriam. O desktop precisa de uma revisão de hierarquia e de escopo dos estilos. O mobile precisa de menos etapas antes da atividade principal e de espaçamento consistente entre os painéis.

A prioridade não é adicionar mais efeitos ou mudar a paleta. É aproximar o que se vê do que se precisa fazer: escolher a atividade de hoje, registrar o progresso e manter o trabalho salvo.

## Método e limites
- Código inspecionado: páginas, QuickAdd, PersonalItems, StudyProvider, ScrollEffects e as três folhas de estilos.
- Build de produção local em porta 3103, com banco isolado de auditoria e contas sintéticas. A plataforma normal permanece na porta 3000.
- 70 combinações de layout: cinco rotas × sete larguras (320, 390, 768, 1024, 1100, 1440, 1920) × dois temas.
- Estados: entrada, conta vazia, conteúdo preenchido, nomes longos, atrasados, futuro, edição, confirmação, rascunhos, data passada, sidebar recolhida e viewport baixo para formulário.
- Capturas inspecionadas de desktop e celular; axe executado nas cinco rotas preenchidas em 390/1440 e ambos os temas, além do formulário em viewport baixo.
- A suíte integrada atual de 16 cenários também foi reexecutada e aprovada, sem erros JavaScript.
- A simulação de viewport de 500 px não equivale a teste de teclado virtual físico. Não foram testados aparelhos reais, Safari/iOS, leitores de tela ou percepção de usuários em sessão de pesquisa.
- Não foi feita nova medição Lighthouse nesta auditoria. As notas anteriores não substituem a inspeção de UX.

## Problemas reproduzidos — prioridade alta

### 1. Missões deslocadas para o final no desktop
Na largura de 1440 px, Missões e Conquistas do dia aparecem aproximadamente na posição vertical 1502 px, depois do gráfico e da agenda. Isso inverte a prioridade de uso e a ordem visual diverge da ordem dos elementos no DOM, afetando também a previsibilidade da navegação por teclado.

Causa: src/app/globals.css:259 aplica grid-row:4 diretamente a .missions-panel e .questions-panel. As classes agora são reutilizadas dentro de .functional-grid, e a regra antiga ainda determina a posição. As regras mais recentes limitadas a .dashboard não corrigem esse novo contêiner.

Recomendação: definir o layout do contêiner atual e restringir regras antigas ao layout a que pertencem. Colocar atividade/agenda imediata antes de análises históricas. Aceite: ordem visual e de teclado coerentes, sem posicionamento herdado inesperado em 1100/1440/1920.

### 2. Rascunho de planejamento é perdido ao trocar a data
Reprodução: substituir Prioridades do dia por um texto não salvo, selecionar outra data e voltar. O texto retorna ao último valor salvo; o rascunho desaparece. A frase que pede para salvar não evita a perda.

Causa: src/app/planos/page.tsx:89 usa key={date}, recriando o formulário com defaultValue.

Recomendação: guardar rascunhos por data durante a sessão ou confirmar a saída quando houver alterações. A mesma política deve abranger navegação entre abas. Aceite: uma troca de dia não descarta texto sem aviso ou possibilidade de recuperação.

### 3. Fechar o modal descarta preenchimento
Reprodução: abrir Novo hábito, preencher o nome, pressionar Escape, reabrir e escolher hábito. O campo está vazio. Fechamento pelo fundo também existe sem política de rascunho.

Recomendação: preservar o preenchimento até salvar/descartar explicitamente. Manter Escape funcional, sem transformar o modal numa armadilha, mas assegurar recuperação do texto.

## Problemas reproduzidos — prioridade média

### 4. Foco perdido após sair da edição
Após abrir Editar em um cartão e pressionar Escape, document.activeElement é BODY. A criação e a edição não têm o mesmo comportamento de retorno do foco.

Causa: QuickAdd alterna sua instância pela chave do item; onClose zera editing e tenta focar uma referência que será desmontada. Referências: src/components/QuickAdd.tsx:18 e :120.

Recomendação: guardar o acionador real da edição e devolver o foco a ele, ou ao cartão correspondente se a ação mudou a lista. Aceite: após Escape, Tab continua de uma posição previsível próxima do item.

### 5. Cartões encostados no mobile
Missões, Conquistas, gráfico e agenda não têm separação consistente na página inicial. O dock flutuante visto no meio da captura longa é esperado de uma barra fixa; não é, por si só, erro de layout. O problema real é a falta de intervalo entre os painéis por trás dele.

Causa: .functional-grid recebe display:grid e gap apenas dentro do breakpoint desktop em src/app/functional.css:179. Abaixo dele, os filhos são blocos adjacentes.

Recomendação: declarar a pilha e o gap na base mobile e mudar apenas as colunas no desktop. Usar os intervalos já existentes de 16/20/24 px conforme o contexto.

### 6. Grid de indicadores reutilizado no tamanho errado
Dentro de Conquistas do dia há dois indicadores, mas .real-metrics recebe quatro colunas no desktop. O texto fica estreito, quebrando em várias linhas e deixando duas colunas sem conteúdo.

Evidência: computed style mostrou quatro colunas de aproximadamente 84,7 px no painel de duas métricas. Referência: src/app/functional.css:176.

Recomendação: diferenciar o grid de resumo geral (quatro itens) do grid compacto de painel (dois itens).

### 7. Controle permitido pela UI e recusado pela regra
Em Todos os itens, um hábito de fins de semana permite clicar em Marcar como concluído numa segunda-feira. O servidor então responde: “O hábito não está programado para esse dia.”

Causa: PersonalItems filtra a recorrência apenas em Neste dia; o disabled verifica futuro, mas não se o hábito está programado para a data selecionada (src/components/PersonalItems.tsx:114).

Recomendação: manter o item visível, desabilitar somente o registro daquele dia e explicar quando ele pode ser feito. Não pedir ao usuário para descobrir a regra por erro.

### 8. Data de conclusão não aparece no calendário
Uma tarefa de 05/09 concluída em 07/09 aparece simplesmente como Concluído quando se consulta 05/09. O banco registra a conclusão corretamente, mas a interface não diferencia vencimento e realização.

Recomendação: exibir “Programada para 05/09” e “Concluída em 07/09”. Isso evita interpretar a agenda passada como um retrato exato do estado daquele dia.

### 9. Animação de entrada não acompanha itens novos
Com movimento permitido, a página inicial registrou 11 chamadas de animação, com duração de 420 ms. Ao criar um cartão sem sair da Rotina, o novo cartão não recebeu animação, mesmo depois de entrar no viewport. Com prefers-reduced-motion: reduce, foram registradas zero chamadas.

Causa: ScrollEffects consulta os elementos uma vez por mudança de pathname. Elementos montados depois não são observados (src/components/ScrollEffects.tsx:31).

Recomendação: vincular a observação ao ciclo de vida do cartão ou a um componente de entrada reutilizável. Preservar o comportamento de movimento reduzido. A animação deve confirmar a inserção, sem atrasar a interação.

## Avaliação visual e hierarquia

### Desktop
- Sidebar, cabeçalho e cartões têm identidade coerente. A organização das cinco abas é compreensível.
- O grande resumo do aluno aparece em todas as rotas e repete nível/XP/constância já mostrados no Início e Perfil. Ele ocupa cerca de 200 px antes da tarefa principal.
- Agenda com um único item e cartão de mensagem esticam para alturas próximas de 380 px. Isso produz vazios sem utilidade e aumenta a rolagem.
- O seletor Neste dia/Todos os itens estica verticalmente ao lado da data; parece um bloco de destaque em vez de um controle de filtro.
- Recomendo reduzir o resumo global nas páginas de trabalho, alinhar data/filtro/busca como uma barra de controles e ajustar altura de cartões ao conteúdo.

### Mobile
- Dock de cinco abas, botão + no topo, cantos arredondados e largura dos cartões funcionam bem. Não houve rolagem horizontal nas larguras verificadas.
- Quatro indicadores e quatro atalhos aparecem antes da primeira lista de trabalho. Um aluno precisa rolar para chegar às atividades, mesmo já sabendo o que deseja fazer.
- Em conta vazia, a maior parte da primeira tela é ocupada por zeros e atalhos. Um CTA “Criar meu primeiro hábito” no contexto reduziria a procura pelo +.
- O formulário em 390×500 continua rolável e os campos/ação ficam acessíveis, mas o seletor de acompanhamento corta o texto “Marcar como concluído”. Dar largura inteira a esse campo facilita escolher corretamente.

## Tipografia
- Onest combina com a marca e mantém boa legibilidade no corpo. A hierarquia principal é reconhecível.
- Persistem textos de 10–11 px em etiquetas de tipo de item, títulos dos grupos da sidebar, datas dos gráficos e rótulos do dock. Mesmo com contraste adequado, alguns são pequenos para leitura confortável.
- Priorizar 14–16 px para informação necessária à tarefa; metadados secundários de 12–13 px. O dock pode permanecer compacto, mas sem reduzir mais seus rótulos.
- O título das páginas internas tem peso visual mais leve do que vários títulos de cartão. Uniformizar os níveis de título.
- Corrigir pluralização: “1 dias” aparece em mais de um ponto. Usar “1 dia” e “2 dias”.

## Cores e estados
A combinação de preto quente, superfícies neutras e laranja está resolvida. O tema light conserva a identidade sem simplesmente inverter as cores. Não recomendo nova paleta.

Contrastes calculados dos tokens, sem transparência ou gradiente:

| Par | Razão aproximada |
|---|---:|
| #fffafa sobre #1a1817 | 17,11:1 |
| #bdb6b1 sobre #1a1817 | 8,84:1 |
| #646464 sobre branco | 5,92:1 |
| #a43b00 sobre branco | 6,55:1 |
| #0d0101 sobre #e85002 | 5,46:1 |
| #ff5d00 sobre branco | 3,08:1 |

O laranja principal #ff5d00 não deve substituir o tom escuro de texto no tema claro: seu contraste com branco não atende AA para texto pequeno. Os tokens atuais já oferecem a alternativa adequada.

A oportunidade é usar melhor o significado dos estados. Quase todos os ícones têm o mesmo laranja; ações, erros, atrasos e conclusões precisam ser diferenciados também por texto, ícone e tratamento de borda/fundo. Preservar o gradiente nos CTAs e progressos, evitando competir com cada metadado.

## Efeitos e animações
- Entrada suave: 12 px de deslocamento, opacidade inicial 0,65 e duração de 420 ms. Conteúdo permanece visível sem depender da animação.
- Hover discreto: atalhos sobem 3 px, itens da sidebar deslocam 2 px, seletor de tema gira levemente. São efeitos pequenos e coerentes.
- Prefers-reduced-motion funciona no comportamento verificado.
- Não há alteração artificial da velocidade de rolagem. Recomendo manter isso.
- Faltam confirmações locais mais claras de salvar, concluir e inserir. Esses retornos ajudam mais que novos efeitos decorativos.
- Consideraria entradas mais curtas, em torno de 180–260 ms, após avaliar em aparelho real. Isso é recomendação de ritmo visual, não falha comprovada do tempo atual.

## Avaliação por tela

| Tela | O que está bom | Ajuste principal |
|---|---|---|
| Entrada | Foco claro no formulário, campos legíveis, CTA reconhecível | Mostrar/ocultar senha e recuperação de acesso quando houver suporte backend |
| Início | Indicadores reais, atalhos e identidade coerente | Atividades de hoje primeiro; eliminar repetição e corrigir grid |
| Rotina | Itens legíveis, progresso persistido, edição e arquivamento | Filtros por estado/tipo, registro de quantidade diretamente e regra de recorrência no botão |
| Calendário | Seleção de data e lista conectada à rotina | Atalhos Hoje/anterior/próximo, atrasados e data de conclusão explícita |
| Planos | Campos claros e salvamento por dia | Proteger rascunhos e facilitar acesso ao botão Salvar em textos longos |
| Perfil | Conta, senha, histórico e exportação funcionais | Separar visualmente evolução de configurações e reduzir repetição do resumo |

## Funcionamento e eficiência
A suíte existente confirmou novamente contas, isolamento, criação/edição/arquivamento, persistência, planos por dia, senha, conflito e tratamento de erro de rede. Ela não invalida os defeitos de UX encontrados nesta auditoria: seus cenários não verificavam perda de rascunho por fechamento, retorno de foco após edição ou ordem visual dos painéis.

O contador com apenas + e − é inadequado para grandes quantidades: registrar 100 questões exige 100 incrementos. Recomendo permitir digitar o total ou registrar um lote. Em listas maiores, filtros Abertas/Concluídas/Atrasadas e Hábitos/Tarefas são mais úteis que depender apenas da busca por nome. Arquivar preserva o histórico, mas falta uma área de arquivados/restauração para corrigir enganos.

A criação pelo + não aproveita automaticamente a data em consulta na agenda; o formulário começa com a data atual. É uma oportunidade de ação contextual, sem mudar a posição aprovada do botão.

## Acessibilidade: resultado e ressalvas
- Nenhuma violação automática nos escopos axe executados.
- Nenhum alvo de botão/link/input abaixo de 44 px nos elementos renderizados que o script mediu nas cinco rotas a 390 px.
- Nenhum overflow horizontal nas 70 combinações.
- Nenhum erro JavaScript nos fluxos do script principal de auditoria.
- Ainda assim, o retorno de foco da edição falhou. Validação automática de contraste/semântica não comprova a qualidade de todos os fluxos por teclado.
- A ordem visual versus DOM e a oclusão por navegação fixa precisam permanecer nos testes manuais de teclado, especialmente em scroll intermediário.

## Sequência de melhoria recomendada
1. Corrigir regras de grid e intervalos mobile; ajustar o painel compacto de métricas.
2. Preservar rascunhos e restaurar foco corretamente após editar.
3. Colocar atividade/agenda de hoje antes das estatísticas repetidas e reduzir cartões vazios.
4. Alinhar disponibilidade dos controles à recorrência e explicitar datas de conclusão.
5. Melhorar registro em quantidade, filtros de estado e recuperação de arquivados.
6. Refinar tipografia secundária, estados semânticos e animação de novos cartões.
7. Validar novamente com teclado, aparelhos reais e alunos representativos antes de ampliar o design.

## Evidências
Scripts: artifacts/interface-audit.mjs e artifacts/interface-motion.mjs. Relatórios: test-results/interface-audit/report.json e motion.json. Capturas no mesmo diretório: temas em 390/1440, login, estado vazio, edição e formulário baixo. As capturas longas mostram o dock fixo na altura do viewport capturado; não interpretar sua posição na imagem inteira como uma barra inserida no meio do documento.
