# Planejamento semanal e apresentação

Meu planejamento abre a aba Planos, com um quadro semanal de sessões: título, matéria, dia, horário inicial, duração e observações. O aluno pode criar, editar, mover entre dias por arraste no desktop e excluir blocos. No celular, seleciona o dia e edita pelos mesmos campos. Sessões aparecem também nos detalhes do calendário.

A API valida duração de 15 a 480 minutos, término no mesmo dia, sobreposição de horários, versão do registro e propriedade da conta. As sessões são persistidas em study_sessions e não marcam automaticamente hábitos como concluídos.

A constância continua sendo calculada pelas atividades concluídas e agora usa um ícone de fogo no cabeçalho, destaque e perfil.

Dados demonstrativos foram adicionados à conta local do Enzo, preservando registros existentes: quatro hábitos, quatro tarefas, 42 registros de questões, duas semanas de sessões, planos diários e turma demonstrativa. Existe indicação visual de que há dados de apresentação. O script scripts/seed-presentation.mjs recebe o ID da conta e não duplica a carga; cria backup antes da alteração. Backups locais em data/backups.

Testes: npm run verify, npm run build, npm run test:e2e. artifacts/weekly-e2e.mjs cobre criação, edição, persistência, movimentação, conflito de horário, validação, isolamento por conta, exclusão e acessibilidade em mobile/desktop.
