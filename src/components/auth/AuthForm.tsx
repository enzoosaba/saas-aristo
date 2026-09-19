"use client";
import { useState } from "react";
import Image from "next/image";
import { Eye, EyeOff } from "lucide-react";
import ThemeToggle from "../ThemeToggle";
import PasswordRecovery from "./PasswordRecovery";
export default function AuthForm({
  onSuccess,
  connectionError,
  resetToken = "",
  onRecoveryClose,
}: {
  onSuccess: () => Promise<void>;
  connectionError: string;
  resetToken?: string;
  onRecoveryClose?: () => void;
}) {
  const [register, setRegister] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [recovering, setRecovering] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    const values = new FormData(event.currentTarget);
    try {
      const response = await fetch("/api/auth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: register ? "register" : "login",
          email: values.get("email"),
          password: values.get("password"),
          ...(register ? { name: values.get("name") } : {}),
        }),
      });
      const result = await response.json();
      if (!response.ok) throw Error(result.error);
      await onSuccess();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Não foi possível entrar.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className="auth-screen">
      <div className="auth-top">
        <span>PLATAFORMA COELHO</span>
        <ThemeToggle />
      </div>
      <section className="auth-card">
        <Image
          src="/brand/coelho-mark.png"
          width={68}
          height={80}
          alt="Plataforma Coelho"
        />
        <p className="eyebrow">SEU PRÓXIMO PASSO COMEÇA AQUI</p>
        <h1>{register ? "Crie seu espaço." : "Bom ter você aqui."}</h1>
        <p>Organize sua rotina e acompanhe cada conquista.</p>
        {recovering || resetToken ? (
          <PasswordRecovery
            token={resetToken}
            onBack={() => {
              setRecovering(false);
              onRecoveryClose?.();
            }}
          />
        ) : (
          <form onSubmit={submit} className="quick-add-form">
            {register && (
              <label>
                Seu nome
                <input
                  name="name"
                  required
                  minLength={2}
                  maxLength={80}
                  autoComplete="name"
                />
              </label>
            )}
            <label>
              E-mail
              <input
                name="email"
                type="email"
                required
                maxLength={254}
                autoComplete="email"
              />
            </label>
            <label>
              Senha
              <div className="password-field">
                <input
                  name="password"
                  type={showPassword ? "text" : "password"}
                  required
                  minLength={8}
                  maxLength={128}
                  autoComplete={register ? "new-password" : "current-password"}
                />
                <button
                  type="button"
                  className="password-toggle"
                  aria-label={showPassword ? "Ocultar senha" : "Mostrar senha"}
                  aria-pressed={showPassword}
                  onClick={() => setShowPassword((value) => !value)}
                >
                  {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                </button>
              </div>
            </label>
            <p className="field-hint">Use pelo menos 8 caracteres.</p>
            {(error || connectionError) && (
              <p role="alert">{error || connectionError}</p>
            )}
            <button type="submit" className="primary-button" disabled={busy}>
              {busy ? "Aguarde…" : register ? "Criar conta" : "Entrar"}
            </button>
            <button
              type="button"
              disabled={busy}
              className="panel-link"
              onClick={() => {
                setRegister(!register);
                setError("");
              }}
            >
              {register ? "Já tenho uma conta" : "Criar minha conta"}
            </button>
            {!register && (
              <button
                type="button"
                className="panel-link"
                disabled={busy}
                onClick={() => setRecovering(true)}
              >
                Esqueci minha senha
              </button>
            )}
          </form>
        )}
      </section>
    </main>
  );
}
