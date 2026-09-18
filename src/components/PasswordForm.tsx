"use client";
import { useState } from "react";
import { Eye, EyeOff } from "lucide-react";
export default function PasswordForm() {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState(false);
  const [showCurrent, setShowCurrent] = useState(false);
  const [showNew, setShowNew] = useState(false);
  async function save(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const values = new FormData(form);
    setBusy(true);
    setError(false);
    try {
      const response = await fetch("/api/auth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "change-password",
          currentPassword: values.get("currentPassword"),
          newPassword: values.get("newPassword"),
        }),
      });
      const result = await response.json();
      if (!response.ok) throw Error(result.error);
      form.reset();
      setMessage("Senha alterada. As outras sessões foram encerradas.");
    } catch (e) {
      setError(true);
      setMessage(
        e instanceof Error ? e.message : "Não foi possível alterar a senha.",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <form className="account-form" onSubmit={save}>
      <h2>Alterar senha</h2>
      <label>
        Senha atual
        <div className="password-field">
          <input
            type={showCurrent ? "text" : "password"}
            name="currentPassword"
            autoComplete="current-password"
            required
            minLength={8}
            maxLength={128}
          />
          <button
            type="button"
            className="password-toggle"
            aria-label={showCurrent ? "Ocultar senha atual" : "Mostrar senha atual"}
            aria-pressed={showCurrent}
            onClick={() => setShowCurrent((value) => !value)}
          >
            {showCurrent ? <EyeOff size={18} /> : <Eye size={18} />}
          </button>
        </div>
      </label>
      <label>
        Nova senha
        <div className="password-field">
          <input
            type={showNew ? "text" : "password"}
            name="newPassword"
            autoComplete="new-password"
            required
            minLength={8}
            maxLength={128}
          />
          <button
            type="button"
            className="password-toggle"
            aria-label={showNew ? "Ocultar nova senha" : "Mostrar nova senha"}
            aria-pressed={showNew}
            onClick={() => setShowNew((value) => !value)}
          >
            {showNew ? <EyeOff size={18} /> : <Eye size={18} />}
          </button>
        </div>
      </label>
      <p role={error ? "alert" : "status"}>{message}</p>
      <button disabled={busy} className="primary-button" type="submit">
        {busy ? "Salvando…" : "Alterar senha"}
      </button>
    </form>
  );
}
