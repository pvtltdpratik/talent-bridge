import { useState } from 'react';
import { Alert, Button, FormControlLabel, Switch, TextField, Typography } from '@mui/material';
import { Stack } from '../../components/layout.jsx';
import { api } from '../../api/client.js';
import { useGet, useSend } from '../../api/hooks.js';
import { PageHeader, SurfaceCard } from '../../components/cards.jsx';
import { ErrorState, LoadingState } from '../../components/feedback.jsx';
import { titleCase } from '../../lib/format.js';

function WeightEditor({ title, subtitle, value, onChange }) {
  const total = Object.values(value).reduce((a, b) => a + (Number(b) || 0), 0);
  return (
    <SurfaceCard title={title} subtitle={subtitle}>
      <div className="row g-3">
        {Object.entries(value).map(([k, v]) => (
          <div className="col-6 col-md-4" key={k}>
            <TextField
              label={titleCase(k)} type="number" value={v} onChange={(e) => onChange({ ...value, [k]: e.target.value === '' ? 0 : Number(e.target.value) })}
              slotProps={{ htmlInput: { min: 0, max: 100, step: 1 } }}
            />
          </div>
        ))}
      </div>
      <Typography variant="body2" color="text.secondary" sx={{ mt: 2 }}>
        Total {total}. Weights are relative: when a component has no data it is dropped and the rest are re-normalised, so they do not need to add up to 100.
      </Typography>
    </SurfaceCard>
  );
}

export default function AdminSettings() {
  const q = useGet('/admin/settings');
  const [draft, setForm] = useState(null);
  const form = draft ?? q.data?.settings;
  const save = useSend((body) => api.put('/admin/settings', body), { invalidate: ['/admin/settings', '/ai/'], success: 'Settings saved and recorded in the audit log.', onSuccess: () => setForm(null) });

  if (q.isLoading || !form) return <LoadingState lines={6} />;
  if (q.isError) return <ErrorState error={q.error} onRetry={q.refetch} />;
  const defaults = q.data.defaults;

  return (
    <>
      <PageHeader
        title="System settings" subtitle="Changes apply platform-wide and are audited."
        actions={<><Button color="inherit" onClick={() => setForm(defaults)}>Restore defaults</Button><Button variant="contained" onClick={() => save.mutate(form)} disabled={save.isPending}>Save settings</Button></>}
      />
      <Stack spacing={3}>
        {save.isError && <Alert severity="error">{save.error.message}</Alert>}
        <WeightEditor title="Placement readiness weights" subtitle="How much each component counts toward a student's readiness score." value={form.readiness_weights} onChange={(v) => setForm({ ...form, readiness_weights: v })} />
        <WeightEditor title="Job match weights" subtitle="How a student-vs-drive match score is composed." value={form.match_weights} onChange={(v) => setForm({ ...form, match_weights: v })} />
        <SurfaceCard title="Uploads & invitations">
          <div className="row g-3">
            <div className="col-12 col-md-6"><TextField label="Max resume size (MB)" type="number" value={form.upload_max_mb} onChange={(e) => setForm({ ...form, upload_max_mb: Number(e.target.value) })} slotProps={{ htmlInput: { min: 1, max: 25 } }} /></div>
            <div className="col-12 col-md-6"><TextField label="Invitation validity (days)" type="number" value={form.invite_expiry_days} onChange={(e) => setForm({ ...form, invite_expiry_days: Number(e.target.value) })} slotProps={{ htmlInput: { min: 1, max: 30 } }} /></div>
          </div>
        </SurfaceCard>
        <SurfaceCard title="AI features" subtitle="Switch AI off to fall back to rule-based features only.">
          <Stack spacing={2}>
            <FormControlLabel control={<Switch checked={!!form.ai_enabled} onChange={(e) => setForm({ ...form, ai_enabled: e.target.checked })} />} label={form.ai_enabled ? 'AI features are on' : 'AI features are off'} />
            <TextField label="Per-user AI calls per hour" type="number" value={form.ai_user_hourly_limit} onChange={(e) => setForm({ ...form, ai_user_hourly_limit: Number(e.target.value) })} slotProps={{ htmlInput: { min: 1, max: 500 } }} sx={{ maxWidth: 320 }} />
            <Typography variant="body2" color="text.secondary">The API key and model name are server environment variables and cannot be viewed or changed here.</Typography>
          </Stack>
        </SurfaceCard>
      </Stack>
    </>
  );
}
