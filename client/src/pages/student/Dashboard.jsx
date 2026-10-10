import { Alert, Box, Button, Chip, LinearProgress, Typography } from '@mui/material';
import { Stack } from '../../components/layout.jsx';
import SchoolIcon from '@mui/icons-material/School';
import SendIcon from '@mui/icons-material/Send';
import EventIcon from '@mui/icons-material/Event';
import WorkIcon from '@mui/icons-material/Work';
import { Link as RouterLink } from 'react-router-dom';
import { useGet } from '../../api/hooks.js';
import { AiBadge, ApplicationStatusBadge, EligibilityBadge, RuleBadge, VerificationBadge } from '../../components/badges.jsx';
import { PageHeader, StatCard, SurfaceCard } from '../../components/cards.jsx';
import { EmptyState, ErrorState, LoadingState } from '../../components/feedback.jsx';
import { ScoreBreakdown, ScoreRing } from '../../components/score.jsx';
import { useAuth } from '../../auth/AuthContext.jsx';
import { fmtDate, fmtDateTime, relativeDeadline } from '../../lib/format.js';

export default function StudentDashboard() {
  const { user } = useAuth();
  const me = useGet('/students/me');
  const readiness = useGet('/ai/readiness');
  const recs = useGet('/ai/recommendations');
  const apps = useGet('/applications/mine');
  const interviews = useGet('/interviews/mine');
  const analysis = useGet('/ai/resume/analysis');
  const drives = useGet('/drives', { pageSize: 50, status: 'open' });

  if (me.isLoading) return <LoadingState lines={6} />;
  if (me.isError) return <ErrorState error={me.error} onRetry={me.refetch} />;
  const p = me.data;
  const upcomingInterviews = (interviews.data ?? []).filter((i) => i.status === 'scheduled' && new Date(i.scheduledAt) > new Date());
  const deadlines = [...(drives.data?.items ?? [])]
    .filter((d) => new Date(d.deadline) > new Date())
    .sort((a, b) => new Date(a.deadline) - new Date(b.deadline))
    .slice(0, 5);
  const a = analysis.data?.analysis;

  return (
    <>
      <PageHeader title={`Hello, ${user.fullName.split(' ')[0]}`} subtitle="Your placement readiness at a glance." />

      {p.verification.status !== 'verified' && (
        <Alert
          severity={p.verification.status === 'needs_changes' ? 'warning' : 'info'}
          sx={{ mb: 3 }}
          action={<Button color="inherit" size="small" component={RouterLink} to="/student/profile">Update profile</Button>}
        >
          {p.verification.status === 'needs_changes'
            ? `Your placement cell asked for changes: ${p.verification.comment ?? 'please review your profile.'}`
            : 'Your profile is waiting to be verified by your placement cell. You can explore drives now, but you can only apply once it is verified.'}
        </Alert>
      )}

      <div className="row g-3 mb-3">
        <div className="col-6 col-lg-3"><StatCard label="Profile complete" value={`${p.completion.percent}%`} icon={<SchoolIcon />} /></div>
        <div className="col-6 col-lg-3"><StatCard label="Open applications" value={(apps.data ?? []).filter((x) => !['withdrawn', 'rejected', 'selected'].includes(x.status)).length} icon={<SendIcon />} tone="teal" /></div>
        <div className="col-6 col-lg-3"><StatCard label="Upcoming interviews" value={upcomingInterviews.length} icon={<EventIcon />} tone="lilac" /></div>
        <div className="col-6 col-lg-3"><StatCard label="Open drives" value={drives.data?.total ?? '—'} icon={<WorkIcon />} tone="amber" /></div>
      </div>

      <div className="row g-3">
        <div className="col-12 col-xl-7">
          <SurfaceCard title="Placement readiness" subtitle="Every component shows its weight, evidence and reason." action={<RuleBadge label="Rules + AI" title="Most parts are rule-based; resume quality comes from AI." />}>
            {readiness.isLoading && <LoadingState lines={4} />}
            {readiness.isError && <ErrorState error={readiness.error} onRetry={readiness.refetch} />}
            {readiness.data && <ScoreBreakdown result={readiness.data} totalLabel="Placement readiness" />}
          </SurfaceCard>
        </div>

        <div className="col-12 col-xl-5">
          <Stack spacing={3}>
            <SurfaceCard title="Profile completion" action={<VerificationBadge value={p.verification.status} />}>
              <LinearProgress variant="determinate" value={p.completion.percent} aria-label="Profile completion" sx={{ height: 10, borderRadius: 5, mb: 1.5 }} />
              {p.completion.missing.length === 0 ? (
                <Typography color="text.secondary">Your profile is complete.</Typography>
              ) : (
                <>
                  <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>Still missing:</Typography>
                  <Stack direction="row" spacing={0.75} flexWrap="wrap" useFlexGap>
                    {p.completion.missing.slice(0, 8).map((m) => <Chip key={m.key} size="small" label={m.label} variant="outlined" />)}
                  </Stack>
                  <Button component={RouterLink} to="/student/profile" size="small" sx={{ mt: 1.5 }}>Complete profile</Button>
                </>
              )}
            </SurfaceCard>

            <SurfaceCard title="Resume feedback" ai action={<AiBadge />}>
              {analysis.isLoading && <LoadingState lines={2} />}
              {analysis.data && !a && (
                <Typography color="text.secondary">
                  {analysis.data.reason === 'no_resume' ? 'Upload your resume to get AI feedback.' : analysis.data.reason === 'resume_unreadable' ? 'Your resume could not be read. Upload a text-based PDF or DOCX.' : 'Run the AI review to see your resume score and tips.'}{' '}
                  <Button size="small" component={RouterLink} to="/student/resume">Open resume</Button>
                </Typography>
              )}
              {a && (
                <Stack direction="row" spacing={2} alignItems="flex-start">
                  <ScoreRing value={a.overallScore} size={88} label="Resume score" ai />
                  <Box sx={{ minWidth: 0 }}>
                    <Typography variant="body2" fontWeight={600}>Top improvement</Typography>
                    <Typography variant="body2" color="text.secondary">{a.improvements[0]?.suggestion ?? 'No suggestions.'}</Typography>
                    <Button size="small" component={RouterLink} to="/student/resume" sx={{ mt: 0.5 }}>See full review</Button>
                  </Box>
                </Stack>
              )}
            </SurfaceCard>
          </Stack>
        </div>

        <div className="col-12 col-lg-6">
          <SurfaceCard title="Recommended drives" subtitle="Ranked by skill match. Eligibility is checked by rules." action={<RuleBadge />}>
            {recs.isLoading && <LoadingState lines={3} />}
            {recs.isError && <ErrorState error={recs.error} onRetry={recs.refetch} />}
            {recs.data && recs.data.recommendations.length === 0 && (
              <EmptyState title="No recommendations yet" description={recs.data.note ?? 'When drives open that you can apply to, they will appear here.'} />
            )}
            <Stack spacing={1.5}>
              {recs.data?.recommendations.slice(0, 4).map((r) => (
                <Box key={r.driveId} sx={{ border: '1px solid var(--tb-border)', borderRadius: 3, p: 1.5 }}>
                  <Stack direction="row" justifyContent="space-between" spacing={1} alignItems="flex-start">
                    <Box sx={{ minWidth: 0 }}>
                      <Typography component={RouterLink} to={`/student/drives/${r.driveId}`} fontWeight={600} sx={{ color: 'inherit', textDecoration: 'none' }}>
                        {r.title}
                      </Typography>
                      <Typography variant="body2" color="text.secondary">{r.companyName} · {relativeDeadline(r.deadline)}</Typography>
                    </Box>
                    <Chip size="small" color="primary" label={`${Math.round(r.matchScore)}% match`} />
                  </Stack>
                  <Typography variant="body2" sx={{ mt: 1 }}>{r.reason}</Typography>
                  <Stack direction="row" spacing={1} sx={{ mt: 1 }}>
                    <EligibilityBadge value={r.eligibility} />
                    {r.alreadyApplied && <Chip size="small" label="Applied" />}
                  </Stack>
                </Box>
              ))}
            </Stack>
            {recs.data?.note && recs.data.recommendations.length > 0 && <Alert severity="info" sx={{ mt: 2 }}>{recs.data.note}</Alert>}
          </SurfaceCard>
        </div>

        <div className="col-12 col-lg-6">
          <Stack spacing={3}>
            <SurfaceCard title="Upcoming deadlines" action={<Button size="small" component={RouterLink} to="/student/drives">All drives</Button>}>
              {deadlines.length === 0 ? (
                <Typography color="text.secondary">No open drives with upcoming deadlines.</Typography>
              ) : (
                <Stack spacing={1.25}>
                  {deadlines.map((d) => (
                    <Stack key={d.id} direction="row" justifyContent="space-between" alignItems="center" spacing={1}>
                      <Box sx={{ minWidth: 0 }}>
                        <Typography component={RouterLink} to={`/student/drives/${d.id}`} fontWeight={600} sx={{ color: 'inherit', textDecoration: 'none' }}>{d.title}</Typography>
                        <Typography variant="body2" color="text.secondary">{d.companyName} · {fmtDate(d.deadline)} · {relativeDeadline(d.deadline)}</Typography>
                      </Box>
                      <EligibilityBadge value={d.eligibilityResult.status} />
                    </Stack>
                  ))}
                </Stack>
              )}
            </SurfaceCard>

            <SurfaceCard title="My applications" action={<Button size="small" component={RouterLink} to="/student/applications">View all</Button>}>
              {(apps.data ?? []).length === 0 ? (
                <Typography color="text.secondary">You have not applied to any drive yet.</Typography>
              ) : (
                <Stack spacing={1.25}>
                  {apps.data.slice(0, 5).map((x) => (
                    <Stack key={x.id} direction="row" justifyContent="space-between" alignItems="center" spacing={1}>
                      <Box sx={{ minWidth: 0 }}>
                        <Typography fontWeight={600} noWrap>{x.driveTitle}</Typography>
                        <Typography variant="body2" color="text.secondary">{x.companyName} · applied {fmtDate(x.appliedAt)}</Typography>
                      </Box>
                      <ApplicationStatusBadge value={x.status} />
                    </Stack>
                  ))}
                </Stack>
              )}
            </SurfaceCard>

            <SurfaceCard title="Interviews" action={<Button size="small" component={RouterLink} to="/student/interviews">Details</Button>}>
              {upcomingInterviews.length === 0 ? (
                <Typography color="text.secondary">No interviews scheduled.</Typography>
              ) : (
                <Stack spacing={1.25}>
                  {upcomingInterviews.slice(0, 3).map((i) => (
                    <Box key={i.id}>
                      <Typography fontWeight={600}>{i.companyName} · {i.roundName}</Typography>
                      <Typography variant="body2" color="text.secondary">{fmtDateTime(i.scheduledAt)} · {i.mode}</Typography>
                    </Box>
                  ))}
                </Stack>
              )}
            </SurfaceCard>
          </Stack>
        </div>
      </div>
    </>
  );
}
