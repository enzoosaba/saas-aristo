import ComingSoon from "@/components/ComingSoon";
import QuestionBankModule from "@/components/QuestionBankModule";
import { QUESTION_BANK_ENABLED } from "@/lib/features";

export default function QuestoesPage() {
  if (!QUESTION_BANK_ENABLED)
    return <ComingSoon eyebrow="PRÁTICA COM DIREÇÃO" title="Banco de questões" />;
  return <QuestionBankModule />;
}
