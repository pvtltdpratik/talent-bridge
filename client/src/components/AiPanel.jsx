import { Alert, Button, Typography } from '@mui/material';
import { Stack } from './layout.jsx';
import AutoAwesomeIcon from '@mui/icons-material/AutoAwesome';
import ReplayIcon from '@mui/icons-material/Replay';
import { fmtDateTime } from '../lib/format.js';

/**
 * Standard presentation of an AI result's state.
 * `ai` is the envelope from the API: { status: 'ok'|'unavailable'|'none', reason?, message?, cached?, stale?, generatedAt? }
 * Rule-based content elsewhere on the page keeps working when this shows "unavailable".
 */
export function AiNotice({ ai, onRun, running = false, runLabel = 'Generate with AI', rerunLabel = 'Re-run' }) {
  if (!ai) return null;

  if (ai.status === 'unavailable') {
    const retryable = !['disabled', 'not_configured', 'insufficient_data'].includes(ai.reason);
    return (
      <Alert severity="warning" variant="outlined" icon={<AutoAwesomeIcon />} sx={{ borderColor: 'var(--tb-lilac)' }}
        action={onRun && retryable ? <Button color="inherit" size="small" startIcon={<ReplayIcon />} onClick={onRun} disabled={running}>Try again</Button> : undefined}>
        <strong>AI is unavailable right now.</strong> {ai.message} The rule-based results on this page are still accurate.
      </Alert>
    );
  }

  if (ai.status === 'none') {
    return onRun ? (
      <Stack direction="row" spacing={2} alignItems="center" flexWrap="wrap" useFlexGap>
        <Button variant="contained" color="secondary" startIcon={<AutoAwesomeIcon />} onClick={onRun} disabled={running}>
          {running ? 'Working…' : runLabel}
        </Button>
        <Typography variant="body2" color="text.secondary">
          Not generated yet. Results are saved, so the same inputs are never re-analysed.
        </Typography>
      </Stack>
    ) : null;
  }

  return (
    <Stack direction="row" spacing={1.5} alignItems="center" flexWrap="wrap" useFlexGap>
      <Typography variant="caption" color="text.secondary">
        AI-generated {ai.generatedAt ? fmtDateTime(ai.generatedAt) : ''}
        {ai.cached ? ' · saved result' : ''}
      </Typography>
      {ai.stale && (
        <Typography variant="caption" sx={{ color: 'var(--tb-amber)' }}>
          Based on older information. Re-run to refresh.
        </Typography>
      )}
      {onRun && (
        <Button size="small" startIcon={<ReplayIcon />} onClick={onRun} disabled={running}>
          {running ? 'Working…' : rerunLabel}
        </Button>
      )}
    </Stack>
  );
}
