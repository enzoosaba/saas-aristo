// Feature switches for modules that are built but not open to users yet.
//
// QUESTION_BANK_ENABLED: while false, /questoes shows a "Em breve" notice
// instead of the question bank. Only the screen is switched off — the API
// actions (save/delete-question), the stored data, the analytics on the home
// page and the navigation entries are untouched. Set to true to bring the
// screen back (src/components/QuestionBankModule.tsx is the unchanged
// previous page).
export const QUESTION_BANK_ENABLED = false;
