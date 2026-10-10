import { useEffect, useState } from 'react';
import { zodResolver } from '@hookform/resolvers/zod';
import { Alert, Button, Dialog, DialogActions, DialogContent, DialogTitle } from '@mui/material';
import { Stack } from '../../components/layout.jsx';
import AddIcon from '@mui/icons-material/Add';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { api } from '../../api/client.js';
import { useGet, useSend } from '../../api/hooks.js';
import { PageHeader } from '../../components/cards.jsx';
import { DataTable } from '../../components/DataTable.jsx';
import { ErrorState } from '../../components/feedback.jsx';
import { TextInput, str } from '../../components/forms.jsx';
import { fmtDate } from '../../lib/format.js';

const schema = z.object({ name: z.string().trim().min(2, 'Enter the college name').max(200), code: z.string().trim().max(30), city: z.string().trim().max(80) });

function CollegeDialog({ open, college, onClose }) {
  const { control, handleSubmit, reset } = useForm({ resolver: zodResolver(schema), defaultValues: { name: '', code: '', city: '' } });
  useEffect(() => {
    if (open) reset({ name: college?.name ?? '', code: college?.code ?? '', city: college?.city ?? '' });
  }, [open, college, reset]);
  const save = useSend((v) => (college ? api.patch(`/admin/colleges/${college.id}`, v) : api.post('/admin/colleges', v)), {
    invalidate: ['/admin/colleges', '/auth/colleges'], success: college ? 'College updated.' : 'College added.', onSuccess: onClose,
  });
  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="sm">
      <form onSubmit={handleSubmit((v) => save.mutate({ name: v.name, code: str(v.code), city: str(v.city) }))} noValidate>
        <DialogTitle>{college ? 'Edit college' : 'Add a college'}</DialogTitle>
        <DialogContent>
          <Stack spacing={2.5} sx={{ pt: 1 }}>
            {save.isError && <Alert severity="error">{save.error.message}</Alert>}
            <TextInput control={control} name="name" label="College name" required />
            <div className="row g-3">
              <div className="col-6"><TextInput control={control} name="code" label="Code" /></div>
              <div className="col-6"><TextInput control={control} name="city" label="City" /></div>
            </div>
          </Stack>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button onClick={onClose} color="inherit">Cancel</Button>
          <Button type="submit" variant="contained" disabled={save.isPending}>Save</Button>
        </DialogActions>
      </form>
    </Dialog>
  );
}

export default function AdminColleges() {
  const q = useGet('/admin/colleges');
  const [dialog, setDialog] = useState({ open: false, college: null });
  return (
    <>
      <PageHeader title="Colleges" subtitle="Each college's placement cell only sees its own data." actions={<Button variant="contained" startIcon={<AddIcon />} onClick={() => setDialog({ open: true, college: null })}>Add college</Button>} />
      {q.isError && <ErrorState error={q.error} onRetry={q.refetch} />}
      <DataTable
        caption="Colleges" loading={q.isLoading} rows={q.data ?? []} emptyTitle="No colleges yet"
        emptyDescription="Students and placement staff choose their college when they register, so add at least one."
        columns={[
          { key: 'name', label: 'College', sortable: true, render: (r) => <strong>{r.name}</strong> },
          { key: 'code', label: 'Code' },
          { key: 'city', label: 'City', sortable: true },
          { key: 'createdAt', label: 'Added', render: (r) => fmtDate(r.createdAt) },
          { key: 'actions', label: '', align: 'right', render: (r) => <Button size="small" onClick={() => setDialog({ open: true, college: r })}>Edit</Button> },
        ]}
      />
      <CollegeDialog open={dialog.open} college={dialog.college} onClose={() => setDialog({ open: false, college: null })} />
    </>
  );
}
