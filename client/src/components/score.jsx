import { Box, Chip, LinearProgress, Typography } from '@mui/material';
import { Stack } from './layout.jsx';
import { SourceBadge } from './badges.jsx';
import { colors } from '../theme/tokens.js';

const toneFor = (v) => (v >= 70 ? colors.teal : v >= 45 ? colors.indigo : colors.amber);

/** Circular score. Exposes its value as text, not just as an arc. */
export function ScoreRing({ value, size = 120, label = 'Score', ai = false }) {
  const stroke = 10;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const has = value != null;
  const pct = has ? Math.max(0, Math.min(100, value)) : 0;
  return (
    <Box
      role="img"
      aria-label={has ? `${label}: ${Math.round(pct)} out of 100` : `${label}: not available yet`}
      sx={{ position: 'relative', width: size, height: size, flexShrink: 0 }}
    >
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={colors.grey100} strokeWidth={stroke} />
        {has && (
          <circle
            cx={size / 2}
            cy={size / 2}
            r={r}
            fill="none"
            stroke={ai ? colors.lilac : toneFor(pct)}
            strokeWidth={stroke}
            strokeLinecap="round"
            strokeDasharray={c}
            strokeDashoffset={c - (c * pct) / 100}
            transform={`rotate(-90 ${size / 2} ${size / 2})`}
          />
        )}
      </svg>
      <Box sx={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', textAlign: 'center' }}>
        <Box>
          <Typography variant="h4" component="span" sx={{ fontSize: size / 3.2, lineHeight: 1 }}>
            {has ? Math.round(pct) : '—'}
          </Typography>
          <Typography variant="caption" color="text.secondary" display="block">
            / 100
          </Typography>
        </Box>
      </Box>
    </Box>
  );
}

/**
 * Explainable score: total, component scores, configured weight, effective (re-normalised) weight,
 * evidence and reason, with rule-based vs AI markers. Unavailable components say why.
 */
export function ScoreBreakdown({ result, totalLabel = 'Total score' }) {
  if (!result) return null;
  return (
    <Box>
      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={3} alignItems={{ sm: 'center' }} sx={{ mb: 2 }}>
        <ScoreRing value={result.total} label={totalLabel} />
        <Box>
          <Typography variant="h6" component="p">
            {result.total == null ? 'Not enough data yet' : `${Math.round(result.total)} out of 100`}
          </Typography>
          <Typography color="text.secondary">{result.note}</Typography>
        </Box>
      </Stack>
      <Stack spacing={2} component="ul" sx={{ listStyle: 'none', p: 0, m: 0 }}>
        {result.components.map((c) => (
          <Box component="li" key={c.key} sx={{ borderTop: `1px solid ${colors.border}`, pt: 2, opacity: c.available ? 1 : 0.9 }}>
            <Stack direction="row" justifyContent="space-between" alignItems="center" spacing={1} flexWrap="wrap" useFlexGap>
              <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
                <Typography fontWeight={600}>{c.label}</Typography>
                <SourceBadge source={c.source} />
                {!c.available && <Chip size="small" label="Not counted" variant="outlined" />}
              </Stack>
              <Typography variant="body2" color="text.secondary">
                {c.available
                  ? `${Math.round(c.score)}/100 · weight ${c.weight}${c.effectiveWeight !== c.weight ? ` (counts as ${c.effectiveWeight}%)` : ''}`
                  : `weight ${c.weight} (excluded)`}
              </Typography>
            </Stack>
            {c.available && (
              <LinearProgress
                variant="determinate"
                value={c.score}
                aria-label={`${c.label} score`}
                sx={{
                  my: 1,
                  height: 8,
                  borderRadius: 4,
                  bgcolor: colors.grey100,
                  '& .MuiLinearProgress-bar': { bgcolor: c.source === 'ai' ? colors.lilac : toneFor(c.score), borderRadius: 4 },
                }}
              />
            )}
            <Typography variant="body2" sx={{ mt: c.available ? 0 : 0.5 }}>
              {c.reason}
            </Typography>
            {c.evidence?.length > 0 && (
              <Typography variant="caption" color="text.secondary" component="p" sx={{ mt: 0.5 }}>
                Evidence: {c.evidence.filter(Boolean).join(' · ')}
              </Typography>
            )}
          </Box>
        ))}
      </Stack>
    </Box>
  );
}

export function SkillChips({ matched = [], missing = [] }) {
  const name = (s) => (typeof s === 'string' ? s : s.skill);
  const importance = (s) => (typeof s === 'string' ? null : s.importance);
  return (
    <Stack spacing={1.5}>
      <Box>
        <Typography variant="body2" fontWeight={600} sx={{ mb: 0.5 }}>
          Skills you have
        </Typography>
        <Stack direction="row" spacing={0.75} flexWrap="wrap" useFlexGap>
          {matched.length ? matched.map((s) => <Chip key={name(s)} size="small" label={name(s)} sx={{ bgcolor: colors.tealTint, color: colors.successText }} />) : <Typography variant="body2" color="text.secondary">None matched yet</Typography>}
        </Stack>
      </Box>
      <Box>
        <Typography variant="body2" fontWeight={600} sx={{ mb: 0.5 }}>
          Skills to build
        </Typography>
        <Stack direction="row" spacing={0.75} flexWrap="wrap" useFlexGap>
          {missing.length ? (
            missing.map((s) => (
              <Chip
                key={name(s)}
                size="small"
                label={`${name(s)}${importance(s) === 'mandatory' ? ' · must-have' : importance(s) === 'preferred' ? ' · nice-to-have' : ''}`}
                sx={{ bgcolor: importance(s) === 'preferred' ? colors.grey100 : colors.amberTint, color: importance(s) === 'preferred' ? colors.textSecondary : colors.amberText }}
              />
            ))
          ) : (
            <Typography variant="body2" color="text.secondary">Nothing missing</Typography>
          )}
        </Stack>
      </Box>
    </Stack>
  );
}
