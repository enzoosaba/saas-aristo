const NICE_FACTORS = [1, 2, 3, 5, 6, 10];

function nearestNiceStep(value: number) {
  if (value <= 1) return 1;
  const exponent = Math.floor(Math.log10(value));
  const scale = 10 ** exponent;
  const candidates = [
    ...NICE_FACTORS.map((factor) => factor * scale),
    ...NICE_FACTORS.map((factor) => factor * scale * 10),
  ];
  return candidates.reduce((nearest, candidate) =>
    Math.abs(candidate - value) < Math.abs(nearest - value)
      ? candidate
      : nearest,
  );
}

export function clampCount(value: number, target: number) {
  if (!Number.isFinite(value)) return 0;
  return Math.min(target, Math.max(0, Math.round(value)));
}

export function countQuickSteps(target: number) {
  const safeTarget = Math.max(1, Math.round(target));
  const base = nearestNiceStep(safeTarget / 20);
  const multipliers = base === 1 ? [1, 5, 10] : [1, 3, 6];
  return [
    ...new Set(multipliers.map((value) => Math.min(safeTarget, base * value))),
  ];
}
