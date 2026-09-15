# Mentoria Coelho — Arquitetura Funcional e Integração com Supabase

## 1. Objetivo

O Mentoria Coelho já possui a UX principal desenvolvida. A próxima etapa é estruturar corretamente a integração com o Supabase, garantindo uma base segura, escalável e preparada para:

- alunos;
- mentores;
- administradores;
- organizações de estudo;
- turmas/grupos;
- planejamento de estudos;
- provas e desempenho;
- hábitos, tarefas e eventos;
- XP, níveis, brasões e ranking;
- notificações internas e push;
- financeiro do mentor;
- uploads e materiais;
- permissões e segurança via RLS.

A estrutura não deve ser tratada apenas como uma conexão entre telas e banco de dados. O sistema passa a exigir uma arquitetura consistente de autenticação, dados, permissões e regras de negócio.

---

## 2. Estrutura geral do sistema

### 2.1 Painel Administrativo

```text
ADMIN
├── Dashboard
├── Usuários
├── Mentores
├── Alunos
├── Organizações de estudo
├── Turmas / Grupos
├── Ciclos
├── Disciplinas
├── Hábitos
├── Tipos de tarefas
├── Eventos
├── Provas
├── Regras de XP
├── Níveis
├── Brasões
├── Conquistas
├── Materiais
├── Uploads
├── Notificações
├── Push
├── Planos
├── Assinaturas
├── Pagamentos
├── Relatórios
├── Permissões
├── Configurações
└── Logs
```

### 2.2 Plataforma do Mentor

```text
MENTOR
├── Dashboard
├── Minhas turmas
│   ├── Organização de estudos
│   ├── Alunos
│   ├── Desempenho
│   ├── Ranking
│   └── Progresso
├── Agenda
├── Atividades
├── Provas
├── Notificações
└── Financeiro
    ├── Recebimentos
    ├── Inadimplência
    ├── Planos
    └── Indicadores
```

### 2.3 Plataforma do Aluno

```text
ALUNO
├── Dashboard
├── Minha organização
├── Plano de estudos
├── Hábitos
├── Tarefas
├── Agenda
├── Provas
├── Desempenho
├── Ranking
├── XP / Nível
├── Conquistas
├── Notificações
└── Perfil
```

---

# 3. Autenticação e perfil

O Supabase Auth deve ser responsável apenas pela autenticação.

As informações complementares do usuário devem ficar em uma tabela própria chamada `profiles`.

## 3.1 Relação

```text
auth.users
    ↓
profiles
```

## 3.2 Tabela `profiles`

Campos sugeridos:

```text
id uuid → auth.users.id
full_name
email
phone
avatar_url
birth_date
role
status
created_at
updated_at
```

Papéis iniciais:

```text
admin
mentor
student
```

## 3.3 Visualização da senha no login

A opção de visualizar ou ocultar senha é uma funcionalidade exclusivamente do frontend.

Alternar entre:

```html
type="password"
```

e:

```html
type="text"
```

Nenhuma alteração no Supabase é necessária para esse recurso.

---

# 4. Organizações de estudo

Não vincular diretamente o usuário por meio de um simples `group_id` dentro de `profiles`.

A estrutura deve permitir:

- usuário trocar de grupo;
- aluno participar de mais de uma organização no futuro;
- mentor possuir várias turmas;
- manter histórico;
- arquivar grupos;
- realizar rankings separados por organização.

## 4.1 Tabela `organizations`

```text
id
name
description
logo_url
mentor_id
status
start_date
end_date
created_at
```

## 4.2 Tabela `organization_members`

```text
id
organization_id
user_id
member_role
status
joined_at
```

Exemplo:

```text
Organização:
COELHO OAB 2027

Mentor:
Carlos Coelho

Alunos:
João
Maria
Eduardo
Fernanda
```

---

# 5. Organização e planejamento de estudos

Separar a turma da organização individual do estudo.

Criar:

```text
study_plans
study_plan_items
```

## 5.1 Tabela `study_plans`

```text
id
organization_id
student_id
mentor_id
name
cycle_id
start_date
end_date
status
created_at
```

## 5.2 Tabela `study_plan_items`

```text
id
study_plan_id
type
title
description
subject_id
scheduled_date
completed_at
status
xp_reward
```

Tipos possíveis:

```text
task
habit
event
study
review
exercise
exam
```

---

# 6. Ciclos e disciplinas

Criar tabelas próprias para facilitar filtros, organização de provas e análise de desempenho.

## 6.1 `cycles`

```text
id
organization_id
name
description
start_date
end_date
status
created_at
```

## 6.2 `subjects`

```text
id
name
description
status
created_at
```

Opcionalmente poderá existir uma tabela associativa:

```text
cycle_subjects
```

para vincular disciplinas específicas a cada ciclo.

---

# 7. Desempenho em provas

Criar um módulo próprio para registrar provas, simulados e avaliações.

## 7.1 Tabela `exam_results`

```text
id
student_id
organization_id
cycle_id

exam_name
exam_date

total_questions
answered_questions
correct_answers
wrong_answers
blank_answers

score
max_score

percentage
accuracy_percentage

duration_minutes

notes
created_at
updated_at
```

## 7.2 Indicadores

Exemplo:

```text
Simulado 03
Ciclo: 2

Questões: 100
Respondidas: 95
Acertos: 78
Erros: 17
Em branco: 5

Nota: 78
Valor da prova: 100

Aproveitamento: 78%
```

Cálculos importantes:

```text
accuracy_percentage =
correct_answers / answered_questions * 100

percentage =
score / max_score * 100
```

Esses cálculos devem preferencialmente ser centralizados no banco ou backend, evitando divergência entre telas.

---

# 8. Hábitos

Criar:

```text
habits
habit_completions
```

## 8.1 `habits`

```text
id
organization_id
created_by
title
description
frequency
xp_reward
active
created_at
```

## 8.2 `habit_completions`

```text
id
habit_id
user_id
completed_at
created_at
```

---

# 9. Tarefas

Criar:

```text
tasks
task_completions
```

## 9.1 `tasks`

```text
id
organization_id
student_id
mentor_id
title
description
due_date
status
xp_reward
created_at
updated_at
```

## 9.2 `task_completions`

```text
id
task_id
user_id
completed_at
created_at
```

---

# 10. Eventos

Criar:

```text
events
event_participations
```

## 10.1 `events`

```text
id
organization_id
title
description
event_date
location
xp_reward
created_by
created_at
```

## 10.2 `event_participations`

```text
id
event_id
user_id
status
confirmed_at
created_at
```

---

# 11. Sistema de XP

Não utilizar apenas um campo `profiles.xp`.

O ideal é manter um extrato completo das movimentações de XP.

Criar:

```text
xp_transactions
```

## 11.1 Tabela `xp_transactions`

```text
id
user_id
organization_id

source_type
source_id

xp_amount

description
created_at
```

Exemplo:

```text
+10  Concluiu hábito
+20  Concluiu tarefa
+50  Fez simulado
+15  Participou de evento
+100 Meta semanal
```

XP total:

```text
SUM(xp_transactions.xp_amount)
```

Benefícios:

- auditoria;
- histórico;
- ranking por período;
- reversão de pontuação;
- identificação da origem;
- prevenção contra manipulação direta.

---

# 12. Regras de XP

O administrador deverá conseguir configurar as regras sem alterar o código.

Criar:

```text
xp_rules
```

## 12.1 Campos

```text
id
action_type
name
description
xp_amount
daily_limit
weekly_limit
active
created_at
updated_at
```

Exemplo inicial:

| Ação | XP |
|---|---:|
| Concluir hábito | 5 |
| Concluir tarefa | 10 |
| Concluir sessão de estudo | 10 |
| Realizar revisão | 15 |
| Resolver bateria de questões | 20 |
| Realizar simulado | 50 |
| Cumprir meta semanal | 100 |

---

# 13. Níveis

Criar:

```text
levels
```

## 13.1 Campos

```text
id
level_number
name
description
min_xp
max_xp
badge_url
active
created_at
updated_at
```

Exemplo:

| Nível | Nome | XP mínimo |
|---|---|---:|
| 1 | Iniciante | 0 |
| 2 | Aprendiz | 500 |
| 3 | Persistente | 1.200 |
| 4 | Estrategista | 2.200 |
| 5 | Especialista | 3.800 |
| 6 | Mestre | 6.000 |

O administrador deve poder configurar:

- nome;
- nível;
- XP mínimo;
- XP máximo;
- brasão;
- descrição;
- status.

---

# 14. Brasões

Cada nível poderá possuir um brasão próprio.

Os arquivos deverão ser armazenados no Supabase Storage.

Exemplo:

```text
Nível 4
Estrategista

Brasão: /levels/strategist.png
```

Interface do aluno:

```text
NÍVEL 4
ESTRATEGISTA

██████████████░░░░░░

2.950 / 3.800 XP

850 XP para o próximo nível
```

Também exibir:

```text
XP acumulado: 2.950
```

É importante separar:

```text
XP total
XP dentro do nível
XP necessário para próximo nível
```

---

# 15. Progressão dos níveis

A quantidade necessária de XP deve aumentar progressivamente.

Exemplo:

```text
N1 → N2 = 500 XP
N2 → N3 = +700 XP
N3 → N4 = +1.000 XP
N4 → N5 = +1.500 XP
N5 → N6 = +2.200 XP
```

A estrutura deve permitir configuração manual pelo administrador.

No futuro poderá ser criada uma fórmula automática de progressão.

---

# 16. Ranking

O ranking principal deve funcionar dentro da organização de estudo.

Exemplo:

### Ranking — Turma OAB 2027

| # | Aluno | Nível | XP |
|---|---|---|---:|
| 1 | João | Especialista | 4.850 |
| 2 | Maria | Especialista | 4.720 |
| 3 | Eduardo | Estrategista | 3.950 |

Filtros sugeridos:

```text
Hoje
Semana
Mês
Ciclo
Geral
```

O ranking por período deve utilizar `xp_transactions`.

Exemplo:

```text
SUM(xp_transactions.xp_amount)
WHERE created_at BETWEEN período_inicial AND período_final
```

---

# 17. Fluxo de geração de XP

Exemplo para conclusão de hábito:

```text
Aluno concluiu hábito
        ↓
habit_completions
        ↓
regra XP encontrada
        ↓
+5 XP
        ↓
xp_transactions
        ↓
ranking atualizado
        ↓
nível recalculado
        ↓
notificação criada
```

A mesma lógica deverá funcionar para:

- tarefas;
- eventos;
- estudos;
- revisões;
- exercícios;
- simulados;
- metas;
- demais ações configuráveis.

---

# 18. Conquistas

Criar:

```text
achievements
user_achievements
```

## 18.1 `achievements`

```text
id
name
description
badge_url
criteria_type
criteria_value
xp_bonus
active
created_at
```

## 18.2 `user_achievements`

```text
id
achievement_id
user_id
organization_id
earned_at
created_at
```

Exemplos:

- 7 dias seguidos estudando;
- 1.000 questões resolvidas;
- primeiro simulado;
- 90% de aproveitamento;
- atingir um determinado nível.

---

# 19. Notificações internas

Criar:

```text
notifications
```

## 19.1 Campos

```text
id
user_id
title
message
type
action_url
read_at
created_at
```

Exemplos:

```text
Você recebeu 50 XP por concluir o Simulado 03.
```

```text
Parabéns! Você alcançou o nível Estrategista.
```

```text
Seu mentor adicionou uma nova tarefa.
```

```text
Um participante ultrapassou você no ranking.
```

---

# 20. Pop-ups e toasts

Os pop-ups/toasts deverão funcionar na própria interface.

Exemplos:

```text
+10 XP
Tarefa concluída!
```

```text
Novo nível alcançado!
Estrategista
```

```text
Novo material disponível.
```

Esses elementos são controlados pelo frontend, podendo receber eventos do Supabase Realtime.

---

# 21. Push externo

Arquitetura sugerida:

```text
Evento no banco
        ↓
notifications
        ↓
Database Webhook
        ↓
Supabase Edge Function
        ↓
provedor de Push
        ↓
dispositivo do usuário
```

Criar também:

```text
push_devices
```

Campos sugeridos:

```text
id
user_id
device_token
platform
device_name
active
last_seen_at
created_at
```

---

# 22. Plataforma do Mentor

O mentor deverá conseguir visualizar suas turmas e seus alunos.

## 22.1 Dashboard

Indicadores principais:

```text
Alunos ativos
Turmas
Média de progresso
Alunos em risco
```

Outros indicadores:

```text
Progresso médio
Questões realizadas
Taxa de acerto
Horas estudadas
Tarefas concluídas
```

---

# 23. Alertas do mentor

Criar uma área para destacar alunos que precisam de atenção.

Exemplo:

```text
Lucas
23% menos atividade esta semana
```

```text
Mariana
3 dias sem estudar
```

```text
João
Taxa de acerto caiu de 72% para 58%
```

Esses alertas poderão futuramente ser gerados automaticamente.

---

# 24. Perfil individual do aluno para o mentor

Ao acessar um aluno:

```text
Visão geral
Organização
Agenda
Hábitos
Questões
Provas
Desempenho
XP
Histórico
Observações
```

Indicadores e gráficos:

```text
Taxa de acerto
Evolução semanal
XP
Horas estudadas
Disciplinas com menor desempenho
Disciplinas com maior desempenho
```

---

# 25. Financeiro do mentor

Criar inicialmente:

```text
student_subscriptions
payments
```

## 25.1 `student_subscriptions`

```text
id
student_id
mentor_id
plan_name
amount
billing_day
start_date
end_date
status
created_at
updated_at
```

## 25.2 `payments`

```text
id
student_id
mentor_id
subscription_id

amount
due_date
paid_at
status
payment_method
notes

created_at
updated_at
```

Status possíveis:

```text
pending
paid
overdue
cancelled
refunded
```

---

# 26. Dashboard financeiro

Exemplo:

```text
Receita do mês
R$ 18.400

Recebido
R$ 15.200

A receber
R$ 2.100

Em atraso
R$ 1.100
```

Indicadores adicionais:

```text
MRR
inadimplência
receita prevista
receita realizada
alunos ativos
ticket médio
```

A integração com gateway de pagamento pode ser desenvolvida posteriormente.

---

# 27. Uploads e materiais

Usar Supabase Storage.

Criar estrutura de buckets como:

```text
avatars
level-badges
materials
organization-files
exam-files
```

Criar tabela:

```text
materials
```

Campos:

```text
id
organization_id
uploaded_by
title
description
file_url
file_type
category
visible_to
created_at
```

---

# 28. Segurança e RLS

A segurança deve ser aplicada no banco com Row Level Security.

Não depender apenas do frontend.

## 28.1 Aluno

Pode acessar:

```text
seu perfil
seus dados
seus resultados
seu plano de estudos
sua organização
ranking de sua organização
suas notificações
seu XP
```

Não deve acessar dados privados completos de outros alunos.

## 28.2 Mentor

Pode acessar:

```text
suas organizações
suas turmas
alunos vinculados às suas turmas
dados acadêmicos desses alunos
financeiro relacionado à própria operação
```

## 28.3 Admin

Pode gerenciar todo o sistema.

---

# 29. Estrutura inicial de tabelas

```text
AUTH
auth.users

USUÁRIOS
profiles
user_roles

ORGANIZAÇÕES
organizations
organization_members

MENTORIA
mentor_students

ESTUDO
cycles
subjects
cycle_subjects
study_plans
study_plan_items

HÁBITOS
habits
habit_completions

TAREFAS
tasks
task_completions

EVENTOS
events
event_participations

PROVAS
exam_results

GAMIFICAÇÃO
xp_rules
xp_transactions
levels
achievements
user_achievements

COMUNICAÇÃO
notifications
push_devices

FINANCEIRO
student_subscriptions
payments

CONTEÚDO
materials

SISTEMA
system_settings
audit_logs
```

---

# 30. Ajustes atuais de interface

Itens já identificados:

- [ ] Adicionar visualização da senha durante o login
- [ ] Corrigir página do perfil
- [ ] Desenvolver pop-ups internos
- [ ] Desenvolver notificações externas
- [ ] Vincular usuários às organizações de estudo
- [ ] Criar ranking da organização
- [ ] Criar lançamento de desempenho em provas
- [ ] Corrigir barra de progresso responsiva
- [ ] Criar plataforma do mentor
- [ ] Criar dashboard financeiro
- [ ] Criar sistema de XP
- [ ] Criar níveis progressivos
- [ ] Criar brasões
- [ ] Criar regras de pontuação
- [ ] Criar gestão administrativa dos níveis
- [ ] Criar gestão administrativa das organizações
- [ ] Criar gestão administrativa dos uploads
- [ ] Criar cadastro completo
- [ ] Implementar RLS
- [ ] Criar logs de auditoria

---

# 31. Ordem recomendada de implementação

## Fase 1 — Fundação Supabase

- revisar Auth atual;
- criar `profiles`;
- criar roles;
- configurar `admin`, `mentor` e `student`;
- criar triggers de perfil;
- implementar RLS;
- corrigir página do perfil;
- implementar visualização de senha;
- preparar migrations.

## Fase 2 — Organizações

- criar `organizations`;
- criar `organization_members`;
- criação pelo Admin;
- associação de mentor;
- associação de alunos;
- permissões;
- tela administrativa.

## Fase 3 — Estrutura acadêmica

- ciclos;
- disciplinas;
- planos de estudo;
- hábitos;
- tarefas;
- eventos;
- conclusões.

## Fase 4 — Provas e desempenho

- cadastro de provas;
- questões;
- acertos;
- erros;
- notas;
- valor da prova;
- percentuais;
- histórico;
- gráficos.

## Fase 5 — Gamificação

- regras de XP;
- `xp_transactions`;
- níveis;
- brasões;
- conquistas;
- cálculo de nível;
- ranking.

## Fase 6 — Plataforma do mentor

- dashboard;
- turmas;
- alunos;
- perfil detalhado;
- acompanhamento;
- indicadores;
- alertas.

## Fase 7 — Financeiro

- planos;
- assinaturas;
- pagamentos;
- inadimplência;
- indicadores;
- dashboard financeiro.

## Fase 8 — Comunicação

- notificações internas;
- Supabase Realtime;
- toasts;
- pop-ups;
- Push externo;
- Edge Functions.

## Fase 9 — Refinamento

- responsividade;
- barra de progresso;
- performance;
- logs;
- auditoria;
- testes RLS;
- testes de integração;
- testes de permissões.

---

# 32. Diretriz técnica

A partir desta etapa, todas as alterações estruturais no Supabase devem preferencialmente ser feitas por migrations SQL versionadas.

Evitar depender somente do Table Editor.

Estrutura esperada:

```text
supabase/
└── migrations/
    ├── 001_create_profiles.sql
    ├── 002_create_roles.sql
    ├── 003_create_organizations.sql
    ├── 004_create_organization_members.sql
    ├── 005_create_study_structure.sql
    ├── 006_create_exam_results.sql
    ├── 007_create_gamification.sql
    ├── 008_create_notifications.sql
    └── 009_create_financial.sql
```

Assim será possível:

- acompanhar a evolução do banco;
- reproduzir o ambiente;
- testar alterações;
- reverter problemas;
- evitar inconsistências;
- documentar corretamente a arquitetura.

---

# 33. Próximo passo recomendado

Antes de iniciar os módulos de ranking, mentor ou financeiro, criar a fundação:

```text
01. profiles
02. roles
03. organizations
04. organization_members
05. relação mentor ↔ alunos
06. políticas RLS
07. triggers de criação de perfil
08. Storage
09. tipos/enums
10. migrations
```

Depois dessa fundação, conectar progressivamente a UX existente ao Supabase.

---

# 34. Objetivo da próxima etapa

Produzir a primeira migration da Mentoria Coelho contendo:

- enums;
- `profiles`;
- roles;
- organizações;
- membros;
- relações mentor/aluno;
- índices;
- constraints;
- triggers;
- funções auxiliares;
- RLS;
- policies;
- Storage inicial.

Essa base deverá sustentar todas as próximas etapas da plataforma.
