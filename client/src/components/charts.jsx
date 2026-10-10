import { Box, Typography } from '@mui/material';
import { Bar, BarChart, CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { colors } from '../theme/tokens.js';

const AXIS = { fontSize: 12, fill: colors.textSecondary };

function Empty({ text }) {
  return (
    <Box sx={{ py: 5, textAlign: 'center' }}>
      <Typography color="text.secondary">{text}</Typography>
    </Box>
  );
}

/** Charts only render real data. With none, they say so instead of drawing placeholders. */
export function SimpleBarChart({ data, xKey, series, height = 280, emptyText = 'No data yet.', label }) {
  if (!data?.length) return <Empty text={emptyText} />;
  return (
    <Box role="img" aria-label={label} sx={{ width: '100%', height }}>
      <ResponsiveContainer>
        <BarChart data={data} margin={{ top: 8, right: 8, left: -12, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke={colors.border} vertical={false} />
          <XAxis dataKey={xKey} tick={AXIS} tickLine={false} />
          <YAxis allowDecimals={false} tick={AXIS} tickLine={false} axisLine={false} />
          <Tooltip cursor={{ fill: colors.grey100 }} />
          {series.length > 1 && <Legend />}
          {series.map((s) => (
            <Bar key={s.key} dataKey={s.key} name={s.label} fill={s.color} radius={[6, 6, 0, 0]} maxBarSize={44} />
          ))}
        </BarChart>
      </ResponsiveContainer>
    </Box>
  );
}

export function SimpleLineChart({ data, xKey, series, height = 280, emptyText = 'No data yet.', label }) {
  if (!data?.length) return <Empty text={emptyText} />;
  return (
    <Box role="img" aria-label={label} sx={{ width: '100%', height }}>
      <ResponsiveContainer>
        <LineChart data={data} margin={{ top: 8, right: 8, left: -12, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke={colors.border} vertical={false} />
          <XAxis dataKey={xKey} tick={AXIS} tickLine={false} />
          <YAxis allowDecimals={false} tick={AXIS} tickLine={false} axisLine={false} />
          <Tooltip />
          {series.length > 1 && <Legend />}
          {series.map((s) => (
            <Line key={s.key} type="monotone" dataKey={s.key} name={s.label} stroke={s.color} strokeWidth={3} dot={{ r: 4 }} />
          ))}
        </LineChart>
      </ResponsiveContainer>
    </Box>
  );
}

export const CHART_COLORS = { indigo: colors.indigo, teal: colors.teal, lilac: colors.lilac, amber: '#D97706' };
