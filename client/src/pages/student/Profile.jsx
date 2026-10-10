import { useEffect, useState } from 'react';
import { zodResolver } from '@hookform/resolvers/zod';
import { Alert, Box, Button, Dialog, DialogActions, DialogContent, DialogTitle, IconButton, Typography } from '@mui/material';
import { Stack } from '../../components/layout.jsx';
import AddIcon from '@mui/icons-material/Add';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutlined';
import EditOutlinedIcon from '@mui/icons-material/EditOutlined';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { api, fieldErrors } from '../../api/client.js';
import { useGet, useSend } from '../../api/hooks.js';
import { VerificationBadge } from '../../components/badges.jsx';
import { PageHeader, SurfaceCard } from '../../components/cards.jsx';
import { ConfirmDialog } from '../../components/ConfirmDialog.jsx';
import { ErrorState, LoadingState } from '../../components/feedback.jsx';
import { SelectInput, TagInput, TextInput, numOrNull, str } from '../../components/forms.jsx';
import { useToast } from '../../components/Toast.jsx';
import { fmtDate } from '../../lib/format.js';

const DEPARTMENTS = ['CSE', 'IT', 'ECE', 'EEE', 'Mechanical', 'Civil', 'AI & DS', 'Other'];
const numStr = (min, max, label) =>
  z.string().trim().refine((v) => v === '' || (!Number.isNaN(Number(v)) && Number(v) >= min && Number(v) <= max), `${label} must be between ${min} and ${max}`);

const schema = z.object({
  fullName: z.string().trim().min(2, 'Enter your full name'),
  phone: z.string().trim().regex(/^$|^[0-9+\-\s()]{7,20}$/, 'Enter a valid phone number'),
  department: z.string(),
  rollNumber: z.string().trim().max(40),
  passingYear: z.string().trim().refine((v) => v === '' || (/^\d{4}$/.test(v) && Number(v) >= 2000 && Number(v) <= 2100), 'Enter a 4-digit year'),
  cgpa: numStr(0, 10, 'CGPA'),
  tenthPercent: numStr(0, 100, '10th %'),
  twelfthPercent: numStr(0, 100, '12th %'),
  activeBacklogs: z.string().trim().refine((v) => v === '' || (/^\d+$/.test(v) && Number(v) <= 50), 'Enter a whole number (0 if none)'),
  skills: z.array(z.string()),
  careerInterests: z.array(z.string()).max(10),
  certifications: z.array(z.string()),
  github: z.string().trim().refine((v) => v === '' || /^https?:\/\//i.test(v), 'Start with https://'),
  linkedin: z.string().trim().refine((v) => v === '' || /^https?:\/\//i.test(v), 'Start with https://'),
  portfolio: z.string().trim().refine((v) => v === '' || /^https?:\/\//i.test(v), 'Start with https://'),
});

const toForm = (p) => ({
  fullName: p.fullName ?? '', phone: p.phone ?? '', department: p.department ?? '', rollNumber: p.rollNumber ?? '',
  passingYear: p.passingYear ?? '', cgpa: p.cgpa ?? '', tenthPercent: p.tenthPercent ?? '', twelfthPercent: p.twelfthPercent ?? '',
  activeBacklogs: p.activeBacklogs ?? '', skills: p.skills ?? [], careerInterests: p.careerInterests ?? [],
  certifications: (p.certifications ?? []).map((c) => c.name ?? String(c)),
  github: p.links?.github ?? '', linkedin: p.links?.linkedin ?? '', portfolio: p.links?.portfolio ?? '',
});

function ProfileForm({ profile }) {
  const toast = useToast();
  const [serverError, setServerError] = useState('');
  const { control, handleSubmit, reset, setError, formState } = useForm({ resolver: zodResolver(schema), defaultValues: toForm(profile) });
  useEffect(() => reset(toForm(profile)), [profile, reset]);

  const save = useSend((v) => api.put('/students/me', v), {
    invalidate: ['/students/me', '/ai/'],
    onSuccess: (data) => {
      toast.success(data.verificationReset ? 'Saved. Because academic details changed, your profile needs to be verified again.' : 'Profile saved.');
    },
    onError: (e) => {
      Object.entries(fieldErrors(e)).forEach(([f, message]) => setError(f, { message }));
      setServerError(e.message);
    },
  });

  const onSubmit = handleSubmit((v) => {
    setServerError('');
    save.mutate({
      fullName: v.fullName.trim(),
      phone: str(v.phone),
      department: v.department || undefined,
      rollNumber: str(v.rollNumber),
      passingYear: numOrNull(v.passingYear),
      cgpa: numOrNull(v.cgpa),
      tenthPercent: numOrNull(v.tenthPercent),
      twelfthPercent: numOrNull(v.twelfthPercent),
      activeBacklogs: numOrNull(v.activeBacklogs),
      skills: v.skills,
      careerInterests: v.careerInterests,
      certifications: v.certifications.map((name) => ({ name })),
      links: { github: v.github, linkedin: v.linkedin, portfolio: v.portfolio },
    });
  });

  return (
    <form onSubmit={onSubmit} noValidate>
      <Stack spacing={3}>
        {serverError && <Alert severity="error" role="alert">{serverError}</Alert>}
        <SurfaceCard title="Basic details">
          <div className="row g-3">
            <div className="col-12 col-md-6"><TextInput control={control} name="fullName" label="Full name" required /></div>
            <div className="col-12 col-md-6"><TextInput control={control} name="phone" label="Phone" /></div>
            <div className="col-12 col-md-4"><SelectInput control={control} name="department" label="Department" options={[{ value: '', label: 'Not set' }, ...DEPARTMENTS.map((d) => ({ value: d, label: d }))]} /></div>
            <div className="col-12 col-md-4"><TextInput control={control} name="rollNumber" label="Roll number" /></div>
            <div className="col-12 col-md-4"><TextInput control={control} name="passingYear" label="Passing year" helper="e.g. 2026" inputMode="numeric" /></div>
          </div>
        </SurfaceCard>

        <SurfaceCard title="Academics" subtitle="Used for eligibility checks. Changing these after verification asks your placement cell to verify again.">
          <div className="row g-3">
            <div className="col-6 col-md-3"><TextInput control={control} name="cgpa" label="CGPA (out of 10)" inputMode="decimal" /></div>
            <div className="col-6 col-md-3"><TextInput control={control} name="activeBacklogs" label="Active backlogs" helper="0 if none" inputMode="numeric" /></div>
            <div className="col-6 col-md-3"><TextInput control={control} name="tenthPercent" label="10th %" inputMode="decimal" /></div>
            <div className="col-6 col-md-3"><TextInput control={control} name="twelfthPercent" label="12th %" inputMode="decimal" /></div>
          </div>
        </SurfaceCard>

        <SurfaceCard title="Skills & interests">
          <Stack spacing={2.5}>
            <TagInput control={control} name="skills" label="Skills" helper="Programming languages, frameworks, tools. Press Enter after each." />
            <TagInput control={control} name="careerInterests" label="Career interests" helper="e.g. Web development, Data science" />
            <TagInput control={control} name="certifications" label="Certifications" />
          </Stack>
        </SurfaceCard>

        <SurfaceCard title="Links">
          <div className="row g-3">
            <div className="col-12 col-md-4"><TextInput control={control} name="github" label="GitHub" placeholder="https://github.com/…" /></div>
            <div className="col-12 col-md-4"><TextInput control={control} name="linkedin" label="LinkedIn" placeholder="https://linkedin.com/in/…" /></div>
            <div className="col-12 col-md-4"><TextInput control={control} name="portfolio" label="Portfolio" placeholder="https://…" /></div>
          </div>
        </SurfaceCard>

        <Box>
          <Button type="submit" variant="contained" size="large" disabled={save.isPending || !formState.isDirty}>
            {save.isPending ? 'Saving…' : 'Save profile'}
          </Button>
        </Box>
      </Stack>
    </form>
  );
}

// ---------------------------------------------------------------- projects & experience
const projectSchema = z.object({
  title: z.string().trim().min(1, 'Give the project a title').max(200),
  description: z.string().trim().max(2000),
  tech: z.array(z.string()).max(15),
  url: z.string().trim().refine((v) => v === '' || /^https?:\/\//i.test(v), 'Start with https://'),
});

function ProjectDialog({ open, project, onClose }) {
  const { control, handleSubmit, reset } = useForm({ resolver: zodResolver(projectSchema), defaultValues: { title: '', description: '', tech: [], url: '' } });
  useEffect(() => {
    if (open) reset({ title: project?.title ?? '', description: project?.description ?? '', tech: project?.tech ?? [], url: project?.url ?? '' });
  }, [open, project, reset]);
  const save = useSend((v) => (project ? api.put(`/students/me/projects/${project.id}`, v) : api.post('/students/me/projects', v)), {
    invalidate: ['/students/me', '/ai/'], success: 'Project saved.', onSuccess: onClose,
  });
  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="sm">
      <form onSubmit={handleSubmit((v) => save.mutate({ title: v.title, description: str(v.description), tech: v.tech, url: str(v.url) }))} noValidate>
        <DialogTitle>{project ? 'Edit project' : 'Add project'}</DialogTitle>
        <DialogContent>
          <Stack spacing={2.5} sx={{ pt: 1 }}>
            <TextInput control={control} name="title" label="Title" required />
            <TextInput control={control} name="description" label="What did you build and what was the outcome?" multiline rows={4} />
            <TagInput control={control} name="tech" label="Technologies" />
            <TextInput control={control} name="url" label="Link (optional)" />
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

const expSchema = z.object({
  kind: z.enum(['internship', 'job', 'other']),
  organization: z.string().trim().min(1, 'Enter the organisation').max(200),
  role: z.string().trim().max(120),
  startDate: z.string(),
  endDate: z.string(),
  description: z.string().trim().max(2000),
});

function ExperienceDialog({ open, item, onClose }) {
  const { control, handleSubmit, reset } = useForm({ resolver: zodResolver(expSchema), defaultValues: { kind: 'internship', organization: '', role: '', startDate: '', endDate: '', description: '' } });
  useEffect(() => {
    if (open) reset({ kind: item?.kind ?? 'internship', organization: item?.organization ?? '', role: item?.role ?? '', startDate: item?.startDate ?? '', endDate: item?.endDate ?? '', description: item?.description ?? '' });
  }, [open, item, reset]);
  const save = useSend((v) => (item ? api.put(`/students/me/experience/${item.id}`, v) : api.post('/students/me/experience', v)), {
    invalidate: ['/students/me', '/ai/'], success: 'Experience saved.', onSuccess: onClose,
  });
  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="sm">
      <form onSubmit={handleSubmit((v) => save.mutate({ kind: v.kind, organization: v.organization, role: str(v.role), startDate: str(v.startDate), endDate: str(v.endDate), description: str(v.description) }))} noValidate>
        <DialogTitle>{item ? 'Edit experience' : 'Add internship / experience'}</DialogTitle>
        <DialogContent>
          <Stack spacing={2.5} sx={{ pt: 1 }}>
            <SelectInput control={control} name="kind" label="Type" options={[{ value: 'internship', label: 'Internship' }, { value: 'job', label: 'Job' }, { value: 'other', label: 'Other' }]} />
            <TextInput control={control} name="organization" label="Organisation" required />
            <TextInput control={control} name="role" label="Role" />
            <div className="row g-3">
              <div className="col-6"><TextInput control={control} name="startDate" label="Start" type="date" /></div>
              <div className="col-6"><TextInput control={control} name="endDate" label="End" type="date" /></div>
            </div>
            <TextInput control={control} name="description" label="What did you do?" multiline rows={4} />
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

function ListSection({ title, subtitle, items, onAdd, onEdit, onDelete, render, addLabel, empty }) {
  return (
    <SurfaceCard title={title} subtitle={subtitle} action={<Button startIcon={<AddIcon />} onClick={onAdd}>{addLabel}</Button>}>
      {items.length === 0 ? (
        <Typography color="text.secondary">{empty}</Typography>
      ) : (
        <Stack spacing={1.5}>
          {items.map((it) => (
            <Stack key={it.id} direction="row" spacing={1} alignItems="flex-start" sx={{ border: '1px solid var(--tb-border)', borderRadius: 3, p: 1.5 }}>
              <Box sx={{ flexGrow: 1, minWidth: 0 }}>{render(it)}</Box>
              <IconButton aria-label={`Edit ${it.title ?? it.organization}`} onClick={() => onEdit(it)}><EditOutlinedIcon /></IconButton>
              <IconButton aria-label={`Delete ${it.title ?? it.organization}`} onClick={() => onDelete(it)}><DeleteOutlineIcon /></IconButton>
            </Stack>
          ))}
        </Stack>
      )}
    </SurfaceCard>
  );
}

export default function StudentProfile() {
  const me = useGet('/students/me');
  const [project, setProject] = useState({ open: false, item: null });
  const [exp, setExp] = useState({ open: false, item: null });
  const [del, setDel] = useState(null);
  const remove = useSend((d) => api.delete(`/students/me/${d.kind}/${d.id}`), { invalidate: ['/students/me', '/ai/'], success: 'Removed.', onSuccess: () => setDel(null) });

  if (me.isLoading) return <LoadingState lines={8} />;
  if (me.isError) return <ErrorState error={me.error} onRetry={me.refetch} />;
  const p = me.data;

  return (
    <>
      <PageHeader title="My profile" subtitle={`${p.email} · ${p.collegeName}`} actions={<VerificationBadge value={p.verification.status} />} />
      {p.verification.status === 'needs_changes' && (
        <Alert severity="warning" sx={{ mb: 3 }}>Your placement cell asked for changes: {p.verification.comment}</Alert>
      )}
      <Stack spacing={3}>
        <ProfileForm profile={p} />
        <ListSection
          title="Projects" subtitle="Describe what you built, with technologies and outcomes." addLabel="Add project"
          items={p.projects} empty="No projects yet. Projects are one of the strongest signals on a fresher's profile."
          onAdd={() => setProject({ open: true, item: null })} onEdit={(item) => setProject({ open: true, item })}
          onDelete={(it) => setDel({ kind: 'projects', id: it.id, label: it.title })}
          render={(it) => (
            <>
              <Typography fontWeight={600}>{it.title}</Typography>
              {it.description && <Typography variant="body2" color="text.secondary">{it.description}</Typography>}
              {it.tech?.length > 0 && <Typography variant="caption" color="text.secondary">{it.tech.join(' · ')}</Typography>}
            </>
          )}
        />
        <ListSection
          title="Internships & experience" addLabel="Add experience"
          items={p.experience} empty="No internships or experience added."
          onAdd={() => setExp({ open: true, item: null })} onEdit={(item) => setExp({ open: true, item })}
          onDelete={(it) => setDel({ kind: 'experience', id: it.id, label: it.organization })}
          render={(it) => (
            <>
              <Typography fontWeight={600}>{it.role ? `${it.role} · ` : ''}{it.organization}</Typography>
              <Typography variant="body2" color="text.secondary">{it.startDate ? `${fmtDate(it.startDate)} – ${it.endDate ? fmtDate(it.endDate) : 'present'}` : ''}</Typography>
              {it.description && <Typography variant="body2">{it.description}</Typography>}
            </>
          )}
        />
      </Stack>
      <ProjectDialog open={project.open} project={project.item} onClose={() => setProject({ open: false, item: null })} />
      <ExperienceDialog open={exp.open} item={exp.item} onClose={() => setExp({ open: false, item: null })} />
      <ConfirmDialog
        open={!!del} title="Remove this entry?" message={del ? `“${del.label}” will be removed from your profile.` : ''}
        confirmLabel="Remove" danger loading={remove.isPending} onClose={() => setDel(null)} onConfirm={() => remove.mutate(del)}
      />
    </>
  );
}

