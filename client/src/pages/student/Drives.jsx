import { useState } from 'react';
import { Box, Button, Card, CardActionArea, CardContent, Chip, InputAdornment, MenuItem, TextField, Typography } from '@mui/material';
import { Stack } from '../../components/layout.jsx';
import SearchIcon from '@mui/icons-material/Search';
import { Link as RouterLink } from 'react-router-dom';
import { useGet } from '../../api/hooks.js';
import { ApplicationStatusBadge, DriveStatusBadge, EligibilityBadge, ExceptionStatusBadge } from '../../components/badges.jsx';
import { PageHeader } from '../../components/cards.jsx';
import { EmptyState, ErrorState, LoadingState } from '../../components/feedback.jsx';
import { fmtDate, fmtINR, relativeDeadline, titleCase } from '../../lib/format.js';
import { Pagination } from '@mui/material';

export default function StudentDrives() {
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('open');
  const [page, setPage] = useState(1);
  const drives = useGet('/drives', { q: q || undefined, status: status || undefined, page, pageSize: 12 });

  return (
    <>
      <PageHeader title="Placement drives" subtitle="Eligibility is decided by your college's rules; reasons are shown for every criterion." />
      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} sx={{ mb: 3 }}>
        <TextField
          value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} placeholder="Search by role or company"
          slotProps={{ input: { startAdornment: <InputAdornment position="start"><SearchIcon /></InputAdornment> }, htmlInput: { 'aria-label': 'Search drives' } }}
        />
        <TextField select label="Status" value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }} sx={{ minWidth: 180 }}>
          <MenuItem value="">All</MenuItem>
          <MenuItem value="open">Open</MenuItem>
          <MenuItem value="closed">Closed</MenuItem>
          <MenuItem value="completed">Completed</MenuItem>
        </TextField>
      </Stack>

      {drives.isLoading && <LoadingState lines={5} height={96} />}
      {drives.isError && <ErrorState error={drives.error} onRetry={drives.refetch} />}
      {drives.data?.items.length === 0 && <EmptyState title="No drives found" description="Try a different filter. New drives from your placement cell will appear here." />}

      <div className="row g-3">
        {drives.data?.items.map((d) => (
          <div className="col-12 col-md-6 col-xl-4" key={d.id}>
            <Card sx={{ height: '100%' }}>
              <CardActionArea component={RouterLink} to={`/student/drives/${d.id}`} sx={{ height: '100%' }}>
                <CardContent>
                  <Stack direction="row" justifyContent="space-between" alignItems="flex-start" spacing={1}>
                    <Box sx={{ minWidth: 0 }}>
                      <Typography variant="h6" component="h2" sx={{ overflowWrap: 'anywhere' }}>{d.title}</Typography>
                      <Typography color="text.secondary">{d.companyName}</Typography>
                    </Box>
                    <DriveStatusBadge value={d.status} />
                  </Stack>
                  <Stack direction="row" spacing={0.75} flexWrap="wrap" useFlexGap sx={{ my: 1.5 }}>
                    <Chip size="small" label={titleCase(d.jobType)} variant="outlined" />
                    {d.packageLpa != null && <Chip size="small" label={`${d.packageLpa} LPA`} variant="outlined" />}
                    {d.stipendPerMonth != null && <Chip size="small" label={`${fmtINR(d.stipendPerMonth)}/mo`} variant="outlined" />}
                    {d.location && <Chip size="small" label={d.location} variant="outlined" />}
                  </Stack>
                  <Typography variant="body2" color="text.secondary">Deadline {fmtDate(d.deadline)} · {relativeDeadline(d.deadline)}</Typography>
                  <Stack direction="row" spacing={0.75} flexWrap="wrap" useFlexGap sx={{ mt: 1.5 }}>
                    <EligibilityBadge value={d.eligibilityResult.status} />
                    {d.application && <ApplicationStatusBadge value={d.application.status} />}
                    {!d.application && d.exception && <ExceptionStatusBadge value={d.exception.status} title="Exception request" />}
                  </Stack>
                </CardContent>
              </CardActionArea>
            </Card>
          </div>
        ))}
      </div>
      {drives.data && drives.data.totalPages > 1 && (
        <Stack alignItems="center" sx={{ mt: 3 }}>
          <Pagination count={drives.data.totalPages} page={page} onChange={(_, p) => setPage(p)} />
        </Stack>
      )}
      <Box sx={{ mt: 3 }}><Button component={RouterLink} to="/student/applications">View my applications</Button></Box>
    </>
  );
}
