export const aluno = {
  nome: "Enzo Saba",
  tier: "Prata" as const,
  nivel: 27,
  xpAtual: 786,
  xpProximoNivel: 810,
  rankingScore: 599,
  streakUsoPlataforma: 23,
};

export const fraseDoDia =
  "Disciplina é escolher entre o que você quer agora e o que você quer mais.";

export type Habito =
  | {
      id: string;
      nome: string;
      tipo: "checklist";
      feito: boolean;
      streak: number;
      xp: number;
    }
  | {
      id: string;
      nome: string;
      tipo: "medivel";
      valor: number;
      meta: number;
      unidade: string;
      streak: number;
      xp: number;
    };

export const habitos: Habito[] = [
  { id: "h1", nome: "Ler 20 páginas", tipo: "checklist", feito: true, streak: 12, xp: 20 },
  { id: "h2", nome: "Beber água", tipo: "medivel", valor: 5, meta: 8, unidade: "copos", streak: 12, xp: 10 },
  { id: "h3", nome: "Questões de Matemática", tipo: "medivel", valor: 12, meta: 30, unidade: "questões", streak: 5, xp: 30 },
  { id: "h4", nome: "Dormir antes das 23h", tipo: "checklist", feito: false, streak: 3, xp: 15 },
  { id: "h5", nome: "Flashcards", tipo: "medivel", valor: 0, meta: 40, unidade: "cards", streak: 0, xp: 20 },
];

export const xpHojeMeta = 500;
export const xpHojeAtual = 11;

export const horariosDiarios = [
  { id: "d1", horario: "06:30", atividade: "Acordar e revisão rápida" },
  { id: "d2", horario: "08:00", atividade: "Aula: Tipos Textuais" },
  { id: "d3", horario: "13:00", atividade: "Questões de Matemática" },
  { id: "d4", horario: "19:00", atividade: "Flashcards + revisão" },
];

export const metasSemanais = [
  { id: "m1", nome: "Questões respondidas", atual: 210, meta: 300 },
  { id: "m2", nome: "Horas de foco", atual: 8, meta: 15 },
  { id: "m3", nome: "Aulas concluídas", atual: 4, meta: 6 },
];

export const proximaProva = {
  nome: "ENEM 2026",
  data: "08 e 15 de novembro",
  diasRestantes: 64,
  progresso: 79,
};

const NIVEIS_STREAK = [
  2, 3, 1, 0, 2, 3, 3, 1, 0, 2, 3, 2, 1, 0, 0, 2, 3, 3, 2, 1, 0, 2, 3, 3, 3, 2,
  1, 0, 2, 3,
] as const;

export const streakCalendario: { dia: number; nivel: 0 | 1 | 2 | 3 }[] = NIVEIS_STREAK.map(
  (nivel, i) => ({ dia: i + 1, nivel })
);

export const aulaEmAndamento = {
  trilha: "BASE INTELECTUAL",
  titulo: "Tipos Textuais",
  subtitulo: "Como dominar Tipologia Textual?",
  aulaAtual: 1,
  totalAulas: 15,
  progresso: 0,
};

export type PeriodoId = "total" | "7" | "30" | "60" | "90";

export const periodos: { id: PeriodoId; label: string }[] = [
  { id: "total", label: "Total" },
  { id: "7", label: "7 dias" },
  { id: "30", label: "30 dias" },
  { id: "60", label: "60 dias" },
  { id: "90", label: "90 dias" },
];

export const desempenhoPorPeriodo: Record<
  PeriodoId,
  { taxaAcerto: number; questoes: number }
> = {
  total: { taxaAcerto: 81, questoes: 656 },
  "7": { taxaAcerto: 74, questoes: 88 },
  "30": { taxaAcerto: 78, questoes: 264 },
  "60": { taxaAcerto: 80, questoes: 431 },
  "90": { taxaAcerto: 81, questoes: 587 },
};

export const evolucaoAcerto = [
  { data: "28/08", taxa: 63, media: 62, questoes: 18 },
  { data: "30/08", taxa: 66, media: 63, questoes: 37 },
  { data: "01/09", taxa: 65, media: 64, questoes: 21 },
  { data: "02/09", taxa: 68, media: 64, questoes: 40 },
  { data: "03/09", taxa: 67, media: 65, questoes: 48 },
  { data: "05/09", taxa: 69, media: 65, questoes: 12 },
];

export const topicosErros = [
  { posicao: 1, area: "Matemática", topico: "Funções e gráficos", erros: 66 },
  { posicao: 2, area: "Linguagens", topico: "Interpretação de texto", erros: 11 },
  { posicao: 3, area: "História", topico: "Brasil República", erros: 9 },
  { posicao: 4, area: "Biologia", topico: "Genética", erros: 7 },
];

export const desempenho = {
  taxaAcerto: 81,
  questoesPeriodo: 656,
  melhorArea: "Geografia",
  pontoDeAtencao: "História",
  areas: [
    { nome: "Linguagens e Códigos", valor: 81 },
    { nome: "Ciências Humanas", valor: 50 },
    { nome: "Biologia", valor: 50 },
    { nome: "Química", valor: 66 },
    { nome: "Física", valor: 79 },
    { nome: "Matemática", valor: 83 },
  ],
  rankingMentor: [
    { nome: "Enzo Saba", score: 599, voce: true },
    { nome: "Marina Alves", score: 542, voce: false },
    { nome: "Rafael Lima", score: 488, voce: false },
    { nome: "Júlia Prado", score: 401, voce: false },
  ],
};
