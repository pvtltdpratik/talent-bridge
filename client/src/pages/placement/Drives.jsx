import { useState } from 'react';
import { Button, InputAdornment, MenuItem, TextField } from '@mui/material';
import { Stack } from '../../components/layout.jsx';
import AddIcon from '@mui/icons-material/Add';
import SearchIcon from '@mui/icons-material/Search';
import { Link as RouterLink, useNavigate } from 'react-router-dom';
import { useGet } from '../../api/hooks.js';
import { DriveStatusBadge } from '../../components/badges.jsx';
import { PageHeader } from '../../components/cards.jsx';
import { DataTable } from '../../components/DataTable.jsx';
import { ErrorState } from '../../components/feedback.jsx';
import { useScope } from '../../layouts/AppShell.jsx';
import { fmtDate, titleCase } from '../../lib/format.js';

export default function PlacementDrives() {
  const { scopeParams } = useScope();
  const navigate = useNavigate();
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);
  const list = useGet('/drives', { ...scopeParams, q: q || undefined, status: status || undefined, page, pageSize: 20 });

  return (
    <>
      <PageHeader title="Drives" subtitle="Create drives, set eligibility and manage the hiring pipeline." actions={<Button variant="contained" startIcon={<AddIcon />} component={RouterLink} to="/placement/drives/new">New drive</Button>} />
      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} sx={{ mb: 3 }}>
        <TextField value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} placeholder="Search by role or company"
          slotProps={{ input: { startAdornment: <InputAdornment position="start"><SearchIcon /></InputAdornment> }, htmlInput: { 'aria-label': 'Search drives' } }} />
        <TextField select label="Status" value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }} sx={{ minWidth: 180 }}>
          <MenuItem value="">All</MenuItem>
          {['draft', 'open', 'closed', 'completed', 'cancelled'].map((s) => <MenuItem key={s} value={s}>{titleCase(s)}</MenuItem>)}
        </TextField>
      </Stack>
      {list.isError && <ErrorState error={list.error} onRetry={list.refetch} />}
      <DataTable
        caption="Drives" loading={list.isLoading} rows={list.data?.items ?? []} page={page} pageSize={20} total={list.data?.total} onPageChange={setPage}
        onRowClick={(r) => navigate(`/placement/drives/${r.id}`)} emptyTitle="No drives yet" emptyDescription="Create your first drive to start accepting applications."
        emptyAction={<Button variant="contained" component={RouterLink} to="/placement/drives/new">New drive</Button>}
        columns={[
          { key: 'title', label: 'Drive', sortable: true, render: (r) => <strong>{r.title}</strong> },
          { key: 'companyName', label: 'Company', sortable: true },
          { key: 'jobType', label: 'Type', render: (r) => titleCase(r.jobType) },
          { key: 'status', label: 'Status', render: (r) => <DriveStatusBadge value={r.status} /> },
          { key: 'deadline', label: 'Deadline', sortable: true, render: (r) => fmtDate(r.deadline) },
          { key: 'applicationCount', label: 'Applicants', align: 'right', sortable: true },
        ]}
      />
    </>
  );
}
