import { useState } from 'react';
import { Chip, InputAdornment, MenuItem, TextField, Typography } from '@mui/material';
import { Stack } from '../../components/layout.jsx';
import SearchIcon from '@mui/icons-material/Search';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useGet } from '../../api/hooks.js';
import { VerificationBadge } from '../../components/badges.jsx';
import { PageHeader } from '../../components/cards.jsx';
import { DataTable } from '../../components/DataTable.jsx';
import { ErrorState } from '../../components/feedback.jsx';
import { useScope } from '../../layouts/AppShell.jsx';

const DEPARTMENTS = ['CSE', 'IT', 'ECE', 'EEE', 'Mechanical', 'Civil', 'AI & DS', 'Other'];

export default function PlacementStudents() {
  const { scopeParams } = useScope();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const [q, setQ] = useState('');
  const [department, setDepartment] = useState('');
  const [passingYear, setPassingYear] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const verification = params.get('verification') ?? '';

  const list = useGet('/students', { ...scopeParams, q: q || undefined, department: department || undefined, passingYear: passingYear || undefined, verification: verification || undefined, page, pageSize });

  const chips = [
    { value: '', label: 'All' },
    { value: 'unverified', label: 'Awaiting verification' },
    { value: 'needs_changes', label: 'Needs changes' },
    { value: 'verified', label: 'Verified' },
  ];

  return (
    <>
      <PageHeader title="Students" subtitle="Verify profiles, review resumes and check readiness." />
      <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap sx={{ mb: 2 }} role="group" aria-label="Verification filter">
        {chips.map((c) => (
          <Chip key={c.value} label={c.label} clickable color={verification === c.value ? 'primary' : 'default'} onClick={() => { setParams(c.value ? { verification: c.value } : {}); setPage(1); }} />
        ))}
      </Stack>
      <Stack direction={{ xs: 'column', md: 'row' }} spacing={2} sx={{ mb: 3 }}>
        <TextField
          value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} placeholder="Search name, email or roll number"
          slotProps={{ input: { startAdornment: <InputAdornment position="start"><SearchIcon /></InputAdornment> }, htmlInput: { 'aria-label': 'Search students' } }}
        />
        <TextField select label="Department" value={department} onChange={(e) => { setDepartment(e.target.value); setPage(1); }} sx={{ minWidth: 180 }}>
          <MenuItem value="">All departments</MenuItem>
          {DEPARTMENTS.map((d) => <MenuItem key={d} value={d}>{d}</MenuItem>)}
        </TextField>
        <TextField label="Batch (year)" value={passingYear} onChange={(e) => { setPassingYear(e.target.value.replace(/\D/g, '').slice(0, 4)); setPage(1); }} sx={{ minWidth: 140 }} />
      </Stack>

      {list.isError && <ErrorState error={list.error} onRetry={list.refetch} />}
      <DataTable
        caption="Students" loading={list.isLoading} rows={list.data?.items ?? []} getRowId={(r) => r.userId}
        page={page} pageSize={pageSize} total={list.data?.total} onPageChange={setPage} onPageSizeChange={(n) => { setPageSize(n); setPage(1); }}
        onRowClick={(r) => navigate(`/placement/students/${r.userId}`)}
        emptyTitle="No students match" emptyDescription="Try clearing a filter. Students appear here after they register."
        columns={[
          { key: 'fullName', label: 'Student', sortable: true, render: (r) => <><strong>{r.fullName}</strong><Typography variant="caption" display="block" color="text.secondary">{r.email}</Typography></> },
          { key: 'rollNumber', label: 'Roll no.', sortable: true },
          { key: 'department', label: 'Dept.', sortable: true },
          { key: 'passingYear', label: 'Batch', sortable: true },
          { key: 'cgpa', label: 'CGPA', sortable: true, align: 'right' },
          { key: 'activeBacklogs', label: 'Backlogs', align: 'right' },
          { key: 'hasResume', label: 'Resume', render: (r) => (r.hasResume ? 'Yes' : '—') },
          { key: 'verificationStatus', label: 'Verification', render: (r) => <VerificationBadge value={r.verificationStatus} /> },
        ]}
      />
    </>
  );
}
