import { useState } from 'react';
import { InputAdornment, MenuItem, TextField } from '@mui/material';
import { Stack } from '../../components/layout.jsx';
import SearchIcon from '@mui/icons-material/Search';
import { Link as RouterLink } from 'react-router-dom';
import { useGet } from '../../api/hooks.js';
import { ApplicationStatusBadge, EligibilityBadge, Pill, VerificationBadge } from '../../components/badges.jsx';
import { PageHeader } from '../../components/cards.jsx';
import { DataTable } from '../../components/DataTable.jsx';
import { ErrorState } from '../../components/feedback.jsx';
import { useScope } from '../../layouts/AppShell.jsx';
import { fmtDate, titleCase } from '../../lib/format.js';

const STATUSES = ['applied', 'under_review', 'shortlisted', 'interview_scheduled', 'selected', 'rejected', 'withdrawn'];

export default function PlacementApplications() {
  const { scopeParams } = useScope();
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);
  const list = useGet('/applications', { ...scopeParams, q: q || undefined, status: status || undefined, page, pageSize: 20 });

  return (
    <>
      <PageHeader title="Applications" subtitle="Across all drives. Open a drive to move candidates through the pipeline." />
      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} sx={{ mb: 3 }}>
        <TextField value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} placeholder="Search student name or roll number"
          slotProps={{ input: { startAdornment: <InputAdornment position="start"><SearchIcon /></InputAdornment> }, htmlInput: { 'aria-label': 'Search applications' } }} />
        <TextField select label="Status" value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }} sx={{ minWidth: 200 }}>
          <MenuItem value="">All statuses</MenuItem>
          {STATUSES.map((s) => <MenuItem key={s} value={s}>{titleCase(s)}</MenuItem>)}
        </TextField>
      </Stack>
      {list.isError && <ErrorState error={list.error} onRetry={list.refetch} />}
      <DataTable
        caption="Applications" loading={list.isLoading} rows={list.data?.items ?? []} page={page} pageSize={20} total={list.data?.total} onPageChange={setPage}
        emptyTitle="No applications" emptyDescription="Applications appear here when students apply to your drives."
        columns={[
          { key: 'studentName', label: 'Student', sortable: true, render: (r) => <RouterLink to={`/placement/students/${r.studentId}`}>{r.studentName}</RouterLink> },
          { key: 'driveTitle', label: 'Drive', render: (r) => <RouterLink to={`/placement/drives/${r.driveId}`}>{r.driveTitle}</RouterLink> },
          { key: 'companyName', label: 'Company', sortable: true },
          { key: 'department', label: 'Dept.' },
          { key: 'cgpa', label: 'CGPA', align: 'right', sortable: true },
          { key: 'verificationStatus', label: 'Profile', render: (r) => <VerificationBadge value={r.verificationStatus} /> },
          { key: 'eligibility', label: 'Eligibility at apply', render: (r) => (<Stack direction="row" spacing={0.5}><EligibilityBadge value={r.eligibilitySnapshot?.status} />{r.viaException && <Pill tone="warning">Exception</Pill>}</Stack>) },
          { key: 'status', label: 'Status', render: (r) => <ApplicationStatusBadge value={r.status} /> },
          { key: 'appliedAt', label: 'Applied', sortable: true, render: (r) => fmtDate(r.appliedAt) },
        ]}
      />
    </>
  );
}
