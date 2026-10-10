import { useEffect, useState } from 'react';
import { zodResolver } from '@hookform/resolvers/zod';
import { Alert, Box, Button, IconButton, MenuItem, TextField, Typography } from '@mui/material';
import { Stack } from '../../components/layout.jsx';
import AddIcon from '@mui/icons-material/Add';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutlined';
import { Controller, useFieldArray, useForm } from 'react-hook-form';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { z } from 'zod';
import { api } from '../../api/client.js';
import { useGet, useSend } from '../../api/hooks.js';
import { PageHeader, SurfaceCard } from '../../components/cards.jsx';
import { ErrorState, LoadingState } from '../../components/feedback.jsx';
import { SelectInput, TagInput, TextInput, numOrNull, str } from '../../components/forms.jsx';
import { useScope } from '../../layouts/AppShell.jsx';
import { fmtDateTime, fromLocalInput, toLocalInput } from '../../lib/format.js';

const optNum = (min, max, label) =>
  z.string().trim().refine((v) => v === '' || (!Number.isNaN(Number(v)) && Number(v) >= min && Number(v) <= max), `${label} must be between ${min} and ${max}`);

const schema = z.object({
  companyId: z.string().min(1, 'Choose a company'),
  title: z.string().trim().min(1, 'Enter a job title').max(200),
  description: z.string().trim().max(5000),
  jobType: z.enum(['full_time', 'internship']),
  location: z.string().trim().max(120),
  packageLpa: optNum(0, 1000, 'Package'),
  stipendPerMonth: optNum(0, 10_000_000, 'Stipend'),
  openings: z.string().trim().refine((v) => v === '' || (/^\d+$/.test(v) && Number(v) >= 1), 'Enter a whole number'),
  deadline: z.string().min(1, 'Set the application deadline'),
  driveDate: z.string(),
  skills: z.array(z.object({ skill: z.string().trim().min(1, 'Enter a skill'), importance: z.enum(['mandatory', 'preferred']) })).max(40),
  minCgpa: optNum(0, 10, 'CGPA'),
  maxBacklogs: z.string().trim().refine((v) => v === '' || (/^\d+$/.test(v) && Number(v) <= 50), 'Enter a whole number'),
  minTenthPercent: optNum(0, 100, '10th %'),
  minTwelfthPercent: optNum(0, 100, '12th %'),
  allowedDepartments: z.array(z.string()),
  allowedYears: z.array(z.number()),
});

const blank = (companyId = '') => ({
  companyId, title: '', description: '', jobType: 'full_time', location: '', packageLpa: '', stipendPerMonth: '', openings: '',
  deadline: '', driveDate: '', skills: [], minCgpa: '', maxBacklogs: '', minTenthPercent: '', minTwelfthPercent: '',
  allowedDepartments: [], allowedYears: [],
});

function fromDrive(d) {
  const e = d.eligibility ?? {};
  return {
    companyId: d.companyId, title: d.title, description: d.description ?? '', jobType: d.jobType, location: d.location ?? '',
    packageLpa: d.packageLpa ?? '', stipendPerMonth: d.stipendPerMonth ?? '', openings: d.openings ?? '',
    deadline: toLocalInput(d.deadline), driveDate: toLocalInput(d.driveDate), skills: d.skills ?? [],
    minCgpa: e.minCgpa ?? '', maxBacklogs: e.maxBacklogs ?? '', minTenthPercent: e.minTenthPercent ?? '', minTwelfthPercent: e.minTwelfthPercent ?? '',
    allowedDepartments: e.allowedDepartments ?? [], allowedYears: e.allowedYears ?? [],
  };
}

export default function PlacementDriveForm() {
  const { id } = useParams();
  const editing = !!id;
  const [search] = useSearchParams();
  const navigate = useNavigate();
  const { scopeParams } = useScope();
  const existing = useGet(editing ? `/drives/${id}` : null);
  const companies = useGet('/companies', { ...scopeParams, status: 'active', pageSize: 100 });
  const [error, setError] = useState('');

  const { control, handleSubmit, reset } = useForm({ resolver: zodResolver(schema), defaultValues: blank(search.get('companyId') ?? '') });
  const skills = useFieldArray({ control, name: 'skills' });
  useEffect(() => {
    if (existing.data) reset(fromDrive(existing.data));
  }, [existing.data, reset]);

  const save = useSend(
    ({ body, id: driveId }) => (driveId ? api.patch(`/drives/${driveId}`, body) : api.post('/drives', body)),
    { invalidate: ['/drives', '/analytics'], success: editing ? 'Drive updated.' : 'Drive created.', onSuccess: (d) => navigate(`/placement/drives/${d.id}`), onError: (e) => setError(e.message) },
  );

  const submit = (status) =>
    handleSubmit((v) => {
      setError('');
      const eligibility = {
        minCgpa: numOrNull(v.minCgpa), maxBacklogs: numOrNull(v.maxBacklogs), allowedDepartments: v.allowedDepartments, allowedYears: v.allowedYears,
        minTenthPercent: numOrNull(v.minTenthPercent), minTwelfthPercent: numOrNull(v.minTwelfthPercent),
      };
      const common = {
        title: v.title, description: str(v.description), jobType: v.jobType, location: str(v.location),
        packageLpa: str(v.packageLpa) ? Number(v.packageLpa) : undefined, stipendPerMonth: str(v.stipendPerMonth) ? Number(v.stipendPerMonth) : undefined,
        openings: str(v.openings) ? Number(v.openings) : undefined, driveDate: fromLocalInput(v.driveDate),
        skills: v.skills, eligibility,
      };
      if (editing) save.mutate({ id, body: common });
      else save.mutate({ body: { ...common, companyId: v.companyId, deadline: fromLocalInput(v.deadline), status } });
    });

  if (editing && existing.isLoading) return <LoadingState lines={8} />;
  if (editing && existing.isError) return <ErrorState error={existing.error} onRetry={existing.refetch} />;

  return (
    <>
      <PageHeader back title={editing ? 'Edit drive' : 'New drive'} subtitle="Eligibility criteria are applied by rules. Leave any criterion empty to skip it." />
      <form noValidate onSubmit={(e) => e.preventDefault()}>
        <Stack spacing={3}>
          {error && <Alert severity="error" role="alert">{error}</Alert>}
          <SurfaceCard title="Role">
            <div className="row g-3">
              <div className="col-12 col-md-6">
                <SelectInput control={control} name="companyId" label="Company" required disabled={editing}
                  options={(companies.data?.items ?? []).map((c) => ({ value: c.id, label: c.name }))}
                  helper={companies.data?.items.length === 0 ? 'Register a company first.' : undefined} />
              </div>
              <div className="col-12 col-md-6"><TextInput control={control} name="title" label="Job title" required /></div>
              <div className="col-12"><TextInput control={control} name="description" label="Description" multiline rows={5} /></div>
              <div className="col-6 col-md-3"><SelectInput control={control} name="jobType" label="Type" options={[{ value: 'full_time', label: 'Full time' }, { value: 'internship', label: 'Internship' }]} /></div>
              <div className="col-6 col-md-3"><TextInput control={control} name="location" label="Location" /></div>
              <div className="col-6 col-md-2"><TextInput control={control} name="packageLpa" label="Package (LPA)" inputMode="decimal" /></div>
              <div className="col-6 col-md-2"><TextInput control={control} name="stipendPerMonth" label="Stipend (₹/mo)" inputMode="decimal" /></div>
              <div className="col-6 col-md-2"><TextInput control={control} name="openings" label="Openings" inputMode="numeric" /></div>
            </div>
          </SurfaceCard>

          <SurfaceCard title="Dates">
            <div className="row g-3">
              <div className="col-12 col-md-6">
                {editing ? (
                  <Alert severity="info">Deadline: <strong>{fmtDateTime(existing.data.deadline)}</strong>. To change it, use “Extend deadline” on the drive page (it is audited).</Alert>
                ) : (
                  <TextInput control={control} name="deadline" label="Application deadline" type="datetime-local" required />
                )}
              </div>
              <div className="col-12 col-md-6"><TextInput control={control} name="driveDate" label="Drive date (optional)" type="datetime-local" /></div>
            </div>
          </SurfaceCard>

          <SurfaceCard title="Required skills" subtitle="Must-have skills count double in the match score." action={<Button startIcon={<AddIcon />} onClick={() => skills.append({ skill: '', importance: 'mandatory' })}>Add skill</Button>}>
            {skills.fields.length === 0 && <Typography color="text.secondary">No skills listed. Without skills, candidate matching has little to work with.</Typography>}
            <Stack spacing={1.5}>
              {skills.fields.map((f, i) => (
                <Stack key={f.id} direction="row" spacing={1.5} alignItems="flex-start">
                  <Box sx={{ flexGrow: 1 }}><TextInput control={control} name={`skills.${i}.skill`} label={`Skill ${i + 1}`} /></Box>
                  <Controller control={control} name={`skills.${i}.importance`} render={({ field }) => (
                    <TextField {...field} select label="Importance" sx={{ minWidth: 160 }}>
                      <MenuItem value="mandatory">Must-have</MenuItem><MenuItem value="preferred">Nice-to-have</MenuItem>
                    </TextField>
                  )} />
                  <IconButton aria-label={`Remove skill ${i + 1}`} onClick={() => skills.remove(i)} sx={{ mt: 0.5 }}><DeleteOutlineIcon /></IconButton>
                </Stack>
              ))}
            </Stack>
          </SurfaceCard>

          <SurfaceCard title="Eligibility criteria" subtitle="Evaluated deterministically for every student. Empty = not applied.">
            <div className="row g-3">
              <div className="col-6 col-md-3"><TextInput control={control} name="minCgpa" label="Minimum CGPA" inputMode="decimal" /></div>
              <div className="col-6 col-md-3"><TextInput control={control} name="maxBacklogs" label="Max active backlogs" inputMode="numeric" /></div>
              <div className="col-6 col-md-3"><TextInput control={control} name="minTenthPercent" label="Minimum 10th %" inputMode="decimal" /></div>
              <div className="col-6 col-md-3"><TextInput control={control} name="minTwelfthPercent" label="Minimum 12th %" inputMode="decimal" /></div>
              <div className="col-12 col-md-8"><TagInput control={control} name="allowedDepartments" label="Allowed departments" options={['CSE', 'IT', 'ECE', 'EEE', 'Mechanical', 'Civil', 'AI & DS']} helper="Leave empty to allow all departments" /></div>
              <div className="col-12 col-md-4"><TagInput control={control} name="allowedYears" label="Allowed batches" numeric helper="e.g. 2026. Empty = all" /></div>
            </div>
          </SurfaceCard>

          <Stack direction="row" spacing={1.5}>
            {editing ? (
              <Button variant="contained" size="large" onClick={submit()} disabled={save.isPending}>Save changes</Button>
            ) : (
              <>
                <Button variant="contained" size="large" onClick={submit('open')} disabled={save.isPending}>Create & open for applications</Button>
                <Button size="large" variant="outlined" onClick={submit('draft')} disabled={save.isPending}>Save as draft</Button>
              </>
            )}
          </Stack>
        </Stack>
      </form>
    </>
  );
}
