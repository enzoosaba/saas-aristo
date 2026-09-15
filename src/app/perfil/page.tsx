"use client";
import PasswordForm from "@/components/PasswordForm";
import { useRef, useState } from "react";
import Card from "@/components/ui/Card";
import ProgressBar from "@/components/ui/ProgressBar";
import Avatar from "@/components/ui/Avatar";
import { PerformancePanels } from "@/components/StudyPanels";
import { useStudy } from "@/components/StudyProvider";
import { progress } from "@/lib/domain";
import { resizeImageToDataUrl } from "@/lib/image";
import { Camera, Trash2, Flame } from "lucide-react";
export default function PerfilPage() {
  const { data, mutate, logout } = useStudy();
  const stats = progress(data.items, data.records, data.today);
  const [status, setStatus] = useState("");
  const [error, setError] = useState(false);
  const [busy, setBusy] = useState(false);
  const [avatarBusy, setAvatarBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
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
  async function handleAvatarFile(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      setError(true);
      setStatus("Selecione um arquivo de imagem.");
      return;
    }
    setAvatarBusy(true);
    setError(false);
    try {
      const avatar = await resizeImageToDataUrl(file, 256);
      await mutate({ action: "update-avatar", avatar });
      setStatus("Foto de perfil atualizada.");
    } catch (e) {
      setError(true);
      setStatus(
        e instanceof Error ? e.message : "Não foi possível atualizar a foto.",
      );
    } finally {
      setAvatarBusy(false);
    }
  }
  async function removeAvatar() {
    setAvatarBusy(true);
    setError(false);
    try {
      await mutate({ action: "update-avatar", avatar: null });
      setStatus("Foto de perfil removida.");
    } catch (e) {
      setError(true);
      setStatus(
        e instanceof Error ? e.message : "Não foi possível remover a foto.",
      );
    } finally {
      setAvatarBusy(false);
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
      <Card>
        <div className="panel-title">
          <h2>Personalização do perfil</h2>
        </div>
        <div className="profile-identity">
          <div className="profile-avatar-edit">
            <Avatar user={data.user} className="profile-avatar" />
            <button
              type="button"
              className="avatar-edit-button"
              aria-label="Alterar foto de perfil"
              disabled={avatarBusy}
              onClick={() => fileRef.current?.click()}
            >
              <Camera size={16} />
            </button>
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              hidden
              onChange={(e) => void handleAvatarFile(e)}
            />
          </div>
          <div>
            <h2>{data.user.name}</h2>
            <p>Seu espaço de evolução</p>
            {data.user.avatar && (
              <button
                type="button"
                className="avatar-remove-button"
                disabled={avatarBusy}
                onClick={() => void removeAvatar()}
              >
                <Trash2 size={14} />
                Remover foto
              </button>
            )}
          </div>
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
          <label>
            E-mail
            <input value={data.user.email} disabled readOnly />
          </label>
          <p role={error ? "alert" : "status"}>{status}</p>
          <button type="submit" className="primary-button" disabled={busy}>
            {busy ? "Aguarde…" : "Salvar perfil"}
          </button>
        </form>
      </Card>
      <div className="real-metrics">
        <Card>
          <p>Nível</p>
          <strong>{stats.level}</strong>
          <ProgressBar
            label="Progresso para o próximo nível"
            value={stats.levelXp}
            max={200}
          />
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
          <strong className="streak-with-fire"><Flame size={24} aria-hidden="true"/>{stats.streak} dias</strong>
        </Card>
      </div>
      <Card>
        <h2>Ranking da mentoria</h2>
        {data.ranking.length ? (
          <>
            <p>
              Sua posição:{" "}
              {data.ranking.findIndex((u) => u.id === data.user.id) + 1}º ·
              Experiência acumulada
            </p>
            <div className="ranking-podium">
              {data.ranking.slice(0, 3).map((u, i) => (
                <div key={u.id}>
                  <b>{i + 1}º</b>
                  <Avatar user={u} className="profile-avatar" />
                  <strong>{u.name}</strong>
                  <span>{u.xp} XP</span>
                </div>
              ))}
            </div>
          </>
        ) : (
          <div className="study-empty">
            <strong>Seu grupo ainda não foi vinculado</strong>
            <p>
              O ranking estará disponível quando houver uma turma associada à
              sua conta.
            </p>
          </div>
        )}
      </Card>
      <PerformancePanels />
      <Card>
        <div className="panel-title">
          <h2>Conta</h2>
        </div>
        <p className="panel-description">
          Gerencie o acesso e os dados vinculados à sua conta.
        </p>
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
          {data.ranking.length
            ? "Sua conta está vinculada a uma mentoria. O mentor acompanha suas realizações, questões e planos registrados aqui."
            : "Sua conta ainda não está vinculada a uma mentoria. Peça ao seu mentor para adicionar o e-mail cadastrado."}
        </p>
      </Card>
    </div>
  );
}
