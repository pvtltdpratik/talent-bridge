import { useState } from 'react';
import { Box, IconButton, MenuItem, TextField, Typography } from '@mui/material';
import { Stack } from '../../components/layout.jsx';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import { useGet } from '../../api/hooks.js';
import { PageHeader } from '../../components/cards.jsx';
import { DataTable } from '../../components/DataTable.jsx';
import { ErrorState } from '../../components/feedback.jsx';
import { fmtDateTime } from '../../lib/format.js';

const ACTIONS = [
  'account.approved', 'account.rejected', 'account.suspended', 'account.reactivated', 'role.changed', 'admin.created',
  'invitation.created', 'invitation.accepted', 'invitation.revoked', 'profile.verified', 'profile.needs_changes',
  'profile.verification_reset', 'exception.approved', 'exception.rejected', 'application.status_changed',
  'drive.deadline_extended', 'drive.eligibility_changed', 'drive.status_changed', 'ranking.manual_order_set',
  'settings.updated', 'college.created', 'college.updated', 'account.deleted',
];

const Json = ({ value }) => (value == null ? <Typography variant="body2" color="text.secondary">—</Typography> : (
  <Box component="pre" sx={{ m: 0, p: 1.5, bgcolor: 'var(--tb-canvas)', borderRadius: 2, fontSize: 12, overflow: 'auto', maxHeight: 220 }}>{JSON.stringify(value, null, 2)}</Box>
));

export default function AdminAudit() {
  const [action, setAction] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [page, setPage] = useState(1);
  const [open, setOpen] = useState(null);
  const q = useGet('/admin/audit-logs', {
    action: action || undefined, from: from ? new Date(from).toISOString() : undefined,
    to: to ? new Date(`${to}T23:59:59`).toISOString() : undefined, page, pageSize: 25,
  });

  return (
    <>
      <PageHeader title="Audit log" subtitle="Who did what, to whom, and what changed. Entries cannot be edited." />
      <Stack direction={{ xs: 'column', md: 'row' }} spacing={2} sx={{ mb: 3 }}>
        <TextField select label="Action" value={action} onChange={(e) => { setAction(e.target.value); setPage(1); }} sx={{ minWidth: 280 }}>
          <MenuItem value="">All actions</MenuItem>
          {ACTIONS.map((a) => <MenuItem key={a} value={a}>{a}</MenuItem>)}
        </TextField>
        <TextField label="From" type="date" value={from} onChange={(e) => { setFrom(e.target.value); setPage(1); }} slotProps={{ inputLabel: { shrink: true } }} />
        <TextField label="To" type="date" value={to} onChange={(e) => { setTo(e.target.value); setPage(1); }} slotProps={{ inputLabel: { shrink: true } }} />
      </Stack>
      {q.isError && <ErrorState error={q.error} onRetry={q.refetch} />}
      <DataTable
        dense caption="Audit log" loading={q.isLoading} rows={q.data?.items ?? []} page={page} pageSize={25} total={q.data?.total} onPageChange={setPage}
        emptyTitle="No audit entries" emptyDescription="Privileged actions will be listed here as they happen."
        columns={[
          { key: 'createdAt', label: 'When (IST)', render: (r) => fmtDateTime(r.createdAt) },
          { key: 'actorName', label: 'Actor', render: (r) => <>{r.actorName ?? '—'}<Typography variant="caption" display="block" color="text.secondary">{r.actorRole}</Typography></> },
          { key: 'action', label: 'Action', render: (r) => <code>{r.action}</code> },
          { key: 'targetType', label: 'Target', render: (r) => <>{r.targetType}<Typography variant="caption" display="block" color="text.secondary" sx={{ wordBreak: 'break-all' }}>{r.targetId}</Typography></> },
          { key: 'ip', label: 'IP' },
          {
            key: 'detail', label: '', align: 'right',
            render: (r) => (
              <IconButton size="small" aria-label="Show before and after values" aria-expanded={open === r.id} onClick={(e) => { e.stopPropagation(); setOpen(open === r.id ? null : r.id); }}>
                <ExpandMoreIcon sx={{ transform: open === r.id ? 'rotate(180deg)' : 'none' }} />
              </IconButton>
            ),
          },
        ]}
      />
      {open != null && q.data?.items.find((r) => r.id === open) && (
        <Box sx={{ mt: 2 }} className="row g-3">
          <div className="col-12 col-md-6"><Typography fontWeight={600}>Before</Typography><Json value={q.data.items.find((r) => r.id === open).oldValue} /></div>
          <div className="col-12 col-md-6"><Typography fontWeight={600}>After</Typography><Json value={q.data.items.find((r) => r.id === open).newValue} /></div>
        </Box>
      )}
    </>
  );
}
