import { useState } from 'react';
import { Alert, Box, Button, Chip, Typography } from '@mui/material';
import { Stack } from '../../components/layout.jsx';
import { Link as RouterLink } from 'react-router-dom';
import { api } from '../../api/client.js';
import { useGet, useSend } from '../../api/hooks.js';
import { CriterionBadge, ExceptionStatusBadge } from '../../components/badges.jsx';
import { PageHeader, SurfaceCard } from '../../components/cards.jsx';
import { ConfirmDialog } from '../../components/ConfirmDialog.jsx';
import { EmptyState, ErrorState, LoadingState } from '../../components/feedback.jsx';
import { useScope } from '../../layouts/AppShell.jsx';
import { fmtDateTime } from '../../lib/format.js';

export default function PlacementExceptions() {
  const { scopeParams } = useScope();
  const [status, setStatus] = useState('pending');
  const [dialog, setDialog] = useState(null); // { item, decision }
  const list = useGet('/exceptions', { ...scopeParams, status: status || undefined, pageSize: 50 });
  const decide = useSend((v) => api.post(`/exceptions/${v.item.id}/decision`, { decision: v.decision, note: v.note || undefined }), {
    invalidate: ['/exceptions', '/analytics', '/notifications'], success: (d) => `Request ${d.status}. The student was notified.`,
    onSuccess: () => setDialog(null), onError: () => setDialog(null),
  });

  return (
    <>
      <PageHeader title="Exception requests" subtitle="Approval only unlocks applying. It never edits the student's eligibility result, and the deadline still applies." />
      <Stack direction="row" spacing={1} sx={{ mb: 3 }} role="group" aria-label="Status filter">
        {[['pending', 'Pending'], ['approved', 'Approved'], ['rejected', 'Rejected'], ['', 'All']].map(([v, l]) => (
          <Chip key={v} label={l} clickable color={status === v ? 'primary' : 'default'} onClick={() => setStatus(v)} />
        ))}
      </Stack>
      {list.isLoading && <LoadingState lines={4} height={110} />}
      {list.isError && <ErrorState error={list.error} onRetry={list.refetch} />}
      {list.data?.items.length === 0 && <EmptyState title="Nothing in this queue" description="Requests from ineligible students will appear here." />}
      <Stack spacing={2}>
        {list.data?.items.map((r) => (
          <SurfaceCard key={r.id}>
            <Stack direction={{ xs: 'column', md: 'row' }} justifyContent="space-between" spacing={2}>
              <Box sx={{ minWidth: 0 }}>
                <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
                  <Typography component={RouterLink} to={`/placement/students/${r.studentId}`} variant="h6" sx={{ color: 'inherit', textDecoration: 'none' }}>{r.studentName}</Typography>
                  <ExceptionStatusBadge value={r.status} />
                </Stack>
                <Typography color="text.secondary">
                  {r.department ?? '—'} · {r.rollNumber ?? '—'} · CGPA {r.cgpa ?? '—'} · for <RouterLink to={`/placement/drives/${r.driveId}`}>{r.driveTitle}</RouterLink> ({r.companyName}) · {fmtDateTime(r.createdAt)}
                </Typography>
                <Typography sx={{ mt: 1.5 }}><strong>Student's reason:</strong> {r.reason}</Typography>
                <Box sx={{ mt: 1.5 }}>
                  <Typography variant="body2" fontWeight={600}>Eligibility result when requested</Typography>
                  <Stack spacing={0.5} sx={{ mt: 0.5 }}>
                    {(r.eligibilitySnapshot?.criteria ?? []).filter((c) => c.state === 'fail' || c.state === 'unavailable').map((c) => (
                      <Stack key={c.key} direction="row" spacing={1} alignItems="center"><CriterionBadge value={c.state} /><Typography variant="body2">{c.reason}</Typography></Stack>
                    ))}
                  </Stack>
                </Box>
                {r.decisionNote && <Alert severity="info" sx={{ mt: 1.5 }}>Decision note: {r.decisionNote}</Alert>}
              </Box>
              {r.status === 'pending' && (
                <Stack direction={{ xs: 'row', md: 'column' }} spacing={1} sx={{ flexShrink: 0 }}>
                  <Button variant="contained" onClick={() => setDialog({ item: r, decision: 'approved' })}>Approve</Button>
                  <Button variant="outlined" color="error" onClick={() => setDialog({ item: r, decision: 'rejected' })}>Reject</Button>
                </Stack>
              )}
            </Stack>
          </SurfaceCard>
        ))}
      </Stack>

      <ConfirmDialog
        open={!!dialog}
        title={dialog ? `${dialog.decision === 'approved' ? 'Approve' : 'Reject'} request from ${dialog.item.studentName}?` : ''}
        message={dialog?.decision === 'approved' ? 'The student will be able to apply before the deadline. This decision is recorded in the audit log.' : 'The student will see your note. This decision is recorded in the audit log.'}
        inputLabel={dialog?.decision === 'rejected' ? 'Reason for the student (required)' : 'Note (optional)'} inputRequired={dialog?.decision === 'rejected'}
        confirmLabel={dialog?.decision === 'approved' ? 'Approve' : 'Reject'} danger={dialog?.decision === 'rejected'} loading={decide.isPending}
        onClose={() => setDialog(null)} onConfirm={(note) => decide.mutate({ item: dialog.item, decision: dialog.decision, note })}
      />
    </>
  );
}
