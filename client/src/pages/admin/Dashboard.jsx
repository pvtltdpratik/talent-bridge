import { Alert, Button, Typography } from '@mui/material';
import { Stack } from '../../components/layout.jsx';
import PeopleIcon from '@mui/icons-material/People';
import AccountBalanceIcon from '@mui/icons-material/AccountBalance';
import BusinessIcon from '@mui/icons-material/Business';
import WorkIcon from '@mui/icons-material/Work';
import SendIcon from '@mui/icons-material/Send';
import HistoryIcon from '@mui/icons-material/History';
import { Link as RouterLink } from 'react-router-dom';
import { useGet } from '../../api/hooks.js';
import { PageHeader, StatCard, SurfaceCard } from '../../components/cards.jsx';
import { CHART_COLORS, SimpleBarChart } from '../../components/charts.jsx';
import { ErrorState, LoadingState } from '../../components/feedback.jsx';
import { titleCase } from '../../lib/format.js';

export default function AdminDashboard() {
  const q = useGet('/admin/metrics');
  if (q.isLoading) return <LoadingState lines={6} />;
  if (q.isError) return <ErrorState error={q.error} onRetry={q.refetch} />;
  const m = q.data;

  const count = (role, status) => m.users.filter((u) => (!role || u.role === role) && (!status || u.status === status)).reduce((a, u) => a + u.n, 0);
  const roles = ['student', 'placement_cell', 'admin'].map((r) => ({ role: titleCase(r), active: count(r, 'active'), other: count(r) - count(r, 'active') }));
  const ai = Object.values(
    m.aiUsageLast30Days.reduce((acc, r) => {
      acc[r.feature] ??= { feature: titleCase(r.feature), ok: 0, failed: 0 };
      acc[r.feature][r.status === 'ok' ? 'ok' : 'failed'] += r.n;
      return acc;
    }, {}),
  );

  return (
    <>
      <PageHeader title="Admin dashboard" subtitle="Platform health across every college." />
      {m.pendingPlacementCellApprovals > 0 && (
        <Alert severity="warning" sx={{ mb: 3 }} action={<Button color="inherit" size="small" component={RouterLink} to="/admin/approvals">Review</Button>}>
          {m.pendingPlacementCellApprovals} placement cell account{m.pendingPlacementCellApprovals === 1 ? '' : 's'} waiting for approval.
        </Alert>
      )}
      <div className="row g-3 mb-3">
        <div className="col-6 col-lg-4 col-xl-2"><StatCard label="Active users" value={count(null, 'active')} icon={<PeopleIcon />} /></div>
        <div className="col-6 col-lg-4 col-xl-2"><StatCard label="Colleges" value={m.colleges} icon={<AccountBalanceIcon />} tone="lilac" /></div>
        <div className="col-6 col-lg-4 col-xl-2"><StatCard label="Companies" value={m.companies} icon={<BusinessIcon />} tone="teal" /></div>
        <div className="col-6 col-lg-4 col-xl-2"><StatCard label="Open drives" value={m.drives.open ?? 0} icon={<WorkIcon />} tone="amber" /></div>
        <div className="col-6 col-lg-4 col-xl-2"><StatCard label="Applications" value={Object.values(m.applications).reduce((a, b) => a + b, 0)} icon={<SendIcon />} /></div>
        <div className="col-6 col-lg-4 col-xl-2"><StatCard label="Audit events (7d)" value={m.auditEventsLast7Days} icon={<HistoryIcon />} tone="red" /></div>
      </div>
      <div className="row g-3">
        <div className="col-12 col-lg-6">
          <SurfaceCard title="Users by role">
            <SimpleBarChart data={roles} xKey="role" label="Users by role" series={[{ key: 'active', label: 'Active', color: CHART_COLORS.teal }, { key: 'other', label: 'Pending / suspended / rejected', color: CHART_COLORS.amber }]} />
          </SurfaceCard>
        </div>
        <div className="col-12 col-lg-6">
          <SurfaceCard title="AI usage, last 30 days" subtitle="Calls that reached the model, by feature.">
            <SimpleBarChart data={ai} xKey="feature" label="AI calls by feature" series={[{ key: 'ok', label: 'Succeeded', color: CHART_COLORS.lilac }, { key: 'failed', label: 'Failed', color: CHART_COLORS.amber }]} emptyText="No AI calls yet (or AI is not configured)." />
          </SurfaceCard>
        </div>
      </div>
      <Stack direction="row" spacing={1.5} sx={{ mt: 3 }}>
        <Button variant="contained" component={RouterLink} to="/admin/users">Manage users</Button>
        <Button component={RouterLink} to="/admin/settings">System settings</Button>
        <Typography sx={{ alignSelf: 'center' }} color="text.secondary">AI features can be switched off in settings.</Typography>
      </Stack>
    </>
  );
}
