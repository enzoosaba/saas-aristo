export default function ProgressBar({
  label = "Progresso",
  value,
  max,
  colorClassName = "bg-accent",
  trackClassName = "bg-black/10",
}: {
  label?: string;
  value: number;
  max: number;
  colorClassName?: string;
  trackClassName?: string;
}) {
  const pct = max > 0 ? Math.max(0, Math.min(100, Math.round((value / max) * 100))) : 0;
  return (
    <div role="progressbar" aria-label={label} aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} className={`h-2 w-full overflow-hidden rounded-full ${trackClassName}`}>
      <div
        className={`h-full rounded-full ${colorClassName} transition-all`}
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}
