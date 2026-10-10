import { useEffect, useState } from 'react';
import { zodResolver } from '@hookform/resolvers/zod';
import { Alert, Button, Dialog, DialogActions, DialogContent, DialogTitle, InputAdornment, MenuItem, TextField } from '@mui/material';
import { Stack } from '../../components/layout.jsx';
import AddIcon from '@mui/icons-material/Add';
import SearchIcon from '@mui/icons-material/Search';
import { useForm } from 'react-hook-form';
import { useNavigate } from 'react-router-dom';
import { z } from 'zod';
import { api } from '../../api/client.js';
import { useGet, useSend } from '../../api/hooks.js';
import { useAuth } from '../../auth/AuthContext.jsx';
import { Pill } from '../../components/badges.jsx';
import { PageHeader } from '../../components/cards.jsx';
import { DataTable } from '../../components/DataTable.jsx';
import { ErrorState } from '../../components/feedback.jsx';
import { SelectInput, TextInput, str } from '../../components/forms.jsx';
import { useScope } from '../../layouts/AppShell.jsx';

const schema = z.object({
  name: z.string().trim().min(1, 'Enter the company name').max(200),
  website: z.string().trim().refine((v) => v === '' || /^https?:\/\//i.test(v), 'Start with https://'),
  industry: z.string().trim().max(120),
  contactPerson: z.string().trim().max(120),
  contactEmail: z.string().trim().refine((v) => v === '' || /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v), 'Enter a valid email'),
  contactPhone: z.string().trim().regex(/^$|^[0-9+\-\s()]{7,20}$/, 'Enter a valid phone number'),
  notes: z.string().trim().max(2000),
  collegeId: z.string().optional(),
});

export function CompanyDialog({ open, onClose, company, collegeId: scopedCollege }) {
  const { user } = useAuth();
  const admin = user.role === 'admin';
  const colleges = useGet('/admin/colleges', null, { enabled: admin && open });
  const { control, handleSubmit, reset, setError } = useForm({
    resolver: zodResolver(schema),
    defaultValues: { name: '', website: '', industry: '', contactPerson: '', contactEmail: '', contactPhone: '', notes: '', collegeId: scopedCollege ?? '' },
  });
  useEffect(() => {
    if (open) {
      reset({
        name: company?.name ?? '', website: company?.website ?? '', industry: company?.industry ?? '', contactPerson: company?.contactPerson ?? '',
        contactEmail: company?.contactEmail ?? '', contactPhone: company?.contactPhone ?? '', notes: company?.notes ?? '', collegeId: scopedCollege ?? '',
      });
    }
  }, [open, company, scopedCollege, reset]);

  const save = useSend((body) => (company ? api.patch(`/companies/${company.id}`, body) : api.post('/companies', body)), {
    invalidate: ['/companies'], success: company ? 'Company updated.' : 'Company registered.', onSuccess: onClose,
  });

  const onSubmit = handleSubmit((v) => {
    if (admin && !company && !v.collegeId) return setError('collegeId', { message: 'Choose a college' });
    save.mutate({
      name: v.name, website: str(v.website), industry: str(v.industry), contactPerson: str(v.contactPerson),
      contactEmail: str(v.contactEmail), contactPhone: str(v.contactPhone), notes: str(v.notes),
      ...(admin && !company ? { collegeId: v.collegeId } : {}),
    });
  });

  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="sm">
      <form onSubmit={onSubmit} noValidate>
        <DialogTitle>{company ? 'Edit company' : 'Register a company'}</DialogTitle>
        <DialogContent>
          <Stack spacing={2.5} sx={{ pt: 1 }}>
            {save.isError && <Alert severity="error" role="alert">{save.error.message}</Alert>}
            {admin && !company && (
              <SelectInput control={control} name="collegeId" label="College" required options={(colleges.data ?? []).map((c) => ({ value: c.id, label: c.name }))} />
            )}
            <TextInput control={control} name="name" label="Company name" required />
            <div className="row g-3">
              <div className="col-12 col-sm-6"><TextInput control={control} name="industry" label="Industry" /></div>
              <div className="col-12 col-sm-6"><TextInput control={control} name="website" label="Website" placeholder="https://" /></div>
              <div className="col-12 col-sm-6"><TextInput control={control} name="contactPerson" label="Contact person" /></div>
              <div className="col-12 col-sm-6"><TextInput control={control} name="contactEmail" label="Contact email" type="email" /></div>
              <div className="col-12 col-sm-6"><TextInput control={control} name="contactPhone" label="Contact phone" /></div>
            </div>
            <TextInput control={control} name="notes" label="Notes" multiline rows={3} />
          </Stack>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button onClick={onClose} color="inherit">Cancel</Button>
          <Button type="submit" variant="contained" disabled={save.isPending}>{save.isPending ? 'Saving…' : 'Save'}</Button>
        </DialogActions>
      </form>
    </Dialog>
  );
}

export default function PlacementCompanies() {
  const { scopeParams, collegeId } = useScope();
  const navigate = useNavigate();
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);
  const [open, setOpen] = useState(false);
  const list = useGet('/companies', { ...scopeParams, q: q || undefined, status: status || undefined, page, pageSize: 20 });

  return (
    <>
      <PageHeader title="Companies" subtitle="Recruiter records managed by your placement cell." actions={<Button variant="contained" startIcon={<AddIcon />} onClick={() => setOpen(true)}>Register company</Button>} />
      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} sx={{ mb: 3 }}>
        <TextField value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} placeholder="Search companies"
          slotProps={{ input: { startAdornment: <InputAdornment position="start"><SearchIcon /></InputAdornment> }, htmlInput: { 'aria-label': 'Search companies' } }} />
        <TextField select label="Status" value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }} sx={{ minWidth: 160 }}>
          <MenuItem value="">All</MenuItem><MenuItem value="active">Active</MenuItem><MenuItem value="inactive">Inactive</MenuItem>
        </TextField>
      </Stack>
      {list.isError && <ErrorState error={list.error} onRetry={list.refetch} />}
      <DataTable
        caption="Companies" loading={list.isLoading} rows={list.data?.items ?? []} page={page} pageSize={20} total={list.data?.total} onPageChange={setPage}
        onRowClick={(r) => navigate(`/placement/companies/${r.id}`)} emptyTitle="No companies yet" emptyDescription="Register the first company to create a drive."
        emptyAction={<Button variant="contained" onClick={() => setOpen(true)}>Register company</Button>}
        columns={[
          { key: 'name', label: 'Company', sortable: true, render: (r) => <strong>{r.name}</strong> },
          { key: 'industry', label: 'Industry', sortable: true },
          { key: 'contactPerson', label: 'Contact' },
          { key: 'driveCount', label: 'Drives', align: 'right', sortable: true },
          { key: 'status', label: 'Status', render: (r) => <Pill tone={r.status === 'active' ? 'success' : 'neutral'}>{r.status}</Pill> },
        ]}
      />
      <CompanyDialog open={open} onClose={() => setOpen(false)} collegeId={collegeId} />
    </>
  );
}
