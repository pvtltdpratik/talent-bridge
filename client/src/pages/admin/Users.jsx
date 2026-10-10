import { useState } from 'react';
import { zodResolver } from '@hookform/resolvers/zod';
import { Alert, Button, Dialog, DialogActions, DialogContent, DialogTitle, InputAdornment, MenuItem, TextField, Typography } from '@mui/material';
import { Stack } from '../../components/layout.jsx';
import SearchIcon from '@mui/icons-material/Search';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { api } from '../../api/client.js';
import { useGet, useSend } from '../../api/hooks.js';
import { useAuth } from '../../auth/AuthContext.jsx';
import { AccountStatusBadge } from '../../components/badges.jsx';
import { PageHeader } from '../../components/cards.jsx';
import { ConfirmDialog } from '../../components/ConfirmDialog.jsx';
import { DataTable } from '../../components/DataTable.jsx';
import { ErrorState } from '../../components/feedback.jsx';
import { TextInput } from '../../components/forms.jsx';
import { fmtDate, titleCase } from '../../lib/format.js';

const adminSchema = z.object({
  fullName: z.string().trim().min(2, 'Enter a name'),
  email: z.string().trim().email('Enter a valid email'),
  password: z.string().min(8, 'Use at least 8 characters').max(72),
});

function CreateAdminDialog({ open, onClose }) {
  const { control, handleSubmit, reset } = useForm({ resolver: zodResolver(adminSchema), defaultValues: { fullName: '', email: '', password: '' } });
  const save = useSend((v) => api.post('/admin/admins', v), { invalidate: ['/admin/users'], success: 'Administrator created.', onSuccess: () => { reset(); onClose(); } });
  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="sm">
      <form onSubmit={handleSubmit((v) => save.mutate(v))} noValidate>
        <DialogTitle>Create an administrator</DialogTitle>
        <DialogContent>
          <Stack spacing={2.5} sx={{ pt: 1 }}>
            <Alert severity="info">Administrators have full access. Share the temporary password through a secure channel and ask them to change it.</Alert>
            {save.isError && <Alert severity="error">{save.error.message}</Alert>}
            <TextInput control={control} name="fullName" label="Full name" />
            <TextInput control={control} name="email" label="Email" type="email" />
            <TextInput control={control} name="password" label="Temporary password" type="password" autoComplete="new-password" />
          </Stack>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button onClick={onClose} color="inherit">Cancel</Button>
          <Button type="submit" variant="contained" disabled={save.isPending}>Create</Button>
        </DialogActions>
      </form>
    </Dialog>
  );
}

export default function AdminUsers() {
  const { user: me } = useAuth();
  const [q, setQ] = useState('');
  const [role, setRole] = useState('');
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);
  const [statusDialog, setStatusDialog] = useState(null); // { user, status }
  const [roleDialog, setRoleDialog] = useState(null);
  const [newRole, setNewRole] = useState('');
  const [newCollege, setNewCollege] = useState('');
  const [adminDialog, setAdminDialog] = useState(false);

  const list = useGet('/admin/users', { q: q || undefined, role: role || undefined, status: status || undefined, page, pageSize: 20 });
  const colleges = useGet('/admin/colleges');

  const setUserStatus = useSend((v) => api.patch(`/admin/users/${v.user.id}/status`, { status: v.status, reason: v.reason || undefined }), {
    invalidate: ['/admin/users', '/admin/metrics'], success: 'Account updated and the user was notified.', onSuccess: () => setStatusDialog(null), onError: () => setStatusDialog(null),
  });
  const setUserRole = useSend((v) => api.patch(`/admin/users/${v.user.id}/role`, { role: v.role, collegeId: v.collegeId || undefined }), {
    invalidate: ['/admin/users'], success: 'Role changed and recorded in the audit log.', onSuccess: () => setRoleDialog(null),
  });

  const actions = (u) => {
    if (u.id === me.id) return <Typography variant="caption" color="text.secondary">You</Typography>;
    const out = [];
    if (u.status === 'pending') out.push(['Approve', 'active'], ['Reject', 'rejected']);
    if (u.status === 'active') out.push(['Suspend', 'suspended']);
    if (u.status === 'suspended' || u.status === 'rejected') out.push(['Reactivate', 'active']);
    return (
      <Stack direction="row" spacing={0.5} justifyContent="flex-end" flexWrap="wrap" useFlexGap>
        {out.map(([label, s]) => <Button key={label} size="small" color={s === 'active' ? 'primary' : 'error'} onClick={() => setStatusDialog({ user: u, status: s })}>{label}</Button>)}
        <Button size="small" color="inherit" onClick={() => { setRoleDialog(u); setNewRole(u.role); setNewCollege(u.collegeId ?? ''); }}>Change role</Button>
      </Stack>
    );
  };

  return (
    <>
      <PageHeader title="Users & roles" subtitle="Account approvals, suspensions and role changes are all audited." actions={<Button variant="contained" onClick={() => setAdminDialog(true)}>Create administrator</Button>} />
      <Stack direction={{ xs: 'column', md: 'row' }} spacing={2} sx={{ mb: 3 }}>
        <TextField value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} placeholder="Search name or email"
          slotProps={{ input: { startAdornment: <InputAdornment position="start"><SearchIcon /></InputAdornment> }, htmlInput: { 'aria-label': 'Search users' } }} />
        <TextField select label="Role" value={role} onChange={(e) => { setRole(e.target.value); setPage(1); }} sx={{ minWidth: 180 }}>
          <MenuItem value="">All roles</MenuItem>
          {['student', 'placement_cell', 'admin'].map((r) => <MenuItem key={r} value={r}>{titleCase(r)}</MenuItem>)}
        </TextField>
        <TextField select label="Status" value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }} sx={{ minWidth: 180 }}>
          <MenuItem value="">All statuses</MenuItem>
          {['pending', 'active', 'suspended', 'rejected'].map((s) => <MenuItem key={s} value={s}>{titleCase(s)}</MenuItem>)}
        </TextField>
      </Stack>
      {list.isError && <ErrorState error={list.error} onRetry={list.refetch} />}
      <DataTable
        caption="Users" loading={list.isLoading} rows={list.data?.items ?? []} page={page} pageSize={20} total={list.data?.total} onPageChange={setPage}
        emptyTitle="No users match"
        columns={[
          { key: 'fullName', label: 'User', sortable: true, render: (r) => <><strong>{r.fullName}</strong><Typography variant="caption" display="block" color="text.secondary">{r.email}</Typography></> },
          { key: 'role', label: 'Role', render: (r) => titleCase(r.role) },
          { key: 'collegeName', label: 'College' },
          { key: 'status', label: 'Status', render: (r) => <AccountStatusBadge value={r.status} /> },
          { key: 'createdAt', label: 'Joined', sortable: true, render: (r) => fmtDate(r.createdAt) },
          { key: 'actions', label: '', align: 'right', render: actions },
        ]}
      />

      <ConfirmDialog
        open={!!statusDialog}
        title={statusDialog ? `${titleCase(statusDialog.status === 'active' ? (statusDialog.user.status === 'pending' ? 'approve' : 'reactivate') : statusDialog.status === 'rejected' ? 'reject' : 'suspend')} ${statusDialog.user.fullName}?` : ''}
        message={statusDialog?.status === 'active' ? 'They will be able to sign in and use the platform.' : 'They will be told the reason and lose access immediately.'}
        inputLabel={statusDialog?.status === 'active' ? undefined : 'Reason (required)'} inputRequired={statusDialog?.status !== 'active'}
        confirmLabel="Confirm" danger={statusDialog?.status !== 'active'} loading={setUserStatus.isPending}
        onClose={() => setStatusDialog(null)} onConfirm={(reason) => setUserStatus.mutate({ user: statusDialog.user, status: statusDialog.status, reason })}
      />
      <ConfirmDialog
        open={!!roleDialog} title={roleDialog ? `Change role for ${roleDialog.fullName}` : ''} confirmLabel="Change role" loading={setUserRole.isPending}
        message="Role changes take effect immediately and are recorded in the audit log."
        onClose={() => setRoleDialog(null)} onConfirm={() => newRole !== roleDialog.role && setUserRole.mutate({ user: roleDialog, role: newRole, collegeId: newRole === 'admin' ? undefined : newCollege })}
      >
        <Stack spacing={2} sx={{ mt: 1 }}>
          <TextField select label="New role" value={newRole} onChange={(e) => setNewRole(e.target.value)}>
            {['student', 'placement_cell', 'admin'].map((r) => <MenuItem key={r} value={r}>{titleCase(r)}</MenuItem>)}
          </TextField>
          {newRole !== 'admin' && (
            <TextField select label="College" value={newCollege} onChange={(e) => setNewCollege(e.target.value)}>
              {(colleges.data ?? []).map((c) => <MenuItem key={c.id} value={c.id}>{c.name}</MenuItem>)}
            </TextField>
          )}
        </Stack>
      </ConfirmDialog>
      <CreateAdminDialog open={adminDialog} onClose={() => setAdminDialog(false)} />
    </>
  );
}
