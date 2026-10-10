import { useState } from 'react';
import { Alert, Box, Chip, ToggleButton, ToggleButtonGroup, Typography } from '@mui/material';
import { Stack } from '../../components/layout.jsx';
import { api } from '../../api/client.js';
import { useGet, useSend } from '../../api/hooks.js';
import { AiNotice } from '../../components/AiPanel.jsx';
import { AiBadge, RuleBadge } from '../../components/badges.jsx';
import { PageHeader, SurfaceCard } from '../../components/cards.jsx';
import { ErrorState, LoadingState } from '../../components/feedback.jsx';

export default function StudentRoadmap() {
  const [weeks, setWeeks] = useState(8);
  const cached = useGet('/ai/roadmap', { weeks });
  const run = useSend((force) => api.post('/ai/roadmap', { weeks, force }), { invalidate: ['/ai/roadmap'] });
  const data = run.data?.weeks === weeks ? run.data : cached.data;

  return (
    <>
      <PageHeader title="Career roadmap" subtitle="A step-by-step plan built from your profile, interests and the skills open drives ask for." />
      <ToggleButtonGroup exclusive value={weeks} onChange={(_, v) => v && setWeeks(v)} sx={{ mb: 3 }} aria-label="Plan length">
        {[4, 8, 12].map((w) => <ToggleButton key={w} value={w}>{w} weeks</ToggleButton>)}
      </ToggleButtonGroup>

      {cached.isLoading && <LoadingState lines={5} />}
      {cached.isError && <ErrorState error={cached.error} onRetry={cached.refetch} />}
      {data && (
        <Stack spacing={3}>
          <SurfaceCard title="Skills to close first" subtitle="Must-have skills of open drives you are not ruled out of, most frequent first." action={<RuleBadge />}>
            {data.basedOnGaps.length === 0 ? (
              <Typography color="text.secondary">No skill gaps found across open drives. Add skills to your profile or wait for new drives.</Typography>
            ) : (
              <Stack direction="row" spacing={0.75} flexWrap="wrap" useFlexGap>
                {data.basedOnGaps.map((g) => <Chip key={g.skill} label={`${g.skill} · ${g.neededInDrives} drive${g.neededInDrives === 1 ? '' : 's'}`} />)}
              </Stack>
            )}
          </SurfaceCard>

          <SurfaceCard title={`${weeks}-week plan`} ai action={<AiBadge />}>
            <Stack spacing={2.5}>
              <AiNotice ai={run.data?.weeks === weeks ? run.data.ai : data.ai} onRun={() => run.mutate(data.ai.status === 'ok')} running={run.isPending} runLabel="Generate my roadmap" />
              {run.isError && <Alert severity="error">{run.error.message}</Alert>}
              {data.roadmap && (
                <>
                  <Typography>{data.roadmap.summary}</Typography>
                  {data.roadmap.phases.map((p, i) => (
                    <Box key={i} sx={{ borderLeft: '4px solid var(--tb-lilac)', pl: 2, bgcolor: '#fff', borderRadius: 2, py: 1.5, pr: 1.5 }}>
                      <Typography fontWeight={700}>{p.label}</Typography>
                      <Typography color="text.secondary" sx={{ mb: 1 }}>{p.focus}</Typography>
                      {p.goals.length > 0 && <><Typography variant="body2" fontWeight={600}>Goals</Typography><Stack component="ul" sx={{ m: 0, pl: 2.5, mb: 1 }}>{p.goals.map((g) => <li key={g}><Typography variant="body2">{g}</Typography></li>)}</Stack></>}
                      {p.tasks.length > 0 && <><Typography variant="body2" fontWeight={600}>Tasks</Typography><Stack component="ul" sx={{ m: 0, pl: 2.5 }}>{p.tasks.map((t) => <li key={t}><Typography variant="body2">{t}</Typography></li>)}</Stack></>}
                    </Box>
                  ))}
                </>
              )}
            </Stack>
          </SurfaceCard>
        </Stack>
      )}
    </>
  );
}
