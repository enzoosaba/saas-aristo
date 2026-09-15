"use client";
import { useRef, useState } from "react";
import {
  ChevronLeft,
  ChevronRight,
  ChartNoAxesCombined,
  NotebookPen,
  OctagonAlert,
  Hexagon,
  ChartBar,
} from "lucide-react";
import { useStudy } from "./StudyProvider";
import Card from "./ui/Card";
import { QUESTION_AREAS as areas, questionAnalytics } from "@/lib/domain";

export default function QuestionAnalytics() {
  const { data } = useStudy();
  const [areaView, setAreaView] = useState("radar");
  const [period, setPeriod] = useState(7);
  const scroll = useRef<HTMLDivElement>(null);
  const {
    rows,
    total,
    correct,
    percent,
    days,
    values,
    areaStats,
    cumulative,
    max,
    topics,
  } = questionAnalytics(data.questions, data.today, period);
  const point = (i: number, r: number) =>
    `${160 + Math.sin((i * Math.PI) / 3) * r},${160 - Math.cos((i * Math.PI) / 3) * r}`;
  return (
    <section className="question-analytics" aria-label="Desempenho em questões">
      <div className="section-heading">
        <h2>Seu desempenho</h2>
        <div className="period-switch" aria-label="Período do desempenho">
          {[7, 30, 90].map((p) => (
            <button
              key={p}
              aria-pressed={period === p}
              onClick={() => setPeriod(p)}
            >
              {p} dias
            </button>
          ))}
        </div>
      </div>
      <div className="desktop-performance-stats" aria-label="Resumo do período">
        <Card>
          <span>Taxa de acerto</span>
          <strong>{total ? `${percent}%` : "—"}</strong>
          <small>
            {total
              ? `${correct} acertos em ${total} questões`
              : "Sem questões no período"}
          </small>
        </Card>
        <Card>
          <span>Questões no período</span>
          <strong>{total.toLocaleString("pt-BR")}</strong>
          <small>{period} dias de prática</small>
        </Card>
        <Card>
          <span>Melhor área</span>
          <strong>
            {areaStats.some((a) => a.total)
              ? `${Math.max(...areaStats.filter((a) => a.total).map((a) => a.percent))}%`
              : "—"}
          </strong>
          <small>
            {[...areaStats]
              .filter((a) => a.total)
              .sort((a, b) => b.percent - a.percent)[0]?.name ||
              "Aguardando registros"}
          </small>
        </Card>
        <Card>
          <span>Prioridade de revisão</span>
          <strong>
            {areaStats.some((a) => a.total)
              ? `${Math.min(...areaStats.filter((a) => a.total).map((a) => a.percent))}%`
              : "—"}
          </strong>
          <small>
            {[...areaStats]
              .filter((a) => a.total)
              .sort((a, b) => a.percent - b.percent)[0]?.name ||
              "Aguardando registros"}
          </small>
        </Card>
      </div>
      {!rows.length ? (
        <Card>
          <div className="study-empty">
            <ChartNoAxesCombined size={32} />
            <strong>Seu desempenho começa aqui</strong>
            <p>
              Registre questões neste período para acompanhar seus acertos e os
              assuntos que merecem revisão.
            </p>
          </div>
        </Card>
      ) : (
        <div className="analytics-grid">
          <Card className="answered-card">
            <h3>
              <NotebookPen size={22} />
              Questões feitas
            </h3>
            <div className="question-summary">
              <div
                className="question-ring"
                role="img"
                aria-label={`${percent}% de acertos em ${total} questões`}
                style={{
                  background: `conic-gradient(var(--brand-orange) ${percent}%, var(--border-default) 0)`,
                }}
              >
                <div>
                  <strong className="desktop-question-value">{percent}%</strong>
                  <span className="desktop-question-value">de acertos</span>
                  <strong className="mobile-question-value">
                    {total.toLocaleString("pt-BR")}
                  </strong>
                  <span className="mobile-question-value">
                    questões
                    <br />
                    respondidas
                  </span>
                </div>
              </div>
              <div className="mobile-question-breakdown">
                <div>
                  <span>Acertos</span>
                  <strong>{correct.toLocaleString("pt-BR")}</strong>
                  <b>{percent}%</b>
                </div>
                <div>
                  <span>Erros</span>
                  <strong>{(total - correct).toLocaleString("pt-BR")}</strong>
                  <b>{100 - percent}%</b>
                </div>
              </div>
              <dl>
                <dt>Respondidas</dt>
                <dd>{total}</dd>
                <dt>Acertos</dt>
                <dd>{correct}</dd>
                <dt>Erros</dt>
                <dd>{total - correct}</dd>
              </dl>
            </div>
          </Card>
          <Card className="area-performance-card">
            <h3>
              <ChartNoAxesCombined size={22} />
              Taxa de acerto por área
            </h3>
            <div
              className="area-view-controls"
              role="group"
              aria-label="Visualização por área"
            >
              <button
                aria-pressed={areaView === "radar"}
                aria-label="Ver radar"
                onClick={() => setAreaView("radar")}
              >
                <Hexagon size={20} />
              </button>
              <button
                aria-pressed={areaView === "bars"}
                aria-label="Ver barras por área"
                onClick={() => setAreaView("bars")}
              >
                <ChartBar size={20} />
              </button>
            </div>
            {areaView === "bars" ? (
              <div className="area-bar-list">
                {areaStats.map((a) => (
                  <div key={a.name}>
                    <div>
                      <span>{a.name}</span>
                      <strong>{a.total ? `${a.percent}%` : "Sem dados"}</strong>
                    </div>
                    <progress
                      aria-label={`Acertos em ${a.name}`}
                      max={100}
                      value={a.percent}
                    />
                  </div>
                ))}
              </div>
            ) : (
              <svg
                className="radar-chart"
                viewBox="0 0 320 320"
                role="img"
                aria-label="Taxa de acerto por área. Valores apresentados nos rótulos."
              >
                {[30, 60, 90].map((r) => (
                  <polygon
                    key={r}
                    points={areas.map((_, i) => point(i, r)).join(" ")}
                    fill="none"
                    stroke="var(--border-default)"
                  />
                ))}
                <polygon
                  points={areas
                    .map((a, i) => {
                      const list = rows.filter((q) => q.subject === a);
                      const n = list.reduce((s, q) => s + q.total, 0);
                      return point(
                        i,
                        n
                          ? (90 * list.reduce((s, q) => s + q.correct, 0)) / n
                          : 0,
                      );
                    })
                    .join(" ")}
                  fill="var(--surface-warm)"
                  stroke="var(--brand-orange)"
                  strokeWidth="2"
                />
                {areas.map((a, i) => {
                  const list = rows.filter((q) => q.subject === a);
                  const n = list.reduce((s, q) => s + q.total, 0);
                  const [x, y] = point(i, 120).split(",");
                  return (
                    <text
                      key={a}
                      x={x}
                      y={y}
                      textAnchor="middle"
                      fill="var(--foreground)"
                      fontSize="12"
                    >
                      {a}
                      <tspan x={x} dy="16">
                        {n
                          ? `${Math.round((100 * list.reduce((s, q) => s + q.correct, 0)) / n)}%`
                          : "Sem dados"}
                      </tspan>
                    </text>
                  );
                })}
              </svg>
            )}
          </Card>
          <Card className="full-width evolution-performance-card">
            <div className="section-heading">
              <h3>Evolução dos acertos</h3>
              <div className="chart-arrows">
                <button
                  aria-label="Dias anteriores"
                  onClick={() =>
                    scroll.current?.scrollBy({ left: -280, behavior: "smooth" })
                  }
                >
                  <ChevronLeft />
                </button>
                <button
                  aria-label="Próximos dias"
                  onClick={() =>
                    scroll.current?.scrollBy({ left: 280, behavior: "smooth" })
                  }
                >
                  <ChevronRight />
                </button>
              </div>
            </div>
            <p className="chart-legend">
              Barras: questões no dia · Linha: acerto acumulado no período
              (0–100%)
            </p>
            <div className="history-scroll" ref={scroll}>
              <div
                className="history-chart"
                style={{ minWidth: Math.max(280, period * 44) }}
              >
                <svg
                  viewBox={`0 0 ${period * 44} 140`}
                  preserveAspectRatio="none"
                  aria-hidden="true"
                >
                  {[0, 25, 50, 75, 100].map((t) => (
                    <line
                      key={t}
                      x1="0"
                      x2={period * 44}
                      y1={140 - t * 1.3}
                      y2={140 - t * 1.3}
                      stroke="var(--border-default)"
                      strokeDasharray="3 4"
                    />
                  ))}
                  {values.map((v, i) => (
                    <rect
                      key={i}
                      x={i * 44 + 12}
                      y={140 - (v.total / max) * 130}
                      width="20"
                      height={(v.total / max) * 130}
                      rx="4"
                      fill="var(--border-default)"
                    />
                  ))}
                  {values.map((v, i) =>
                    cumulative[i] !== null ? (
                      <circle
                        key={`point-${i}`}
                        cx={i * 44 + 22}
                        cy={140 - (cumulative[i] || 0) * 130}
                        r="4"
                        fill="var(--brand-orange)"
                      />
                    ) : null,
                  )}
                  <polyline
                    points={values
                      .map((v, i) =>
                        cumulative[i] !== null
                          ? `${i * 44 + 22},${140 - (cumulative[i] || 0) * 130}`
                          : null,
                      )
                      .filter(Boolean)
                      .join(" ")}
                    fill="none"
                    stroke="var(--brand-orange)"
                    strokeWidth="3"
                  />
                </svg>
                <div className="history-days">
                  {days.map((d, i) => (
                    <div
                      key={d}
                      title={`${d}: ${values[i].correct} acertos em ${values[i].total} questões`}
                    >
                      <strong>
                        {cumulative[i] !== null
                          ? `${Math.round((cumulative[i] || 0) * 100)}%`
                          : "—"}
                      </strong>
                      <span>
                        {d.slice(8)}/{d.slice(5, 7)}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </Card>
          <Card className="full-width topics-card">
            <h3>
              <OctagonAlert size={22} />
              Tópicos para revisar
            </h3>
            {topics.length ? (
              topics.map((t, i) => (
                <div className="topic-row" key={t.label}>
                  <b>{i + 1}</b>
                  <details className="topic-detail">
                    <summary title={t.label}>{t.label}</summary>
                    <p>{t.label}</p>
                  </details>
                  <strong>{t.errors} erros</strong>
                </div>
              ))
            ) : (
              <div className="study-empty">
                Nenhum erro registrado neste período.
              </div>
            )}
          </Card>
        </div>
      )}
    </section>
  );
}
