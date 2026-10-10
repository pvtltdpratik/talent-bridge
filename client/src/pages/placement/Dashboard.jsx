import { Alert, Box, Button, Typography } from '@mui/material';
import { Stack } from '../../components/layout.jsx';
import GroupsIcon from '@mui/icons-material/Groups';
import VerifiedUserIcon from '@mui/icons-material/VerifiedUser';
import WorkIcon from '@mui/icons-material/Work';
import SendIcon from '@mui/icons-material/Send';
import GavelIcon from '@mui/icons-material/Gavel';
import EventIcon from '@mui/icons-material/Event';
import { Link as RouterLink, useNavigate } from 'react-router-dom';
import { useGet } from '../../api/hooks.js';
import { PageHeader, StatCard, SurfaceCard } from '../../components/cards.jsx';
import { CHART_COLORS, SimpleBarChart, SimpleLineChart } from '../../components/charts.jsx';
import { DataTable } from '../../components/DataTable.jsx';
import { ErrorState, LoadingState } from '../../components/feedback.jsx';
import { DriveStatusBadge } from '../../components/badges.jsx';
import { useScope } from '../../layouts/AppShell.jsx';
import { fmtDate, relativeDeadline } from '../../lib/format.js';

export default function PlacementDashboard() {
  const { scopeParams } = useScope();
  const navigate = useNavigate();
  const q = useGet('/analytics/overview', scopeParams);

  if (q.isLoading) return <LoadingState lines={8} />;
  if (q.isError) return <ErrorState error={q.error} onRetry={q.refetch} />;
  const o = q.data;
  const v = o.students.byVerification;
  const unverified = (v.unverified ?? 0) + (v.needs_changes ?? 0);

  return (
    <>
      <PageHeader title="Placement dashboard" subtitle="Live numbers from your students, drives and applications." actions={<Button variant="contained" component={RouterLink} to="/placement/drives/new">New drive</Button>} />

      {!o.hasData && (
        <Alert severity="info" sx={{ mb: 3 }}>
          No students have registered for this college yet, so there is nothing to chart. Charts and insights fill in as real data arrives.
        </Alert>
      )}

      <div className="row g-3 mb-3">
        <div className="col-6 col-lg-4 col-xl-2"><StatCard label="Students" value={o.students.total} icon={<GroupsIcon />} /></div>
        <div className="col-6 col-lg-4 col-xl-2"><StatCard label="Awaiting verification" value={unverified} icon={<VerifiedUserIcon />} tone="amber" hint={`${v.verified ?? 0} verified`} /></div>
        <div className="col-6 col-lg-4 col-xl-2"><StatCard label="Open drives" value={o.drives.byStatus.open ?? 0} icon={<WorkIcon />} tone="teal" /></div>
        <div className="col-6 col-lg-4 col-xl-2"><StatCard label="Applications" value={o.applications.total} icon={<SendIcon />} tone="lilac" /></div>
        <div className="col-6 col-lg-4 col-xl-2"><StatCard label="Pending exceptions" value={o.exceptions.byStatus.pending ?? 0} icon={<GavelIcon />} tone="red" /></div>
        <div className="col-6 col-lg-4 col-xl-2"><StatCard label="Upcoming interviews" value={o.upcomingInterviews} icon={<EventIcon />} tone="indigo" /></div>
      </div>

      <div className="row g-3">
        <div className="col-12 col-xl-7">
          <SurfaceCard title="Applications per month" subtitle="Last six months">
            <SimpleLineChart
              data={o.monthlyTrend} xKey="month" label="Applications and selections per month"
              series={[{ key: 'applications', label: 'Applications', color: CHART_COLORS.indigo }, { key: 'selected', label: 'Selected', color: CHART_COLORS.teal }]}
              emptyText="No applications in the last six months."
            />
          </SurfaceCard>
        </div>
        <div className="col-12 col-xl-5">
          <SurfaceCard title="Department participation" subtitle="Students, those who applied, and those selected">
            <SimpleBarChart
              data={o.departments} xKey="department" label="Participation by department"
              series={[{ key: 'students', label: 'Students', color: CHART_COLORS.indigo }, { key: 'applicants', label: 'Applied', color: CHART_COLORS.lilac }, { key: 'selected', label: 'Selected', color: CHART_COLORS.teal }]}
              emptyText="No student data yet."
            />
          </SurfaceCard>
        </div>

        <div className="col-12 col-xl-7">
          <SurfaceCard title="Drives by interest" action={<Button size="small" component={RouterLink} to="/placement/drives">All drives</Button>}>
            <DataTable
              dense caption="Top drives" rows={o.topDrives} onRowClick={(r) => navigate(`/placement/drives/${r.id}`)}
              emptyTitle="No drives yet" emptyDescription="Create a drive to start receiving applications."
              columns={[
                { key: 'title', label: 'Drive', render: (r) => <><strong>{r.title}</strong><Typography variant="caption" display="block" color="text.secondary">{r.company}</Typography></> },
                { key: 'status', label: 'Status', render: (r) => <DriveStatusBadge value={r.status} /> },
                { key: 'applications', label: 'Applied', align: 'right', sortable: true },
                { key: 'shortlisted', label: 'Shortlisted', align: 'right', sortable: true },
                { key: 'selected', label: 'Selected', align: 'right', sortable: true },
              ]}
            />
          </SurfaceCard>
        </div>
        <div className="col-12 col-xl-5">
          <Stack spacing={3}>
            <SurfaceCard title="Needs your attention">
              <Stack spacing={1.25}>
                <Box><Button component={RouterLink} to="/placement/students?verification=unverified">{unverified} profile{unverified === 1 ? '' : 's'} to verify</Button></Box>
                <Box><Button component={RouterLink} to="/placement/exceptions">{o.exceptions.byStatus.pending ?? 0} exception request{(o.exceptions.byStatus.pending ?? 0) === 1 ? '' : 's'} pending</Button></Box>
              </Stack>
            </SurfaceCard>
            <SurfaceCard title="Upcoming deadlines">
              {o.upcomingDeadlines.length === 0 ? (
                <Typography color="text.secondary">No open drives with upcoming deadlines.</Typography>
              ) : (
                <Stack spacing={1.25}>
                  {o.upcomingDeadlines.map((d) => (
                    <Stack key={d.id} direction="row" justifyContent="space-between" spacing={1}>
                      <Box sx={{ minWidth: 0 }}>
                        <Typography component={RouterLink} to={`/placement/drives/${d.id}`} fontWeight={600} sx={{ color: 'inherit', textDecoration: 'none' }}>{d.title}</Typography>
                        <Typography variant="body2" color="text.secondary">{d.company}</Typography>
                      </Box>
                      <Typography variant="body2" sx={{ textAlign: 'right' }}>{fmtDate(d.deadline)}<br /><span style={{ color: 'var(--tb-text-muted)' }}>{relativeDeadline(d.deadline)}</span></Typography>
                    </Stack>
                  ))}
                </Stack>
              )}
            </SurfaceCard>
          </Stack>
        </div>
      </div>
    </>
  );
}
