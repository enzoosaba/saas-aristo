"use client";
import {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  useRef,
  type ReactNode,
} from "react";
import type { StudyState, StudyItem } from "@/lib/domain";
import AuthForm from "./auth/AuthForm";
type Context = {
  data: StudyState;
  mutate: (payload: unknown) => Promise<void>;
  refresh: () => Promise<void>;
  editing: StudyItem | null;
  setEditing: (item: StudyItem | null) => void;
  logout: () => Promise<void>;
};
const StudyContext = createContext<Context | null>(null);
export function useStudy() {
  const value = useContext(StudyContext);
  if (!value) throw Error("StudyProvider ausente");
  return value;
}
export default function StudyProvider({ children }: { children: ReactNode }) {
  const epoch = useRef(0);
  const writing = useRef(false);
  const [data, setData] = useState<StudyState | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [editing, setEditing] = useState<StudyItem | null>(null);
  const [resetToken, setResetToken] = useState("");
  useEffect(() => {
    const readToken = () => {
      const token = new URLSearchParams(window.location.hash.slice(1)).get(
        "reset",
      );
      if (token && /^[a-f0-9]{64}$/.test(token)) {
        setResetToken(token);
        window.history.replaceState(
          null,
          "",
          window.location.pathname + window.location.search,
        );
      }
    };
    readToken();
    window.addEventListener("hashchange", readToken);
    return () => window.removeEventListener("hashchange", readToken);
  }, []);
  const refresh = useCallback(async () => {
    if (writing.current) return;
    const version = ++epoch.current;
    try {
      const response = await fetch("/api/study", { cache: "no-store" });
      if (version !== epoch.current) return;
      if (response.status === 401) {
        setData(null);
        setError("");
        return;
      }
      const result = await response.json();
      if (!response.ok) throw Error(result.error);
      if (version === epoch.current) {
        setData(result);
        setError("");
      }
    } catch {
      setError(
        "Não foi possível sincronizar. Confira sua conexão e tente novamente.",
      );
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- refresh updates state after awaiting the network response.
    void refresh();
    const focus = () => {
      void refresh();
    };
    window.addEventListener("focus", focus);
    const interval = setInterval(() => {
      if (document.visibilityState === "visible") void refresh();
    }, 30000);
    return () => {
      window.removeEventListener("focus", focus);
      clearInterval(interval);
    };
  }, [refresh]);
  async function mutate(payload: unknown) {
    if (writing.current)
      throw Error("Aguarde o salvamento atual e tente novamente.");
    writing.current = true;
    epoch.current++;
    try {
      const response = await fetch("/api/study", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      }).catch(() => {
        throw Error(
          "Não foi possível conectar. Confira sua conexão; seu preenchimento foi mantido.",
        );
      });
      const result = await response.json();
      if (response.status === 401) {
        setData(null);
        throw Error("Sua sessão expirou. Entre novamente.");
      }
      if (!response.ok) throw Error(result.error || "Não foi possível salvar.");
      setData(result);
      setError("");
    } finally {
      writing.current = false;
    }
  }
  async function logout() {
    if (writing.current) throw Error("Aguarde o salvamento antes de sair.");
    epoch.current++;
    writing.current = true;
    try {
      const response = await fetch("/api/auth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "logout" }),
      });
      if (!response.ok) throw Error("Não foi possível sair. Tente novamente.");
      setData(null);
      setEditing(null);
    } finally {
      writing.current = false;
    }
  }
  if (resetToken)
    return (
      <AuthForm
        onSuccess={refresh}
        connectionError=""
        resetToken={resetToken}
        onRecoveryClose={() => {
          setResetToken("");
          void refresh();
        }}
      />
    );
  if (loading)
    return (
      <main className="auth-screen">
        <p role="status">Abrindo seu espaço de estudos…</p>
      </main>
    );
  if (!data) return <AuthForm onSuccess={refresh} connectionError={error} />;
  return (
    <StudyContext.Provider
      value={{ data, mutate, refresh, editing, setEditing, logout }}
    >
      {error && (
        <div className="sync-error" role="alert">
          {error}
          <button onClick={() => void refresh()}>Tentar novamente</button>
        </div>
      )}
      {children}
    </StudyContext.Provider>
  );
}
