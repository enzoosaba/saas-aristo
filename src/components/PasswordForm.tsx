"use client";
import { useState } from "react";
export default function PasswordForm() {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState(false);
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
        <input
          type="password"
          name="currentPassword"
          autoComplete="current-password"
          required
          minLength={8}
          maxLength={128}
        />
      </label>
      <label>
        Nova senha
        <input
          type="password"
          name="newPassword"
          autoComplete="new-password"
          required
          minLength={8}
          maxLength={128}
        />
      </label>
      <p role={error ? "alert" : "status"}>{message}</p>
      <button disabled={busy} className="primary-button" type="submit">
        {busy ? "Salvando…" : "Alterar senha"}
      </button>
    </form>
  );
}
