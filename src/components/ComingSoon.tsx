import Link from "next/link";
import { ArrowLeft, Hourglass } from "lucide-react";
import Card from "@/components/ui/Card";

// Placeholder for a module that is not open yet: the module title, an
// "Em breve" notice and a way back home.
export default function ComingSoon({
  eyebrow,
  title,
}: {
  eyebrow: string;
  title: string;
}) {
  return (
    <div className="workspace-page module-stack" data-module-state="coming-soon">
      <div>
        <p className="eyebrow">{eyebrow}</p>
        <h1>{title}</h1>
      </div>
      <Card>
        <div className="study-empty coming-soon">
          <Hourglass size={32} aria-hidden="true" />
          <h2>Em breve</h2>
          <p>Estamos preparando este módulo. Volte em breve.</p>
          <Link className="primary-button" href="/">
            <ArrowLeft size={18} aria-hidden="true" />
            Voltar ao início
          </Link>
        </div>
      </Card>
    </div>
  );
}
