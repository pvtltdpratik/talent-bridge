import { useState } from 'react';
import { Alert, Box, Button, Chip, Typography } from '@mui/material';
import { Stack } from '../../components/layout.jsx';
import OpenInNewIcon from '@mui/icons-material/OpenInNew';
import { useParams } from 'react-router-dom';
import { api } from '../../api/client.js';
import { useGet, useSend } from '../../api/hooks.js';
import { VerificationBadge } from '../../components/badges.jsx';
import { PageHeader, SurfaceCard } from '../../components/cards.jsx';
import { ConfirmDialog } from '../../components/ConfirmDialog.jsx';
import { ErrorState, LoadingState } from '../../components/feedback.jsx';
import { useToast } from '../../components/Toast.jsx';
import { fmtDate, fmtDateTime } from '../../lib/format.js';

const Field = ({ label, value }) => (
  <Box>
    <Typography variant="caption" color="text.secondary">{label}</Typography>
    <Typography fontWeight={500}>{value ?? '—'}</Typography>
  </Box>
);

export default function PlacementStudentDetail() {
  const { id } = useParams();
  const toast = useToast();
  const q = useGet(`/students/${id}`);
  const [dialog, setDialog] = useState(null); // 'verified' | 'needs_changes'
  const verify = useSend((body) => api.patch(`/students/${id}/verification`, body), {
    invalidate: ['/students', '/analytics'], success: 'Verification updated and the student was notified.', onSuccess: () => setDialog(null),
  });

  const openResume = async () => {
    try {
      const { url } = await api.get(`/students/${id}/resume-url`);
      window.open(url, '_blank', 'noopener,noreferrer');
    } catch (e) {
      toast.error(e.message);
    }
  };

  if (q.isLoading) return <LoadingState lines={8} />;
  if (q.isError) return <ErrorState error={q.error} onRetry={q.refetch} />;
  const p = q.data;

  return (
    <>
      <PageHeader
        back="/placement/students" title={p.fullName} subtitle={`${p.email}${p.phone ? ` · ${p.phone}` : ''}`}
        actions={
          <>
            <VerificationBadge value={p.verification.status} />
            <Button variant="outlined" color="warning" onClick={() => setDialog('needs_changes')}>Request changes</Button>
            <Button variant="contained" onClick={() => setDialog('verified')} disabled={p.verification.status === 'verified'}>Verify profile</Button>
          </>
        }
      />
      {p.verification.comment && <Alert severity="info" sx={{ mb: 3 }}>Last comment: {p.verification.comment}{p.verification.verifiedAt ? ` · ${fmtDateTime(p.verification.verifiedAt)}` : ''}</Alert>}

      <div className="row g-3">
        <div className="col-12 col-lg-6">
          <SurfaceCard title="Academics">
            <div className="row g-3">
              <div className="col-6"><Field label="Department" value={p.department} /></div>
              <div className="col-6"><Field label="Roll number" value={p.rollNumber} /></div>
              <div className="col-6"><Field label="Batch" value={p.passingYear} /></div>
              <div className="col-6"><Field label="CGPA" value={p.cgpa} /></div>
              <div className="col-6"><Field label="10th %" value={p.tenthPercent} /></div>
              <div className="col-6"><Field label="12th %" value={p.twelfthPercent} /></div>
              <div className="col-6"><Field label="Active backlogs" value={p.activeBacklogs} /></div>
              <div className="col-6"><Field label="Profile completion" value={`${p.completion.percent}%`} /></div>
            </div>
          </SurfaceCard>
        </div>
        <div className="col-12 col-lg-6">
          <SurfaceCard title="Resume" action={p.resume && <Button size="small" startIcon={<OpenInNewIcon />} onClick={openResume}>Open resume</Button>}>
            {p.resume ? (
              <>
                <Typography fontWeight={500}>{p.resume.fileName} · version {p.resume.version}</Typography>
                <Typography variant="body2" color="text.secondary">Uploaded {fmtDate(p.resume.createdAt)}</Typography>
                {p.resume.extractionStatus === 'failed' && <Alert severity="warning" sx={{ mt: 1.5 }}>Text could not be read from this file ({p.resume.extractionError}).</Alert>}
              </>
            ) : (
              <Typography color="text.secondary">No resume uploaded.</Typography>
            )}
          </SurfaceCard>
        </div>
        <div className="col-12">
          <SurfaceCard title="Skills, interests & links">
            <Stack spacing={2}>
              <Stack direction="row" spacing={0.75} flexWrap="wrap" useFlexGap>
                {p.skills.length ? p.skills.map((s) => <Chip key={s} size="small" label={s} />) : <Typography color="text.secondary">No skills listed.</Typography>}
              </Stack>
              {p.careerInterests.length > 0 && <Typography variant="body2"><strong>Interests:</strong> {p.careerInterests.join(', ')}</Typography>}
              <Stack direction="row" spacing={2} flexWrap="wrap" useFlexGap>
                {['github', 'linkedin', 'portfolio'].map((k) => p.links?.[k] && <a key={k} href={p.links[k]} target="_blank" rel="noopener noreferrer">{k}</a>)}
              </Stack>
            </Stack>
          </SurfaceCard>
        </div>
        <div className="col-12 col-lg-6">
          <SurfaceCard title="Projects">
            {p.projects.length === 0 ? <Typography color="text.secondary">None added.</Typography> : (
              <Stack spacing={1.5}>{p.projects.map((x) => <Box key={x.id}><Typography fontWeight={600}>{x.title}</Typography><Typography variant="body2" color="text.secondary">{x.description}</Typography><Typography variant="caption">{x.tech?.join(' · ')}</Typography></Box>)}</Stack>
            )}
          </SurfaceCard>
        </div>
        <div className="col-12 col-lg-6">
          <SurfaceCard title="Internships & experience">
            {p.experience.length === 0 ? <Typography color="text.secondary">None added.</Typography> : (
              <Stack spacing={1.5}>{p.experience.map((x) => <Box key={x.id}><Typography fontWeight={600}>{[x.role, x.organization].filter(Boolean).join(' · ')}</Typography><Typography variant="body2" color="text.secondary">{x.description}</Typography></Box>)}</Stack>
            )}
          </SurfaceCard>
        </div>
      </div>

      <ConfirmDialog
        open={dialog === 'verified'} title="Verify this profile?" confirmLabel="Verify" loading={verify.isPending}
        message="Confirm that the academic details match the student's records. They will be able to apply to drives."
        inputLabel="Comment (optional)" onClose={() => setDialog(null)} onConfirm={(comment) => verify.mutate({ status: 'verified', comment: comment || undefined })}
      />
      <ConfirmDialog
        open={dialog === 'needs_changes'} title="Request changes" confirmLabel="Send to student" loading={verify.isPending}
        message="Tell the student what to fix. They will be notified."
        inputLabel="What needs to change?" inputRequired onClose={() => setDialog(null)} onConfirm={(comment) => verify.mutate({ status: 'needs_changes', comment })}
      />
    </>
  );
}
