import { useState } from 'react';
import { Chip } from '@mui/material';
import { Stack } from '../../components/layout.jsx';
import { Link as RouterLink } from 'react-router-dom';
import { api } from '../../api/client.js';
import { useGet, useSend } from '../../api/hooks.js';
import { PageHeader } from '../../components/cards.jsx';
import { DataTable } from '../../components/DataTable.jsx';
import { ErrorState } from '../../components/feedback.jsx';
import { useScope } from '../../layouts/AppShell.jsx';
import { fmtDateTime, titleCase } from '../../lib/format.js';
import { Button } from '@mui/material';

export default function PlacementInterviews() {
  const { scopeParams } = useScope();
  const [upcoming, setUpcoming] = useState(true);
  const [page, setPage] = useState(1);
  const list = useGet('/interviews', { ...scopeParams, upcoming: upcoming ? 'true' : 'false', page, pageSize: 20 });
  const update = useSend((v) => api.patch(`/interviews/${v.id}`, { status: v.status }), { invalidate: ['/interviews', '/analytics'], success: 'Interview updated.' });

  return (
    <>
      <PageHeader title="Interviews" subtitle="Schedule interviews from a drive's pipeline once a candidate is shortlisted." />
      <Stack direction="row" spacing={1} sx={{ mb: 3 }} role="group" aria-label="Time filter">
        <Chip label="Upcoming" clickable color={upcoming ? 'primary' : 'default'} onClick={() => { setUpcoming(true); setPage(1); }} />
        <Chip label="All" clickable color={!upcoming ? 'primary' : 'default'} onClick={() => { setUpcoming(false); setPage(1); }} />
      </Stack>
      {list.isError && <ErrorState error={list.error} onRetry={list.refetch} />}
      <DataTable
        caption="Interviews" loading={list.isLoading} rows={list.data?.items ?? []} page={page} pageSize={20} total={list.data?.total} onPageChange={setPage}
        emptyTitle="No interviews" emptyDescription="Shortlist a candidate in a drive pipeline, then schedule their interview."
        columns={[
          { key: 'scheduledAt', label: 'When (IST)', sortable: true, render: (r) => fmtDateTime(r.scheduledAt) },
          { key: 'studentName', label: 'Student', render: (r) => <RouterLink to={`/placement/students/${r.studentId}`}>{r.studentName}</RouterLink> },
          { key: 'driveTitle', label: 'Drive', render: (r) => <RouterLink to={`/placement/drives/${r.driveId}`}>{r.driveTitle}</RouterLink> },
          { key: 'roundName', label: 'Round' },
          { key: 'mode', label: 'Mode', render: (r) => titleCase(r.mode) },
          { key: 'status', label: 'Status', render: (r) => <Chip size="small" label={titleCase(r.status)} /> },
          {
            key: 'actions', label: '', align: 'right',
            render: (r) => r.status === 'scheduled' && (
              <Stack direction="row" spacing={0.5} justifyContent="flex-end">
                <Button size="small" onClick={() => update.mutate({ id: r.id, status: 'completed' })}>Mark done</Button>
                <Button size="small" color="error" onClick={() => update.mutate({ id: r.id, status: 'cancelled' })}>Cancel</Button>
              </Stack>
            ),
          },
        ]}
      />
    </>
  );
}
