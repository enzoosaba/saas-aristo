"use client";

import { useEffect, useRef, useState } from "react";
import { CirclePause, Play, RotateCcw, Square, Timer } from "lucide-react";
import {
  elapsedFocusSeconds,
  focusControls,
  formatFocusTime,
} from "@/lib/focus";
import { useStudy } from "./StudyProvider";

type FocusAction = "start" | "pause" | "resume" | "end";

export default function FocusTimer() {
  const { data, mutate, showToast } = useStudy();
  const { focus } = data;
  const [now, setNow] = useState(() =>
    focus.active ? Date.parse(focus.active.measuredAt) : 0,
  );
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState<FocusAction | null>(null);
  const [error, setError] = useState("");
  const commands = useRef(new Map<string, string>());

  useEffect(() => {
    if (focus.active?.status !== "RUNNING") return;
    const interval = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(interval);
  }, [focus.active?.status]);

  const activeSeconds = elapsedFocusSeconds(focus, now);
  const todaySeconds = focus.creditedTodaySeconds + activeSeconds;
  const controls = focusControls(focus);

  async function send(action: FocusAction) {
    const active = focus.active;
    const key = `${action}:${active?.id || "idle"}`;
    const commandId = commands.current.get(key) || crypto.randomUUID();
    commands.current.set(key, commandId);
    setBusy(action);
    setError("");
    try {
      if (action === "start") {
        await mutate({ action: "focus-start", commandId });
        showToast("Sessão de foco iniciada.");
      } else if (active) {
        if (action === "pause")
          await mutate({
            action: "focus-pause",
            commandId,
            sessionId: active.id,
          });
        if (action === "resume")
          await mutate({
            action: "focus-resume",
            commandId,
            sessionId: active.id,
            reason,
          });
        if (action === "end") {
          await mutate({
            action: "focus-end",
            commandId,
            sessionId: active.id,
          });
          showToast("Sessão encerrada. Seu tempo de foco foi salvo.");
        }
      }
      commands.current.delete(key);
      if (action === "resume") setReason("");
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "Não foi possível atualizar o relógio.",
      );
    } finally {
      setBusy(null);
    }
  }

  return (
    <section className="focus-timer" aria-labelledby="focus-timer-title">
      <div className="focus-timer-heading">
        <span className="focus-timer-icon" aria-hidden="true">
          <Timer size={20} />
        </span>
        <div>
          <h3 id="focus-timer-title">Tempo de Foco</h3>
          <p>
            {focus.active?.status === "RUNNING"
              ? "Sessão em andamento"
              : focus.active?.status === "PAUSED"
                ? "Sessão pausada"
                : "Pronto para começar"}
          </p>
        </div>
        <strong aria-label={`${formatFocusTime(todaySeconds)} de foco hoje`}>
          {formatFocusTime(todaySeconds)}
        </strong>
      </div>

      {focus.active?.status === "PAUSED" && (
        <label className="focus-resume-reason">
          Motivo da pausa
          <input
            value={reason}
            maxLength={300}
            onChange={(event) => setReason(event.target.value)}
            placeholder="Ex.: intervalo para água"
            disabled={!!busy}
          />
        </label>
      )}

      {error && <p className="focus-timer-error" role="alert">{error}</p>}

      <div className="focus-timer-actions">
        {controls.includes("start") && (
          <button disabled={!!busy} onClick={() => void send("start")}>
            <Play size={17} />
            Iniciar
          </button>
        )}
        {controls.includes("pause") && (
          <button disabled={!!busy} onClick={() => void send("pause")}>
            <CirclePause size={17} />
            Pausar
          </button>
        )}
        {controls.includes("resume") && (
          <button
            disabled={!!busy || !reason.trim()}
            onClick={() => void send("resume")}
          >
            <RotateCcw size={17} />
            Retomar
          </button>
        )}
        {controls.includes("end") && (
          <button
            className="focus-end-button"
            disabled={!!busy}
            onClick={() => void send("end")}
          >
            <Square size={16} />
            Encerrar
          </button>
        )}
      </div>
    </section>
  );
}
