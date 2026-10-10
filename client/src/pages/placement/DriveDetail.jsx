import { useState } from 'react';
import { Alert, Box, Button, Checkbox, Chip, Collapse, FormControlLabel, IconButton, Menu, MenuItem, Tab, Tabs, TextField, Typography } from '@mui/material';
import { Stack } from '../../components/layout.jsx';
import ArrowUpwardIcon from '@mui/icons-material/ArrowUpward';
import ArrowDownwardIcon from '@mui/icons-material/ArrowDownward';
import DownloadIcon from '@mui/icons-material/Download';
import MoreVertIcon from '@mui/icons-material/MoreVert';
import { Link as RouterLink, useParams } from 'react-router-dom';
import { api } from '../../api/client.js';
import { useGet, useSend } from '../../api/hooks.js';
import { AiNotice } from '../../components/AiPanel.jsx';
import { AiBadge, ApplicationStatusBadge, DriveStatusBadge, EligibilityBadge, Pill, RuleBadge, VerificationBadge } from '../../components/badges.jsx';
import { PageHeader, StatCard, SurfaceCard } from '../../components/cards.jsx';
import { CHART_COLORS, SimpleBarChart } from '../../components/charts.jsx';
import { ConfirmDialog } from '../../components/ConfirmDialog.jsx';
import { DataTable } from '../../components/DataTable.jsx';
import { EmptyState, ErrorState, LoadingState } from '../../components/feedback.jsx';
import { ScoreRing } from '../../components/score.jsx';
import { useToast } from '../../components/Toast.jsx';
import { fmtDateTime, fmtINR, fromLocalInput, titleCase } from '../../lib/format.js';

const TRANSITIONS = {
  applied: ['under_review', 'shortlisted', 'rejected'],
  under_review: ['shortlisted', 'rejected'],
  shortlisted: ['under_review', 'selected', 'rejected'],
  interview_scheduled: ['shortlisted', 'selected', 'rejected'],
  rejected: ['under_review'],
  selected: [],
  withdrawn: [],
};
const COLUMNS = ['applied', 'under_review', 'shortlisted', 'interview_scheduled', 'selected', 'rejected'];
const DRIVE_ACTIONS = { draft: ['open', 'cancelled'], open: ['closed', 'completed', 'cancelled'], closed: ['open', 'completed', 'cancelled'], completed: [], cancelled: [] };
const ACTION_LABEL = { open: 'Open for applications', closed: 'Close applications', completed: 'Mark completed', cancelled: 'Cancel drive' };

// ---------------------------------------------------------------- pipeline
function PipelineCard({ app, onMove, onSchedule }) {
  const [anchor, setAnchor] = useState(null);
  const next = TRANSITIONS[app.status] ?? [];
  return (
    <Box sx={{ bgcolor: '#fff', border: '1px solid var(--tb-border)', borderRadius: 3, p: 1.5 }}>
      <Stack direction="row" justifyContent="space-between" alignItems="flex-start">
        <Box sx={{ minWidth: 0 }}>
          <Typography component={RouterLink} to={`/placement/students/${app.studentId}`} fontWeight={600} sx={{ color: 'inherit', textDecoration: 'none', overflowWrap: 'anywhere' }}>
            {app.studentName}
          </Typography>
          <Typography variant="caption" color="text.secondary" display="block">{app.department ?? '—'} · CGPA {app.cgpa ?? '—'}</Typography>
        </Box>
        {(next.length > 0 || app.status === 'shortlisted' || app.status === 'interview_scheduled') && (
          <>
            <IconButton size="small" aria-label={`Actions for ${app.studentName}`} onClick={(e) => setAnchor(e.currentTarget)}><MoreVertIcon fontSize="small" /></IconButton>
            <Menu anchorEl={anchor} open={!!anchor} onClose={() => setAnchor(null)}>
              {(app.status === 'shortlisted' || app.status === 'interview_scheduled') && <MenuItem onClick={() => { setAnchor(null); onSchedule(app); }}>Schedule interview…</MenuItem>}
              {next.map((s) => <MenuItem key={s} onClick={() => { setAnchor(null); onMove(app, s); }}>Move to {titleCase(s)}</MenuItem>)}
            </Menu>
          </>
        )}
      </Stack>
      <Stack direction="row" spacing={0.5} flexWrap="wrap" useFlexGap sx={{ mt: 1 }}>
        {app.viaException && <Pill tone="warning" title="Applied through an approved exception">Exception</Pill>}
        {app.eligibilitySnapshot?.status && <EligibilityBadge value={app.eligibilitySnapshot.status} />}
      </Stack>
    </Box>
  );
}

function Pipeline({ driveId }) {
  const q = useGet('/applications', { driveId, pageSize: 100 });
  const [move, setMove] = useState(null);
  const [sched, setSched] = useState(null);
  const [form, setForm] = useState({ roundName: '', scheduledAt: '', mode: 'online', venueOrLink: '', notes: '' });
  const refresh = ['/applications', '/drives', '/interviews', '/analytics'];
  const doMove = useSend((v) => api.patch(`/applications/${v.app.id}/status`, { status: v.status, note: v.note || undefined }), {
    invalidate: refresh, success: 'Status updated and the student was notified.', onSuccess: () => setMove(null), onError: () => setMove(null),
  });
  const doSchedule = useSend((v) => api.post('/interviews', v), { invalidate: refresh, success: 'Interview scheduled.', onSuccess: () => setSched(null) });

  if (q.isLoading) return <LoadingState lines={5} />;
  if (q.isError) return <ErrorState error={q.error} onRetry={q.refetch} />;
  const items = q.data.items.filter((a) => a.status !== 'withdrawn');
  if (items.length === 0) return <EmptyState title="No applications yet" description="Applications will appear here as students apply." />;

  return (
    <>
      <Alert severity="info" sx={{ mb: 2 }}>Statuses are always set by people. AI ranking never moves a candidate.</Alert>
      <Box sx={{ display: 'grid', gridAutoFlow: 'column', gridAutoColumns: 'minmax(250px, 1fr)', gap: 2, overflowX: 'auto', pb: 1 }}>
        {COLUMNS.map((col) => {
          const colItems = items.filter((a) => a.status === col);
          return (
            <Box key={col} sx={{ bgcolor: 'var(--tb-canvas)', border: '1px solid var(--tb-border)', borderRadius: 3, p: 1.5 }} role="group" aria-label={`${titleCase(col)} column`}>
              <Stack direction="row" justifyContent="space-between" sx={{ mb: 1.5 }}>
                <Typography fontWeight={700}>{titleCase(col)}</Typography>
                <Chip size="small" label={colItems.length} />
              </Stack>
              <Stack spacing={1.25}>
                {colItems.map((a) => <PipelineCard key={a.id} app={a} onMove={(app, status) => setMove({ app, status })} onSchedule={(app) => { setSched(app); setForm({ roundName: '', scheduledAt: '', mode: 'online', venueOrLink: '', notes: '' }); }} />)}
                {colItems.length === 0 && <Typography variant="body2" color="text.secondary">Empty</Typography>}
              </Stack>
            </Box>
          );
        })}
      </Box>

      <ConfirmDialog
        open={!!move} title={move ? `Move ${move.app.studentName} to ${titleCase(move.status)}?` : ''}
        message="The student will be notified and this decision is recorded in the audit log."
        inputLabel="Note for the record (optional)" confirmLabel="Confirm" danger={move?.status === 'rejected'} loading={doMove.isPending}
        onClose={() => setMove(null)} onConfirm={(note) => doMove.mutate({ app: move.app, status: move.status, note })}
      />
      <ConfirmDialog
        open={!!sched} title={sched ? `Schedule interview for ${sched.studentName}` : ''} confirmLabel="Schedule" loading={doSchedule.isPending}
        onClose={() => setSched(null)}
        onConfirm={() => doSchedule.mutate({ applicationId: sched.id, roundName: form.roundName, scheduledAt: fromLocalInput(form.scheduledAt), mode: form.mode, venueOrLink: form.venueOrLink || undefined, notes: form.notes || undefined })}
      >
        <Stack spacing={2} sx={{ mt: 1 }}>
          <TextField label="Round name" value={form.roundName} onChange={(e) => setForm({ ...form, roundName: e.target.value })} required />
          <TextField label="Date & time" type="datetime-local" value={form.scheduledAt} onChange={(e) => setForm({ ...form, scheduledAt: e.target.value })} slotProps={{ inputLabel: { shrink: true } }} required />
          <TextField select label="Mode" value={form.mode} onChange={(e) => setForm({ ...form, mode: e.target.value })}><MenuItem value="online">Online</MenuItem><MenuItem value="offline">Offline</MenuItem></TextField>
          <TextField label={form.mode === 'online' ? 'Meeting link' : 'Venue'} value={form.venueOrLink} onChange={(e) => setForm({ ...form, venueOrLink: e.target.value })} />
          <TextField label="Notes" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} multiline minRows={2} />
        </Stack>
      </ConfirmDialog>
    </>
  );
}

// ---------------------------------------------------------------- eligibility report
function EligibilityReport({ driveId }) {
  const [status, setStatus] = useState('');
  const q = useGet(`/drives/${driveId}/eligibility-report`, { status: status || undefined });
  if (q.isLoading) return <LoadingState lines={5} />;
  if (q.isError) return <ErrorState error={q.error} onRetry={q.refetch} />;
  const { summary, failedBy, students } = q.data;
  return (
    <Stack spacing={2.5}>
      <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap role="group" aria-label="Eligibility filter">
        {[['', `All (${summary.total})`], ['eligible', `Eligible (${summary.eligible})`], ['ineligible', `Not eligible (${summary.ineligible})`], ['incomplete', `Incomplete (${summary.incomplete})`]].map(([v, l]) => (
          <Chip key={v} label={l} clickable color={status === v ? 'primary' : 'default'} onClick={() => setStatus(v)} />
        ))}
      </Stack>
      {Object.keys(failedBy).length > 0 && (
        <Typography variant="body2" color="text.secondary">
          Students failing by criterion: {Object.entries(failedBy).map(([k, n]) => `${k} (${n})`).join(', ')}
        </Typography>
      )}
      <DataTable
        dense caption="Eligibility report" rows={students} getRowId={(r) => r.studentId} emptyTitle="No students in this view"
        columns={[
          { key: 'name', label: 'Student', sortable: true, render: (r) => <RouterLink to={`/placement/students/${r.studentId}`}>{r.name}</RouterLink> },
          { key: 'department', label: 'Dept.' },
          { key: 'cgpa', label: 'CGPA', align: 'right', sortable: true },
          { key: 'verification', label: 'Verification', render: (r) => <VerificationBadge value={r.verification} /> },
          { key: 'eligibility', label: 'Eligibility', render: (r) => <EligibilityBadge value={r.eligibility} /> },
          { key: 'reasons', label: 'Why', render: (r) => (r.reasons.length ? r.reasons.join('; ') : '—') },
        ]}
      />
    </Stack>
  );
}

// ---------------------------------------------------------------- ranking
function Ranking({ driveId }) {
  const toast = useToast();
  const [pool, setPool] = useState('applicants');
  const [withAi, setWithAi] = useState(false);
  const [open, setOpen] = useState(null);
  const [manual, setManual] = useState(null); // { base, ids } user reordering of one specific run
  const run = useSend((force) => api.post(`/ai/ranking/${driveId}`, { pool, ai: withAi, force: !!force }), { invalidate: ['/applications'] });
  const save = useSend((ids) => api.put('/applications/order', { driveId, applicationIds: ids }), { invalidate: ['/applications'], success: 'Your order was saved and will be used for this drive.' });

  const data = run.data;
  const computed = data ? data.candidates.map((c) => c.studentId) : null;
  const order = manual && manual.base === data ? manual.ids : computed;
  const setOrder = (ids) => setManual({ base: data, ids });

  const byId = new Map((data?.candidates ?? []).map((c) => [c.studentId, c]));
  const ordered = order ? order.map((id) => byId.get(id)).filter(Boolean) : [];
  const move = (i, d) => {
    const next = [...order];
    const j = i + d;
    if (j < 0 || j >= next.length) return;
    [next[i], next[j]] = [next[j], next[i]];
    setOrder(next);
  };

  return (
    <Stack spacing={2.5}>
      <Alert severity="info" icon={false}>
        <strong>Decision support only.</strong> This ranks candidates by verified eligibility and an explainable match score. It never accepts, rejects or shortlists anyone, and you can reorder the list.
      </Alert>
      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} alignItems={{ sm: 'center' }}>
        <TextField select label="Candidate pool" value={pool} onChange={(e) => setPool(e.target.value)} sx={{ minWidth: 260 }}>
          <MenuItem value="applicants">Applicants of this drive</MenuItem>
          <MenuItem value="eligible">All eligible, verified students</MenuItem>
        </TextField>
        <FormControlLabel control={<Checkbox checked={withAi} onChange={(e) => setWithAi(e.target.checked)} />} label="Include AI fit analysis (up to 20 candidates, results are saved)" />
        <Button variant="contained" onClick={() => run.mutate(false)} disabled={run.isPending}>{run.isPending ? 'Ranking…' : 'Rank candidates'}</Button>
      </Stack>
      {run.isError && <ErrorState error={run.error} />}
      {data && (
        <>
          {withAi && !data.aiAvailable && <Alert severity="warning">AI is not available, so this ranking uses rules only.</Alert>}
          {data.aiRequested && data.aiAvailable && <AiNotice ai={{ status: data.aiEnriched > 0 ? 'ok' : 'unavailable', reason: 'unavailable', message: 'AI analysis did not complete for any candidate.', cached: true }} />}
          {data.aiSkippedForCap > 0 && <Alert severity="info">{data.aiSkippedForCap} more candidate(s) were not AI-analysed (limit 20 per run). Run again to continue.</Alert>}
          {ordered.length === 0 ? <EmptyState title="No candidates" description="There are no candidates in this pool yet." /> : (
            <>
              <Stack spacing={1.5}>
                {ordered.map((c, i) => (
                  <Box key={c.studentId} sx={{ border: '1px solid var(--tb-border)', borderRadius: 3, p: 2, bgcolor: '#fff' }}>
                    <Stack direction="row" spacing={2} alignItems="center">
                      <Typography variant="h6" sx={{ width: 32, textAlign: 'center' }}>{i + 1}</Typography>
                      <ScoreRing value={c.matchScore} size={64} label={`${c.name} match score`} ai={c.aiAssisted} />
                      <Box sx={{ flexGrow: 1, minWidth: 0 }}>
                        <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
                          <Typography component={RouterLink} to={`/placement/students/${c.studentId}`} fontWeight={700} sx={{ color: 'inherit', textDecoration: 'none' }}>{c.name}</Typography>
                          <EligibilityBadge value={c.eligibility} />
                          {c.viaException && <Pill tone="warning">Exception</Pill>}
                          {c.aiAssisted ? <AiBadge label="AI-assisted" /> : <RuleBadge />}
                          {c.applicationStatus && <ApplicationStatusBadge value={c.applicationStatus} />}
                        </Stack>
                        <Typography variant="body2" color="text.secondary">{c.department ?? '—'} · CGPA {c.cgpa ?? '—'} · {c.matchNote}</Typography>
                      </Box>
                      <Stack direction="row">
                        <IconButton aria-label={`Move ${c.name} up`} onClick={() => move(i, -1)} disabled={i === 0 || !c.applicationId}><ArrowUpwardIcon /></IconButton>
                        <IconButton aria-label={`Move ${c.name} down`} onClick={() => move(i, 1)} disabled={i === ordered.length - 1 || !c.applicationId}><ArrowDownwardIcon /></IconButton>
                        <Button size="small" onClick={() => setOpen(open === c.studentId ? null : c.studentId)} aria-expanded={open === c.studentId}>Why</Button>
                      </Stack>
                    </Stack>
                    <Collapse in={open === c.studentId} unmountOnExit>
                      <Box sx={{ mt: 2, pl: { sm: 6 } }}>
                        <Stack component="ul" sx={{ m: 0, pl: 2.5 }}>{c.reasons.map((r, k) => <li key={k}><Typography variant="body2">{r}</Typography></li>)}</Stack>
                        <Stack spacing={0.75} sx={{ mt: 1.5 }}>
                          {c.components.map((k) => (
                            <Typography key={k.key} variant="body2" color={k.available ? 'text.primary' : 'text.secondary'}>
                              {k.label}: {k.available ? `${Math.round(k.score)}/100 (counts ${k.effectiveWeight}%)` : 'not counted'} {k.source === 'ai' && <AiBadge />}
                            </Typography>
                          ))}
                        </Stack>
                        <Typography variant="body2" sx={{ mt: 1 }}><strong>Skills matched:</strong> {c.matchedSkills.join(', ') || 'none'} · <strong>missing:</strong> {c.missingSkills.join(', ') || 'none'}</Typography>
                      </Box>
                    </Collapse>
                  </Box>
                ))}
              </Stack>
              <Stack direction="row" spacing={1.5}>
                <Button variant="contained" disabled={save.isPending || !ordered.some((c) => c.applicationId)}
                  onClick={() => save.mutate(ordered.filter((c) => c.applicationId).map((c) => c.applicationId))}>Save my order</Button>
                <Button color="inherit" onClick={() => { toast.info('Order reset to the computed ranking.'); setManual(null); }}>Reset order</Button>
              </Stack>
            </>
          )}
        </>
      )}
    </Stack>
  );
}

// ---------------------------------------------------------------- report
function Report({ driveId }) {
  const toast = useToast();
  const q = useGet(`/drives/${driveId}/report`);
  if (q.isLoading) return <LoadingState lines={4} />;
  if (q.isError) return <ErrorState error={q.error} onRetry={q.refetch} />;
  const r = q.data;
  const download = async () => {
    try {
      await api.download(`/drives/${driveId}/report.csv`, null, `drive-report.csv`);
    } catch (e) {
      toast.error(e.message);
    }
  };
  return (
    <Stack spacing={3}>
      <div className="row g-3">
        <div className="col-6 col-md-3"><StatCard label="Applicants" value={r.totals.applicants} /></div>
        <div className="col-6 col-md-3"><StatCard label="Shortlisted+" value={r.totals.shortlisted} tone="lilac" /></div>
        <div className="col-6 col-md-3"><StatCard label="Selected" value={r.totals.selected} tone="teal" /></div>
        <div className="col-6 col-md-3"><StatCard label="Not selected" value={r.totals.rejected} tone="amber" /></div>
      </div>
      <SurfaceCard title="By department" action={<Button startIcon={<DownloadIcon />} onClick={download}>Export CSV</Button>}>
        <SimpleBarChart
          data={r.byDepartment} xKey="department" label="Applicants, shortlisted and selected by department" emptyText="No applicants yet."
          series={[{ key: 'applicants', label: 'Applicants', color: CHART_COLORS.indigo }, { key: 'shortlisted', label: 'Shortlisted+', color: CHART_COLORS.lilac }, { key: 'selected', label: 'Selected', color: CHART_COLORS.teal }]}
        />
      </SurfaceCard>
    </Stack>
  );
}

// ---------------------------------------------------------------- page
export default function PlacementDriveDetail() {
  const { id } = useParams();
  const [tab, setTab] = useState('overview');
  const [action, setAction] = useState(null);
  const [extend, setExtend] = useState(false);
  const [newDeadline, setNewDeadline] = useState('');
  const q = useGet(`/drives/${id}`);
  const refresh = ['/drives', '/analytics', '/applications'];
  const setStatus = useSend((status) => api.post(`/drives/${id}/status`, { status }), { invalidate: refresh, success: 'Drive updated.', onSuccess: () => setAction(null), onError: () => setAction(null) });
  const doExtend = useSend((body) => api.post(`/drives/${id}/extend-deadline`, body), { invalidate: refresh, success: 'Deadline extended (recorded in the audit log).', onSuccess: () => setExtend(false) });

  if (q.isLoading) return <LoadingState lines={6} />;
  if (q.isError) return <ErrorState error={q.error} onRetry={q.refetch} />;
  const d = q.data;
  const e = d.eligibility;
  const locked = ['completed', 'cancelled'].includes(d.status);

  return (
    <>
      <PageHeader
        back="/placement/drives" title={d.title} subtitle={`${d.companyName} · deadline ${fmtDateTime(d.deadline)}`}
        actions={
          <>
            <DriveStatusBadge value={d.status} />
            {!locked && <Button component={RouterLink} to={`/placement/drives/${id}/edit`}>Edit</Button>}
            {!locked && <Button onClick={() => { setNewDeadline(''); setExtend(true); }}>Extend deadline</Button>}
            {DRIVE_ACTIONS[d.status].map((s) => (
              <Button key={s} variant={s === 'open' ? 'contained' : 'outlined'} color={s === 'cancelled' ? 'error' : 'primary'} onClick={() => setAction(s)}>{ACTION_LABEL[s]}</Button>
            ))}
          </>
        }
      />
      <Tabs value={tab} onChange={(_, v) => setTab(v)} variant="scrollable" scrollButtons="auto" sx={{ mb: 3 }}>
        <Tab value="overview" label="Overview" />
        <Tab value="pipeline" label={`Pipeline (${d.applicationCount})`} />
        <Tab value="eligibility" label="Eligibility report" />
        <Tab value="ranking" label="Candidate ranking" />
        <Tab value="report" label="Hiring report" />
      </Tabs>

      {tab === 'overview' && (
        <div className="row g-3">
          <div className="col-12 col-lg-7">
            <SurfaceCard title="Details">
              <Stack direction="row" spacing={0.75} flexWrap="wrap" useFlexGap sx={{ mb: 2 }}>
                <Chip size="small" label={titleCase(d.jobType)} />
                {d.packageLpa != null && <Chip size="small" label={`${d.packageLpa} LPA`} />}
                {d.stipendPerMonth != null && <Chip size="small" label={`${fmtINR(d.stipendPerMonth)}/mo`} />}
                {d.openings != null && <Chip size="small" label={`${d.openings} openings`} />}
                {d.location && <Chip size="small" label={d.location} />}
              </Stack>
              <Typography sx={{ whiteSpace: 'pre-wrap' }}>{d.description || 'No description.'}</Typography>
              {d.originalDeadline && new Date(d.originalDeadline).getTime() !== new Date(d.deadline).getTime() && (
                <Alert severity="info" sx={{ mt: 2 }}>Deadline was extended from {fmtDateTime(d.originalDeadline)}.</Alert>
              )}
            </SurfaceCard>
          </div>
          <div className="col-12 col-lg-5">
            <Stack spacing={3}>
              <SurfaceCard title="Eligibility criteria" action={<RuleBadge />}>
                <Stack spacing={0.75}>
                  <Typography variant="body2">Minimum CGPA: <strong>{e.minCgpa ?? 'not applied'}</strong></Typography>
                  <Typography variant="body2">Max active backlogs: <strong>{e.maxBacklogs ?? 'not applied'}</strong></Typography>
                  <Typography variant="body2">Departments: <strong>{e.allowedDepartments.length ? e.allowedDepartments.join(', ') : 'all'}</strong></Typography>
                  <Typography variant="body2">Batches: <strong>{e.allowedYears.length ? e.allowedYears.join(', ') : 'all'}</strong></Typography>
                  <Typography variant="body2">Minimum 10th %: <strong>{e.minTenthPercent ?? 'not applied'}</strong></Typography>
                  <Typography variant="body2">Minimum 12th %: <strong>{e.minTwelfthPercent ?? 'not applied'}</strong></Typography>
                </Stack>
              </SurfaceCard>
              <SurfaceCard title="Required skills">
                {d.skills.length === 0 ? <Typography color="text.secondary">None listed.</Typography> : (
                  <Stack direction="row" spacing={0.75} flexWrap="wrap" useFlexGap>
                    {d.skills.map((s) => <Chip key={s.skill} size="small" label={`${s.skill}${s.importance === 'preferred' ? ' (preferred)' : ''}`} variant={s.importance === 'preferred' ? 'outlined' : 'filled'} />)}
                  </Stack>
                )}
              </SurfaceCard>
            </Stack>
          </div>
        </div>
      )}
      {tab === 'pipeline' && <Pipeline driveId={id} />}
      {tab === 'eligibility' && <EligibilityReport driveId={id} />}
      {tab === 'ranking' && <Ranking driveId={id} />}
      {tab === 'report' && <Report driveId={id} />}

      <ConfirmDialog
        open={!!action} title={action ? ACTION_LABEL[action] : ''} confirmLabel="Confirm" danger={action === 'cancelled'} loading={setStatus.isPending}
        message={action === 'open' ? 'Eligible students will be notified.' : action === 'cancelled' ? 'This cannot be undone.' : 'You can still view applications afterwards.'}
        onClose={() => setAction(null)} onConfirm={() => setStatus.mutate(action)}
      />
      <ConfirmDialog
        open={extend} title="Extend application deadline" confirmLabel="Extend" loading={doExtend.isPending}
        message="Extending the deadline applies to everyone and is recorded in the audit log with your reason."
        inputLabel="Reason" inputRequired minLength={5} onClose={() => setExtend(false)}
        onConfirm={(reason) => newDeadline && doExtend.mutate({ deadline: fromLocalInput(newDeadline), reason })}
      >
        <TextField label="New deadline" type="datetime-local" value={newDeadline} onChange={(e) => setNewDeadline(e.target.value)} slotProps={{ inputLabel: { shrink: true } }} sx={{ mb: 2 }} required />
      </ConfirmDialog>
    </>
  );
}
