import { useEffect, useMemo, useState } from 'react';
import type { UsagePoint } from '~/lib/dashboard-stats.server';

type RechartsModule = typeof import('recharts');
type ChartComponents = Pick<
  RechartsModule,
  | 'Area'
  | 'AreaChart'
  | 'CartesianGrid'
  | 'ResponsiveContainer'
  | 'Tooltip'
  | 'XAxis'
  | 'YAxis'
>;

export function UsageChart({ data }: { data: UsagePoint[] }) {
  const [chart, setChart] = useState<ChartComponents | null>(null);
  const total = useMemo(
    () => data.reduce((acc, d) => acc + d.calls, 0),
    [data]
  );
  const empty = total === 0;

  useEffect(() => {
    let mounted = true;

    void import('recharts').then((mod) => {
      if (!mounted) return;
      setChart({
        Area: mod.Area,
        AreaChart: mod.AreaChart,
        CartesianGrid: mod.CartesianGrid,
        ResponsiveContainer: mod.ResponsiveContainer,
        Tooltip: mod.Tooltip,
        XAxis: mod.XAxis,
        YAxis: mod.YAxis,
      });
    });

    return () => {
      mounted = false;
    };
  }, []);

  const chartBody = chart ? (
    <chart.ResponsiveContainer width="100%" height="100%">
      <chart.AreaChart
        data={data}
        margin={{ top: 8, right: 8, left: 0, bottom: 0 }}
      >
        <defs>
          <linearGradient id="usageFill" x1="0" y1="0" x2="0" y2="1">
            <stop
              offset="0%"
              stopColor="var(--accent)"
              stopOpacity={0.45}
            />
            <stop
              offset="100%"
              stopColor="var(--accent)"
              stopOpacity={0}
            />
          </linearGradient>
        </defs>
        <chart.CartesianGrid
          stroke="var(--line)"
          strokeDasharray="3 3"
          vertical={false}
        />
        <chart.XAxis
          dataKey="day"
          stroke="var(--ink-3)"
          fontSize={11}
          tickLine={false}
          axisLine={false}
        />
        <chart.YAxis
          stroke="var(--ink-3)"
          fontSize={11}
          tickLine={false}
          axisLine={false}
          width={32}
          allowDecimals={false}
        />
        <chart.Tooltip
          cursor={{ stroke: 'var(--line-2)', strokeWidth: 1 }}
          contentStyle={{
            background: 'var(--bg-2)',
            border: '1px solid var(--line)',
            borderRadius: 8,
            fontSize: 12,
            color: 'var(--ink)',
          }}
          labelStyle={{ color: 'var(--ink-3)', fontSize: 11 }}
          formatter={(v: number) => [`${v} volání`, '']}
          separator=""
        />
        <chart.Area
          type="monotone"
          dataKey="calls"
          stroke="var(--accent)"
          strokeWidth={2}
          fill="url(#usageFill)"
          isAnimationActive={!empty}
        />
      </chart.AreaChart>
    </chart.ResponsiveContainer>
  ) : (
    <div
      aria-hidden
      style={{
        height: '100%',
        border: '1px solid var(--line)',
        borderRadius: 8,
        background:
          'linear-gradient(180deg, rgba(255,122,61,0.08), rgba(255,122,61,0.01))',
      }}
    />
  );

  return (
    <section
      className="card"
      style={{ padding: 22, marginBottom: 24, position: 'relative' }}
    >
      <div
        className="row between"
        style={{ marginBottom: 14, flexWrap: 'wrap', gap: 8 }}
      >
        <div className="col gap-4">
          <h3 className="heading-3" style={{ margin: 0 }}>
            Volání za posledních 7 dní
          </h3>
          <span className="muted" style={{ fontSize: 12 }}>
            {empty
              ? 'Zatím bez aktivity — zkuste tool z Claude.'
              : `Celkem ${total.toLocaleString('cs-CZ')} volání`}
          </span>
        </div>
        <span
          className="mono"
          style={{
            fontSize: 11,
            color: 'var(--ink-3)',
            letterSpacing: '0.08em',
            textTransform: 'uppercase',
          }}
        >
          7d
        </span>
      </div>
      <div style={{ width: '100%', height: 160 }}>
        {chartBody}
      </div>
    </section>
  );
}
