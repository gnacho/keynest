import { motion, useReducedMotion } from 'framer-motion';

export const SPARK_W = 64;
export const SPARK_H = 28;
const SPARK_PAD = 2;

// Curva monotone cúbica (equivalente al type="monotone" de recharts)
export function sparkLinePath(data: number[]): string {
  const n = data.length;
  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min || 1;
  const pts = data.map((v, i) => {
    const x = SPARK_PAD + (i * (SPARK_W - SPARK_PAD * 2)) / (n - 1);
    const y = SPARK_H - SPARK_PAD - ((v - min) / range) * (SPARK_H - SPARK_PAD * 2);
    return { x, y };
  });

  const dx: number[] = [];
  const slope: number[] = [];
  for (let i = 0; i < n - 1; i++) {
    dx[i] = pts[i + 1].x - pts[i].x || 1e-6;
    slope[i] = (pts[i + 1].y - pts[i].y) / dx[i];
  }
  const t: number[] = [];
  t[0] = slope[0];
  t[n - 1] = slope[n - 2];
  for (let i = 1; i < n - 1; i++) {
    t[i] = slope[i - 1] === 0 || slope[i] === 0 ? 0 : (slope[i - 1] + slope[i]) / 2;
  }
  for (let i = 0; i < n - 1; i++) {
    const a = t[i] / slope[i];
    const b = t[i + 1] / slope[i];
    const s = a * a + b * b;
    if (s > 9) {
      const k = 3 / Math.sqrt(s);
      t[i] = k * a * slope[i];
      t[i + 1] = k * b * slope[i];
    }
  }

  let d = `M ${pts[0].x} ${pts[0].y}`;
  for (let i = 0; i < n - 1; i++) {
    const p0 = pts[i];
    const p1 = pts[i + 1];
    const c1x = p0.x + dx[i] / 3;
    const c1y = p0.y + (t[i] * dx[i]) / 3;
    const c2x = p1.x - dx[i] / 3;
    const c2y = p1.y - (t[i + 1] * dx[i]) / 3;
    d += ` C ${c1x} ${c1y}, ${c2x} ${c2y}, ${p1.x} ${p1.y}`;
  }
  return d;
}

export function Sparkline({ data, color }: { data: number[]; color: string }) {
  const reduce = useReducedMotion();
  const line = sparkLinePath(data);
  const area = `${line} L ${SPARK_W - SPARK_PAD} ${SPARK_H} L ${SPARK_PAD} ${SPARK_H} Z`;
  const gid = `spark-${color.replace(/[^a-zA-Z0-9]/g, '')}`;
  const spring = { delay: 0.3, duration: 0.8, ease: 'easeOut' as const };

  return (
    <svg viewBox={`0 0 ${SPARK_W} ${SPARK_H}`} width="100%" height="100%" aria-hidden="true">
      <defs>
        <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.22" />
          <stop offset="100%" stopColor={color} stopOpacity="0.02" />
        </linearGradient>
      </defs>
      <motion.path
        d={area}
        fill={`url(#${gid})`}
        initial={reduce ? false : { opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={spring}
      />
      <motion.path
        d={line}
        fill="none"
        stroke={color}
        strokeWidth={1.8}
        strokeLinecap="round"
        strokeLinejoin="round"
        initial={reduce ? false : { pathLength: 0 }}
        animate={{ pathLength: 1 }}
        transition={spring}
      />
    </svg>
  );
}
