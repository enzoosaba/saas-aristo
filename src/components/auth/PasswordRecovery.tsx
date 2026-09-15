"use client";
import { useState } from "react";

export default function PasswordRecovery({
  token = "",
  onBack,
}: {
  token?: string;
  onBack: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    if (token && form.get("password") !== form.get("confirm")) {
      setError("As senhas precisam ser iguais.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/auth/recovery", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          token
            ? { action: "reset", token, password: form.get("password") }
            : { action: "request", email: form.get("email") },
        ),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error);
      setMessage(result.message);
    } catch (error) {
      setError(
        error instanceof Error
          ? error.message
          : "Não foi possível conectar. Tente novamente.",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="quick-add-form">
      <h2>{token ? "Escolha uma nova senha" : "Recuperar acesso"}</h2>
      {message ? (
        <p role="status">{message}</p>
      ) : (
        <form onSubmit={submit} className="quick-add-form">
          {token ? (
            <>
              <label>
                Nova senha
                <input
                  name="password"
                  type="password"
                  autoComplete="new-password"
                  minLength={12}
                  maxLength={128}
                  required
                />
              </label>
              <label>
                Confirme a nova senha
                <input
                  name="confirm"
                  type="password"
                  autoComplete="new-password"
                  minLength={12}
                  maxLength={128}
                  required
                />
              </label>
              <p className="field-hint">Use pelo menos 12 caracteres.</p>
            </>
          ) : (
            <label>
              E-mail da sua conta
              <input
                name="email"
                type="email"
                autoComplete="email"
                maxLength={254}
                required
              />
            </label>
          )}
          {error && <p role="alert">{error}</p>}
          <button className="primary-button" disabled={busy}>
            {busy
              ? "Aguarde…"
              : token
                ? "Salvar nova senha"
                : "Enviar link de recuperação"}
          </button>
        </form>
      )}
      <button
        className="panel-link"
        type="button"
        disabled={busy}
        onClick={onBack}
      >
        Voltar para entrar
      </button>
    </div>
  );
}
