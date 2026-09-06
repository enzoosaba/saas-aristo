"use client";
import PasswordForm from "@/components/PasswordForm";
import { useState } from "react";
import Card from "@/components/ui/Card";
import { PerformancePanels } from "@/components/StudyPanels";
import { useStudy } from "@/components/StudyProvider";
import { progress } from "@/lib/domain";
export default function PerfilPage() {
  const { data, mutate, logout } = useStudy();
  const stats = progress(data.items, data.records, data.today);
  const [status, setStatus] = useState("");
  const [error, setError] = useState(false);
  const [busy, setBusy] = useState(false);
  async function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError(false);
    const name = new FormData(event.currentTarget).get("name");
    try {
      await mutate({ action: "profile", name });
      setStatus("Perfil atualizado.");
    } catch (e) {
      setError(true);
      setStatus(e instanceof Error ? e.message : "Não foi possível salvar.");
    } finally {
      setBusy(false);
    }
  }
  async function signout() {
    setBusy(true);
    try {
      await logout();
    } catch (e) {
      setError(true);
      setStatus(e instanceof Error ? e.message : "Não foi possível sair.");
      setBusy(false);
    }
  }
  function download() {
    const blob = new Blob([JSON.stringify(data, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `coelho-${data.today}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  return (
    <div className="workspace-page flex flex-col gap-5">
      <h1>Meu perfil</h1>
      <p className="page-description">
        Seu histórico, suas conquistas e sua conta.
      </p>
      <div className="real-metrics">
        <Card>
          <p>Nível</p>
          <strong>{stats.level}</strong>
        </Card>
        <Card>
          <p>XP acumulado</p>
          <strong>{stats.xp}</strong>
        </Card>
        <Card>
          <p>Realizações</p>
          <strong>{stats.totalDone}</strong>
        </Card>
        <Card>
          <p>Constância</p>
          <strong>{stats.streak} dias</strong>
        </Card>
      </div>
      <PerformancePanels />
      <Card>
        <div className="panel-title">
          <h2>Minha conta</h2>
        </div>
        <form className="account-form" onSubmit={save}>
          <label>
            Nome do perfil
            <input
              name="name"
              defaultValue={data.user.name}
              required
              minLength={2}
              maxLength={80}
              autoComplete="name"
            />
          </label>
          <p>{data.user.email}</p>
          <p role={error ? "alert" : "status"}>{status}</p>
          <button type="submit" className="primary-button" disabled={busy}>
            {busy ? "Aguarde…" : "Salvar perfil"}
          </button>
        </form>
        <div className="account-actions">
          <button onClick={download}>Exportar meus dados</button>
          <button disabled={busy} onClick={() => void signout()}>
            Sair da conta
          </button>
        </div>
      </Card>
      <Card>
        <PasswordForm />
      </Card>
      <Card>
        <div className="panel-title">
          <h2>Acompanhamento da mentoria</h2>
        </div>
        <p className="panel-description">
          O espaço exclusivo do mentor será integrado em uma próxima etapa.
        </p>
      </Card>
    </div>
  );
}
