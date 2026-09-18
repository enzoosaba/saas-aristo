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
        <ul className="mentor-roster">
          {members.map((member) => (
            <li key={member.id}>
              <span>
                <strong>{member.name}</strong>
                <small>{member.email}</small>
              </span>
              <button
                type="button"
                disabled={busyId === member.id}
                onClick={() =>
                  void setRole(member.id, member.role === "mentor" ? "student" : "mentor")
                }
              >
                {member.role === "mentor" ? "Rebaixar a aluno" : "Promover a mentor"}
              </button>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
