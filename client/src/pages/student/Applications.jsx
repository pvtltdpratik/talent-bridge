import { useState } from 'react';
import { Alert, Box, Button, Tab, Tabs, Typography } from '@mui/material';
import { Stack } from '../../components/layout.jsx';
import { Link as RouterLink } from 'react-router-dom';
import { api } from '../../api/client.js';
import { useGet, useSend } from '../../api/hooks.js';
import { ApplicationStatusBadge, ExceptionStatusBadge } from '../../components/badges.jsx';
import { PageHeader, SurfaceCard } from '../../components/cards.jsx';
import { ConfirmDialog } from '../../components/ConfirmDialog.jsx';
import { EmptyState, ErrorState, LoadingState } from '../../components/feedback.jsx';
import { fmtDate, fmtDateTime, titleCase } from '../../lib/format.js';

const WITHDRAWABLE = ['applied', 'under_review', 'shortlisted', 'interview_scheduled'];

function History({ id }) {
  const q = useGet(`/applications/${id}`);
  if (q.isLoading) return <LoadingState lines={2} height={20} />;
  if (q.isError) return <Typography color="error">{q.error.message}</Typography>;
  return (
    <Stack component="ol" spacing={0.75} sx={{ m: 0, pl: 2.5 }} aria-label="Status history">
      {q.data.history.map((h) => (
        <li key={h.id}>
          <Typography variant="body2">
            <strong>{titleCase(h.toStatus)}</strong> · {fmtDateTime(h.createdAt)}
            {h.changedByRole === 'student' ? ' · by you' : h.changedByName ? ` · by ${h.changedByRole === 'admin' ? 'administrator' : 'placement cell'}` : ''}
            {h.note ? ` — ${h.note}` : ''}
          </Typography>
        </li>
      ))}
    </Stack>
  );
}

export default function StudentApplications() {
  const [tab, setTab] = useState('applications');
  const [open, setOpen] = useState(null);
  const [withdraw, setWithdraw] = useState(null);
  const apps = useGet('/applications/mine');
  const exs = useGet('/exceptions/mine');
  const doWithdraw = useSend((id) => api.post(`/applications/${id}/withdraw`), {
    invalidate: ['/applications', '/drives', '/ai/'], success: 'Application withdrawn.', onSuccess: () => setWithdraw(null), onError: () => setWithdraw(null),
  });

  return (
    <>
      <PageHeader title="My applications" subtitle="Track every application and exception request." />
      <Tabs value={tab} onChange={(_, v) => setTab(v)} sx={{ mb: 3 }}>
        <Tab value="applications" label={`Applications${apps.data ? ` (${apps.data.length})` : ''}`} />
        <Tab value="exceptions" label={`Exception requests${exs.data ? ` (${exs.data.length})` : ''}`} />
      </Tabs>

      {tab === 'applications' && (
        <>
          {apps.isLoading && <LoadingState lines={4} height={80} />}
          {apps.isError && <ErrorState error={apps.error} onRetry={apps.refetch} />}
          {apps.data?.length === 0 && (
            <EmptyState title="No applications yet" description="Browse open drives and apply when you are eligible." action={<Button variant="contained" component={RouterLink} to="/student/drives">Browse drives</Button>} />
          )}
          <Stack spacing={2}>
            {apps.data?.map((a) => (
              <SurfaceCard key={a.id}>
                <Stack direction={{ xs: 'column', sm: 'row' }} justifyContent="space-between" spacing={1.5}>
                  <Box sx={{ minWidth: 0 }}>
                    <Typography variant="h6" component="h2">
                      <RouterLink to={`/student/drives/${a.driveId}`} style={{ color: 'inherit', textDecoration: 'none' }}>{a.driveTitle}</RouterLink>
                    </Typography>
                    <Typography color="text.secondary">{a.companyName} · applied {fmtDate(a.appliedAt)}{a.viaException ? ' · via approved exception' : ''}</Typography>
                  </Box>
                  <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
                    <ApplicationStatusBadge value={a.status} />
                    <Button size="small" onClick={() => setOpen(open === a.id ? null : a.id)} aria-expanded={open === a.id}>{open === a.id ? 'Hide history' : 'History'}</Button>
                    {WITHDRAWABLE.includes(a.status) && <Button size="small" color="error" onClick={() => setWithdraw(a)}>Withdraw</Button>}
                  </Stack>
                </Stack>
                {open === a.id && <Box sx={{ mt: 2 }}><History id={a.id} /></Box>}
              </SurfaceCard>
            ))}
          </Stack>
        </>
      )}

      {tab === 'exceptions' && (
        <>
          {exs.isLoading && <LoadingState lines={3} height={80} />}
          {exs.isError && <ErrorState error={exs.error} onRetry={exs.refetch} />}
          {exs.data?.length === 0 && <EmptyState title="No exception requests" description="If a drive's rules rule you out, you can ask the placement cell to consider you from the drive page." />}
          <Stack spacing={2}>
            {exs.data?.map((e) => (
              <SurfaceCard key={e.id}>
                <Stack direction="row" justifyContent="space-between" spacing={1}>
                  <Box>
                    <Typography variant="h6" component="h2"><RouterLink to={`/student/drives/${e.driveId}`} style={{ color: 'inherit', textDecoration: 'none' }}>{e.driveTitle}</RouterLink></Typography>
                    <Typography color="text.secondary">{e.companyName} · requested {fmtDate(e.createdAt)}</Typography>
                  </Box>
                  <ExceptionStatusBadge value={e.status} />
                </Stack>
                <Typography variant="body2" sx={{ mt: 1.5 }}><strong>Your reason:</strong> {e.reason}</Typography>
                {e.decisionNote && <Alert severity={e.status === 'approved' ? 'success' : 'info'} sx={{ mt: 1.5 }}>{e.decisionNote}</Alert>}
              </SurfaceCard>
            ))}
          </Stack>
        </>
      )}

      <ConfirmDialog
        open={!!withdraw} title="Withdraw this application?" message={withdraw ? `Your application to ${withdraw.driveTitle} will be withdrawn. You can re-apply before the deadline.` : ''}
        confirmLabel="Withdraw" danger loading={doWithdraw.isPending} onClose={() => setWithdraw(null)} onConfirm={() => doWithdraw.mutate(withdraw.id)}
      />
    </>
  );
}
