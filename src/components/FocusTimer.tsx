"use client";

import { useEffect, useRef, useState } from "react";
import { CirclePause, Play, RotateCcw, Square, Timer, XCircle } from "lucide-react";
import { elapsedFocusSeconds, focusControls, formatFocusTime } from "@/lib/focus";
import { useStudy } from "./StudyProvider";

type FocusAction = "start" | "pause" | "resume" | "end" | "abandon";
const busyLabels: Record<FocusAction, string> = {
  start: "Iniciando…",
  pause: "Pausando…",
  resume: "Retomando…",
  end: "Encerrando…",
  abandon: "Abandonando…",
};

export default function FocusTimer({ placement = "card" }: { placement?: "card" | "header" }) {
  const { data, mutate, showToast } = useStudy();
  const { focus } = data;
  const [now, setNow] = useState(() => focus.active ? Date.parse(focus.active.measuredAt) : 0);
  const [reason, setReason] = useState("");
  const [studySessionId, setStudySessionId] = useState(focus.active?.studySessionId || "");
  const [busy, setBusy] = useState<FocusAction | null>(null);
  const [error, setError] = useState("");
  const commands = useRef(new Map<string, string>());
  const disclosure = useRef<HTMLDetailsElement>(null);

  useEffect(() => {
    if (focus.active?.status !== "RUNNING") return;
    const interval = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(interval);
  }, [focus.active?.status]);

  const activeSeconds = elapsedFocusSeconds(focus, now);
  const todaySeconds = focus.creditedTodaySeconds + activeSeconds;
  const controls = focusControls(focus);
  const plannedSessions = data.sessions.filter(
    (session) => session.date === data.today && (session.status || "planned") === "planned",
  );
  const linkedSession = data.sessions.find(
    (session) => session.id === (focus.active?.studySessionId || studySessionId),
  );

  async function send(action: FocusAction) {
    const active = focus.active;
    const key = `${action}:${active?.id || "idle"}`;
    const commandId = commands.current.get(key) || crypto.randomUUID();
    commands.current.set(key, commandId);
    setBusy(action);
    setError("");
    try {
      if (action === "start") {
        await mutate({ action: "focus-start", commandId, ...(studySessionId ? { studySessionId } : {}) });
        showToast("Sessão de foco iniciada.");
      } else if (active) {
        if (action === "pause") await mutate({ action: "focus-pause", commandId, sessionId: active.id });
        if (action === "resume") await mutate({ action: "focus-resume", commandId, sessionId: active.id, reason });
        if (action === "end") {
          await mutate({ action: "focus-end", commandId, sessionId: active.id });
          showToast("Sessão encerrada. Seu tempo de foco foi salvo.");
        }
        if (action === "abandon") {
          await mutate({ action: "focus-abandon", commandId, sessionId: active.id });
          showToast("Sessão abandonada. O tempo não contou para conquistas.");
        }
      }
      commands.current.delete(key);
      if (action === "resume") setReason("");
      if (action === "end" || action === "abandon") disclosure.current?.removeAttribute("open");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Não foi possível atualizar o relógio.");
    } finally {
      setBusy(null);
    }
  }

  const timer = (
    <section
      className={`focus-timer${placement === "header" ? " focus-timer--header-panel" : ""}`}
      data-state={focus.active?.status.toLowerCase() || "idle"}
      aria-labelledby="focus-timer-title"
    >
      <div className="focus-timer-heading">
        <span className="focus-timer-icon" aria-hidden="true"><Timer size={20} /></span>
        <div>
          <h3 id="focus-timer-title">Tempo de Foco</h3>
          <p>{focus.active?.status === "RUNNING" ? "Sessão em andamento" : focus.active?.status === "PAUSED" ? "Sessão pausada" : "Pronto para começar"}</p>
        </div>
      </div>

      <div className="focus-time-grid">
        <div><span>Sessão atual</span><strong>{formatFocusTime(activeSeconds)}</strong></div>
        <div><span>Acumulado hoje</span><strong>{formatFocusTime(todaySeconds)}</strong></div>
      </div>

      {!focus.active && (
        <label className="focus-session-link">
          Sessão planejada de hoje <span>(opcional)</span>
          <select value={studySessionId} onChange={(event) => setStudySessionId(event.target.value)} disabled={!!busy}>
            <option value="">Sem vínculo</option>
            {plannedSessions.map((session) => (
              <option key={session.id} value={session.id}>{session.start} · {session.subject} · {session.title}</option>
            ))}
          </select>
        </label>
      )}

      {linkedSession && (
        <p className="focus-linked-status" role="status">
          <strong>{linkedSession.subject}</strong>
          <span>{linkedSession.status === "in_progress" ? "Em andamento" : linkedSession.status === "completed" ? `Concluída · ${linkedSession.netFocusMinutes || 0} min líquidos` : linkedSession.status === "abandoned" ? `Abandonada · ${linkedSession.netFocusMinutes || 0} min líquidos` : "Planejada"}</span>
        </p>
      )}

      {focus.active?.status === "PAUSED" && (
        <label className="focus-resume-reason">
          Motivo da pausa
          <input value={reason} maxLength={300} onChange={(event) => setReason(event.target.value)} placeholder="Ex.: intervalo para água" disabled={!!busy} />
        </label>
      )}
      {error && <p className="focus-timer-error" role="alert">{error}</p>}

      <div className="focus-timer-actions">
        {controls.includes("start") && <button disabled={!!busy} onClick={() => void send("start")}><Play size={17} />{busy === "start" ? busyLabels.start : "Iniciar"}</button>}
        {controls.includes("pause") && <button disabled={!!busy} onClick={() => void send("pause")}><CirclePause size={17} />{busy === "pause" ? busyLabels.pause : "Pausar"}</button>}
        {controls.includes("resume") && <button disabled={!!busy || !reason.trim()} onClick={() => void send("resume")}><RotateCcw size={17} />{busy === "resume" ? busyLabels.resume : "Retomar"}</button>}
        {controls.includes("end") && <button className="focus-end-button" disabled={!!busy} onClick={() => void send("end")}><Square size={16} />{busy === "end" ? busyLabels.end : "Encerrar"}</button>}
        {focus.active && (
          <button className="focus-abandon-button" disabled={!!busy} onClick={() => {
            if (window.confirm("Abandonar esta sessão? O tempo não contará para conquistas.")) void send("abandon");
          }}><XCircle size={16} />{busy === "abandon" ? busyLabels.abandon : "Abandonar"}</button>
        )}
      </div>
    </section>
  );

  if (placement === "header") {
    return (
      <details className="header-focus-timer" ref={disclosure}>
        <summary data-active={focus.active?.status === "RUNNING"} aria-label={`Abrir relógio de foco, ${formatFocusTime(todaySeconds)} hoje`} title="Tempo de Foco">
          <Timer size={20} aria-hidden="true" /><span>{formatFocusTime(todaySeconds)}</span>
        </summary>
        <div className="header-focus-timer-popover">{timer}</div>
      </details>
    );
  }
  return timer;
}
