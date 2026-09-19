"use client";
import { useEffect, useState } from "react";
import Card from "@/components/ui/Card";
import { useStudy } from "@/components/StudyProvider";
import { Eye, EyeOff, ShieldCheck, UserPlus } from "lucide-react";

type Member = { id: string; name: string; email: string; role: "student" | "mentor" };

export default function AdminPage() {
  const { data } = useStudy();

  if (!data.platformAdmin)
    return (
      <div className="workspace-page flex flex-col gap-5">
        <h1>Torre de controle</h1>
        <Card>
          <p className="panel-description">
            Esta área é exclusiva para administradores da plataforma.
          </p>
        </Card>
      </div>
    );

  return (
    <div className="workspace-page flex flex-col gap-5">
      <h1>Torre de controle</h1>
      <p className="page-description">
        Gerencie contas e papéis da Mentoria Coelho.
      </p>
      <CreateMemberCard />
      <MembersCard />
    </div>
  );
}

function CreateMemberCard() {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [role, setRole] = useState<"student" | "mentor">("student");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const [error, setError] = useState(false);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError(false);
    try {
      const response = await fetch("/api/admin", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "create-member",
          name,
          email,
          password,
          role,
        }),
      });
      const result = await response.json();
      if (!response.ok) throw Error(result.error || "Não foi possível criar a conta.");
      setStatus(`Conta criada para ${email}. Repasse a senha temporária por um canal seguro.`);
      setName("");
      setEmail("");
      setPassword("");
      setRole("student");
    } catch (e) {
      setError(true);
      setStatus(e instanceof Error ? e.message : "Não foi possível criar a conta.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <div className="panel-title">
        <h2>
          <UserPlus size={18} />
          Criar conta
        </h2>
      </div>
      <p className="panel-description">
        A pessoa poderá trocar essa senha depois, em Perfil → Alterar senha.
      </p>
      <form className="account-form" onSubmit={(e) => void submit(e)}>
        <label>
          Nome
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            minLength={2}
            maxLength={80}
          />
        </label>
        <label>
          E-mail
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            maxLength={254}
          />
        </label>
        <label>
          Senha temporária
          <div className="password-field">
            <input
              type={showPassword ? "text" : "password"}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              minLength={8}
              maxLength={128}
            />
            <button
              type="button"
              className="password-toggle"
              aria-label={showPassword ? "Ocultar senha" : "Mostrar senha"}
              aria-pressed={showPassword}
              onClick={() => setShowPassword((v) => !v)}
            >
              {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
            </button>
          </div>
        </label>
        <label>
          Papel inicial
          <select
            value={role}
            onChange={(e) => setRole(e.target.value as "student" | "mentor")}
          >
            <option value="student">Aluno</option>
            <option value="mentor">Mentor</option>
          </select>
        </label>
        <p role={error ? "alert" : "status"}>{status}</p>
        <button type="submit" className="primary-button" disabled={busy}>
          {busy ? "Criando…" : "Criar conta"}
        </button>
      </form>
    </Card>
  );
}

function MembersCard() {
  const [members, setMembers] = useState<Member[] | null>(null);
  const [busyId, setBusyId] = useState("");
  const [status, setStatus] = useState("");
  const [error, setError] = useState(false);
  const [resetting, setResetting] = useState<Member | null>(null);

  function load() {
    fetch("/api/admin", { cache: "no-store" })
      .then(async (response) => {
        const result = await response.json();
        if (!response.ok) throw Error(result.error);
        setMembers(result.members);
      })
      .catch((e) => {
        setError(true);
        setStatus(e instanceof Error ? e.message : "Não foi possível carregar os membros.");
      });
  }

  useEffect(() => {
    load();
  }, []);

  async function setRole(userId: string, role: "student" | "mentor") {
    setBusyId(userId);
    setError(false);
    try {
      const response = await fetch("/api/admin", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "set-role", userId, role }),
      });
      const result = await response.json();
      if (!response.ok) throw Error(result.error || "Não foi possível alterar o papel.");
      load();
      setStatus("Papel atualizado.");
    } catch (e) {
      setError(true);
      setStatus(e instanceof Error ? e.message : "Não foi possível alterar o papel.");
    } finally {
      setBusyId("");
    }
  }

  return (
    <Card>
      <div className="panel-title">
        <h2>
          <ShieldCheck size={18} />
          Membros da Mentoria Coelho
        </h2>
      </div>
      <p role={error ? "alert" : "status"}>{status}</p>
      {members === null ? (
        <p className="panel-description">Carregando…</p>
      ) : (
        <ul className="mentor-roster member-roster">
          {members.map((member) => (
            <li key={member.id}>
              <span>
                <strong>{member.name}</strong>
                <small>{member.email}</small>
              </span>
              <span className="member-actions">
                <button
                  type="button"
                  disabled={busyId === member.id}
                  onClick={() =>
                    void setRole(member.id, member.role === "mentor" ? "student" : "mentor")
                  }
                >
                  {member.role === "mentor" ? "Rebaixar a aluno" : "Promover a mentor"}
                </button>
                <button
                  type="button"
                  aria-label={`Redefinir senha de ${member.name}`}
                  aria-expanded={resetting?.id === member.id}
                  onClick={() => {
                    setStatus("");
                    setResetting(resetting?.id === member.id ? null : member);
                  }}
                >
                  Redefinir senha
                </button>
              </span>
              {resetting?.id === member.id && (
                <ResetPasswordForm
                  member={member}
                  onClose={() => setResetting(null)}
                  onDone={(message) => {
                    setResetting(null);
                    setError(false);
                    setStatus(message);
                  }}
                />
              )}
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

// Inline form under the member's row: the admin types a temporary password,
// which the person changes afterwards in Perfil → Alterar senha. Every session
// of that account is signed out by the server.
function ResetPasswordForm({
  member,
  onClose,
  onDone,
}: {
  member: Member;
  onClose: () => void;
  onDone: (message: string) => void;
}) {
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/admin", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "reset-password",
          userId: member.id,
          password,
        }),
      });
      const result = await response.json();
      if (!response.ok)
        throw Error(result.error || "Não foi possível redefinir a senha.");
      onDone(
        `Senha de ${member.name} redefinida. Repasse a senha temporária por um canal seguro; a pessoa foi desconectada de todos os dispositivos.`,
      );
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Não foi possível redefinir a senha.",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <form
      className="account-form reset-password-form"
      onSubmit={(e) => void submit(e)}
      aria-label={`Redefinir senha de ${member.name}`}
    >
      <label>
        Nova senha temporária
        <div className="password-field">
          <input
            type={showPassword ? "text" : "password"}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            minLength={8}
            maxLength={128}
            autoComplete="off"
            autoFocus
          />
          <button
            type="button"
            className="password-toggle"
            aria-label={showPassword ? "Ocultar senha" : "Mostrar senha"}
            aria-pressed={showPassword}
            onClick={() => setShowPassword((v) => !v)}
          >
            {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
          </button>
        </div>
      </label>
      <p className="field-hint">
        Mínimo de 8 caracteres. {member.name} será desconectado(a) de todos os
        dispositivos e poderá trocar essa senha em Perfil → Alterar senha.
      </p>
      {error && <p role="alert">{error}</p>}
      <div className="member-actions">
        <button type="submit" className="primary-button" disabled={busy}>
          {busy ? "Redefinindo…" : "Redefinir senha"}
        </button>
        <button type="button" onClick={onClose} disabled={busy}>
          Cancelar
        </button>
      </div>
    </form>
  );
}
