import { useState } from 'react';
import { zodResolver } from '@hookform/resolvers/zod';
import { Alert, Box, Button, Dialog, DialogActions, DialogContent, DialogTitle, IconButton, InputAdornment, Tab, Tabs, TextField, Typography } from '@mui/material';
import { Stack } from '../../components/layout.jsx';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { api } from '../../api/client.js';
import { useGet, useSend } from '../../api/hooks.js';
import { InviteStateBadge } from '../../components/badges.jsx';
import { PageHeader, SurfaceCard } from '../../components/cards.jsx';
import { ConfirmDialog } from '../../components/ConfirmDialog.jsx';
import { DataTable } from '../../components/DataTable.jsx';
import { EmptyState, ErrorState, LoadingState } from '../../components/feedback.jsx';
import { SelectInput, TextInput } from '../../components/forms.jsx';
import { useToast } from '../../components/Toast.jsx';
import { fmtDate, fmtDateTime } from '../../lib/format.js';

const inviteSchema = z.object({ email: z.string().trim().email('Enter a valid email'), collegeId: z.string().min(1, 'Choose a college') });

function InviteDialog({ open, onClose }) {
  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="sm">
      {open && <InviteBody onClose={onClose} />}
    </Dialog>
  );
}

function InviteBody({ onClose }) {
  const toast = useToast();
  const colleges = useGet('/admin/colleges');
  const [created, setCreated] = useState(null);
  const { control, handleSubmit } = useForm({ resolver: zodResolver(inviteSchema), defaultValues: { email: '', collegeId: '' } });
  const send = useSend((v) => api.post('/admin/invitations', v), { invalidate: ['/admin/invitations'], onSuccess: setCreated });

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(created.inviteUrl);
      toast.success('Invitation link copied.');
    } catch {
      toast.error('Copy failed. Select the link and copy it manually.');
    }
  };

  return (
    <>
      {created ? (
        <>
          <DialogTitle>Invitation created</DialogTitle>
          <DialogContent>
            <Stack spacing={2} sx={{ pt: 1 }}>
              <Alert severity="success">
                {created.emailed ? 'An email was sent to the invitee.' : 'Email is not configured, so share this link with the invitee yourself.'}
                {' '}It is single-use, tied to <strong>{created.email}</strong> and expires {fmtDate(created.expiresAt)}.
              </Alert>
              <TextField
                label="Invitation link (shown only now)" value={created.inviteUrl} slotProps={{ input: { readOnly: true, endAdornment: <InputAdornment position="end"><IconButton aria-label="Copy link" onClick={copy}><ContentCopyIcon /></IconButton></InputAdornment> } }}
              />
            </Stack>
          </DialogContent>
          <DialogActions sx={{ px: 3, pb: 2 }}><Button onClick={onClose} variant="contained">Done</Button></DialogActions>
        </>
      ) : (
        <form onSubmit={handleSubmit((v) => send.mutate(v))} noValidate>
          <DialogTitle>Invite a placement cell member</DialogTitle>
          <DialogContent>
            <Stack spacing={2.5} sx={{ pt: 1 }}>
              {send.isError && <Alert severity="error">{send.error.message}</Alert>}
              <TextInput control={control} name="email" label="Email address" type="email" />
              <SelectInput control={control} name="collegeId" label="College" options={(colleges.data ?? []).map((c) => ({ value: c.id, label: c.name }))} />
              <Typography variant="body2" color="text.secondary">A new invitation replaces any outstanding one for the same email.</Typography>
            </Stack>
          </DialogContent>
          <DialogActions sx={{ px: 3, pb: 2 }}>
            <Button onClick={onClose} color="inherit">Cancel</Button>
            <Button type="submit" variant="contained" disabled={send.isPending}>Create invitation</Button>
          </DialogActions>
        </form>
      )}
    </>
  );
}

export default function AdminApprovals() {
  const [tab, setTab] = useState('pending');
  const [invite, setInvite] = useState(false);
  const [reject, setReject] = useState(null);
  const [revoke, setRevoke] = useState(null);
  const pending = useGet('/admin/users', { role: 'placement_cell', status: 'pending', pageSize: 50 });
  const invites = useGet('/admin/invitations', { pageSize: 50 });

  const refresh = ['/admin/users', '/admin/metrics'];
  const approve = useSend((u) => api.patch(`/admin/users/${u.id}/status`, { status: 'active' }), { invalidate: refresh, success: 'Approved. The user was notified.' });
  const doReject = useSend((v) => api.patch(`/admin/users/${v.user.id}/status`, { status: 'rejected', reason: v.reason }), { invalidate: refresh, success: 'Registration rejected.', onSuccess: () => setReject(null), onError: () => setReject(null) });
  const doRevoke = useSend((id) => api.delete(`/admin/invitations/${id}`), { invalidate: ['/admin/invitations'], success: 'Invitation revoked.', onSuccess: () => setRevoke(null), onError: () => setRevoke(null) });

  return (
    <>
      <PageHeader title="Approvals & invitations" subtitle="Placement cell access is never automatic." actions={<Button variant="contained" onClick={() => setInvite(true)}>Invite member</Button>} />
      <Tabs value={tab} onChange={(_, v) => setTab(v)} sx={{ mb: 3 }}>
        <Tab value="pending" label={`Pending approval${pending.data ? ` (${pending.data.total})` : ''}`} />
        <Tab value="invites" label="Invitations" />
      </Tabs>

      {tab === 'pending' && (
        <>
          {pending.isLoading && <LoadingState lines={3} height={90} />}
          {pending.isError && <ErrorState error={pending.error} onRetry={pending.refetch} />}
          {pending.data?.items.length === 0 && <EmptyState title="No pending requests" description="New placement cell registrations will appear here for approval." />}
          <Stack spacing={2}>
            {pending.data?.items.map((u) => (
              <SurfaceCard key={u.id}>
                <Stack direction={{ xs: 'column', sm: 'row' }} justifyContent="space-between" spacing={2}>
                  <Box>
                    <Typography variant="h6" component="h2">{u.fullName}</Typography>
                    <Typography color="text.secondary">{u.email}{u.phone ? ` · ${u.phone}` : ''}</Typography>
                    <Typography variant="body2">College: <strong>{u.collegeName}</strong> · requested {fmtDateTime(u.createdAt)}</Typography>
                  </Box>
                  <Stack direction="row" spacing={1} alignItems="flex-start">
                    <Button variant="contained" onClick={() => approve.mutate(u)} disabled={approve.isPending}>Approve</Button>
                    <Button color="error" variant="outlined" onClick={() => setReject(u)}>Reject</Button>
                  </Stack>
                </Stack>
              </SurfaceCard>
            ))}
          </Stack>
        </>
      )}

      {tab === 'invites' && (
        <DataTable
          caption="Invitations" loading={invites.isLoading} rows={invites.data?.items ?? []} emptyTitle="No invitations yet"
          columns={[
            { key: 'email', label: 'Email' },
            { key: 'collegeName', label: 'College' },
            { key: 'state', label: 'State', render: (r) => <InviteStateBadge value={r.state} /> },
            { key: 'expiresAt', label: 'Expires', render: (r) => fmtDate(r.expiresAt) },
            { key: 'createdAt', label: 'Created', render: (r) => fmtDate(r.createdAt) },
            { key: 'actions', label: '', align: 'right', render: (r) => r.state === 'pending' && <Button size="small" color="error" onClick={() => setRevoke(r)}>Revoke</Button> },
          ]}
        />
      )}

      <InviteDialog open={invite} onClose={() => setInvite(false)} />
      <ConfirmDialog
        open={!!reject} title={reject ? `Reject ${reject.fullName}?` : ''} message="They will see the reason you give." inputLabel="Reason (required)" inputRequired
        confirmLabel="Reject" danger loading={doReject.isPending} onClose={() => setReject(null)} onConfirm={(reason) => doReject.mutate({ user: reject, reason })}
      />
      <ConfirmDialog
        open={!!revoke} title="Revoke this invitation?" message={revoke ? `The link sent to ${revoke.email} will stop working.` : ''}
        confirmLabel="Revoke" danger loading={doRevoke.isPending} onClose={() => setRevoke(null)} onConfirm={() => doRevoke.mutate(revoke.id)}
      />
    </>
  );
}
