"use client";

import { useEffect, useRef } from "react";
import { AlertTriangle } from "lucide-react";
import Card from "@/components/ui/Card";

export default function ErrorPage({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const titleRef = useRef<HTMLHeadingElement>(null);
  useEffect(() => { titleRef.current?.focus(); }, []);
  return <Card className="route-error">
    <AlertTriangle size={28} aria-hidden="true" />
    <h1 ref={titleRef} tabIndex={-1}>Não foi possível abrir esta tela</h1>
    <p>Ocorreu um erro ao carregar o conteúdo. Tente novamente para continuar.</p>
    <button type="button" className="primary-button" onClick={reset}>Tentar novamente</button>
  </Card>;
}
