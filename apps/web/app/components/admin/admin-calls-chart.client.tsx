import { useEffect, useState } from 'react';
import {
  Bar,
  BarChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

export function AdminCallsChart({ value }: { value: number }) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  if (!mounted) {
    return (
      <div className="h-56 rounded-lg border border-zinc-800 bg-zinc-900/30" />
    );
  }

  const data = [{ label: 'Volání', calls: value }];

  return (
    <div className="h-56 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data}>
          <XAxis dataKey="label" stroke="#71717a" />
          <YAxis stroke="#71717a" />
          <Tooltip
            contentStyle={{
              background: '#09090b',
              border: '1px solid #27272a',
            }}
          />
          <Bar dataKey="calls" fill="#0891b2" radius={[4, 4, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
