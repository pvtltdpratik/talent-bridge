import { useState } from 'react';
import { Alert, AlertTitle, Box, Button, Chip, Table, TableBody, TableCell, TableHead, TableRow, Typography } from '@mui/material';
import { Stack } from '../../components/layout.jsx';
import { useParams } from 'react-router-dom';
import { api } from '../../api/client.js';
import { useGet, useSend } from '../../api/hooks.js';
import { AiNotice } from '../../components/AiPanel.jsx';
import { AiBadge, ApplicationStatusBadge, CriterionBadge, DriveStatusBadge, EligibilityBadge, ExceptionStatusBadge, Pill, RuleBadge } from '../../components/badges.jsx';
import { PageHeader, SurfaceCard } from '../../components/cards.jsx';
import { ConfirmDialog } from '../../components/ConfirmDialog.jsx';
import { ErrorState, LoadingState } from '../../components/feedback.jsx';
import { ScoreBreakdown, SkillChips } from '../../components/score.jsx';
import { fmtDate, fmtDateTime, fmtINR, relativeDeadline, titleCase } from '../../lib/format.js';

const show = (v) => (Array.isArray(v) ? v.join(', ') : v ?? '—');

export default function StudentDriveDetail() {
  const { id } = useParams();
  const drive = useGet(`/drives/${id}`);
  const match = useGet(`/ai/match/${id}`);
  const gap = useGet(`/ai/skill-gap/${id}`);
  const questions = useGet(`/ai/interview-questions/${id}`);
  const [confirmApply, setConfirmApply] = useState(false);
  const [exceptionOpen, setExceptionOpen] = useState(false);

  const refresh = ['/drives', '/applications', '/exceptions', '/ai/'];
  const apply = useSend(() => api.post('/applications', { driveId: id }), { invalidate: refresh, success: 'Application submitted.', onSuccess: () => setConfirmApply(false), onError: () => setConfirmApply(false) });
  const requestException = useSend((reason) => api.post('/exceptions', { driveId: id, reason }), { invalidate: refresh, success: 'Exception request sent to your placement cell.', onSuccess: () => setExceptionOpen(false) });
  const withdrawEx = useSend((exId) => api.post(`/exceptions/${exId}/withdraw`), { invalidate: refresh, success: 'Request withdrawn.' });
  const runMatch = useSend((force) => api.post(`/ai/match/${id}`, { force }), { invalidate: ['/ai/'] });
  const runGap = useSend((force) => api.post('/ai/skill-gap', { driveId: id, force }), { invalidate: ['/ai/'] });
  const runQuestions = useSend((force) => api.post('/ai/interview-questions', { driveId: id, force }), { invalidate: ['/ai/'] });

  if (drive.isLoading) return <LoadingState lines={8} />;
  if (drive.isError) return <ErrorState error={drive.error} onRetry={drive.refetch} />;
  const d = drive.data;
  const ev = d.eligibilityResult;
  const m = (runMatch.data ?? match.data)?.match;
  const matchAi = (runMatch.data ?? match.data)?.ai;
  const gapData = runGap.data ?? gap.data;
  const qData = runQuestions.data ?? questions.data;

  return (
    <>
      <PageHeader
        back="/student/drives" title={d.title} subtitle={`${d.companyName}${d.location ? ` · ${d.location}` : ''}`}
        actions={<><DriveStatusBadge value={d.status} />{d.application && <ApplicationStatusBadge value={d.application.status} />}</>}
      />

      <div className="row g-3">
        <div className="col-12 col-xl-7">
          <Stack spacing={3}>
            <SurfaceCard title="About this drive">
              <Stack direction="row" spacing={0.75} flexWrap="wrap" useFlexGap sx={{ mb: 2 }}>
                <Chip label={titleCase(d.jobType)} size="small" />
                {d.packageLpa != null && <Chip label={`${d.packageLpa} LPA`} size="small" />}
                {d.stipendPerMonth != null && <Chip label={`${fmtINR(d.stipendPerMonth)} / month`} size="small" />}
                {d.openings != null && <Chip label={`${d.openings} openings`} size="small" />}
              </Stack>
              <Typography sx={{ whiteSpace: 'pre-wrap' }}>{d.description || 'No description provided.'}</Typography>
              <Typography variant="body2" color="text.secondary" sx={{ mt: 2 }}>
                Application deadline: <strong>{fmtDateTime(d.deadline)}</strong> ({relativeDeadline(d.deadline)})
                {d.driveDate && <> · Drive date: <strong>{fmtDate(d.driveDate)}</strong></>}
              </Typography>
              {d.skills.length > 0 && (
                <Box sx={{ mt: 2 }}>
                  <Typography fontWeight={600} sx={{ mb: 0.5 }}>Required skills</Typography>
                  <Stack direction="row" spacing={0.75} flexWrap="wrap" useFlexGap>
                    {d.skills.map((s) => <Chip key={s.skill} size="small" label={`${s.skill}${s.importance === 'preferred' ? ' (preferred)' : ''}`} variant={s.importance === 'preferred' ? 'outlined' : 'filled'} />)}
                  </Stack>
                </Box>
              )}
            </SurfaceCard>

            <SurfaceCard title="Your eligibility" subtitle="Checked by fixed rules, never by AI." action={<Stack direction="row" spacing={1}><RuleBadge /><EligibilityBadge value={ev.status} /></Stack>}>
              <Alert severity={ev.status === 'eligible' ? 'success' : ev.status === 'ineligible' ? 'error' : 'warning'} sx={{ mb: 2 }}>{ev.summary}</Alert>
              <Box sx={{ overflowX: 'auto' }}>
                <Table size="small" aria-label="Eligibility criteria">
                  <TableHead>
                    <TableRow><TableCell>Criterion</TableCell><TableCell>Required</TableCell><TableCell>Yours</TableCell><TableCell>Result</TableCell></TableRow>
                  </TableHead>
                  <TableBody>
                    {ev.criteria.map((c) => (
                      <TableRow key={c.key}>
                        <TableCell>{c.label}</TableCell>
                        <TableCell>{c.state === 'not_applied' ? '—' : show(c.required)}</TableCell>
                        <TableCell>{show(c.actual)}</TableCell>
                        <TableCell>
                          <CriterionBadge value={c.state} />
                          {(c.state === 'fail' || c.state === 'unavailable') && <Typography variant="caption" display="block" color="text.secondary">{c.reason}</Typography>}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </Box>
            </SurfaceCard>

            <SurfaceCard title="How well you match" subtitle="Skills match is rule-based. Role and project fit come from AI." action={<Pill tone="neutral">Rules + AI</Pill>}>
              {m ? (
                <Stack spacing={2.5}>
                  <ScoreBreakdown result={m} totalLabel="Match score" />
                  <SkillChips matched={m.matchedSkills} missing={m.missingSkills} />
                </Stack>
              ) : (
                <LoadingState lines={3} />
              )}
              <Box sx={{ mt: 2 }}>
                <AiNotice ai={matchAi} onRun={() => runMatch.mutate(matchAi?.status === 'ok')} running={runMatch.isPending} runLabel="Analyse my fit with AI" />
              </Box>
            </SurfaceCard>
          </Stack>
        </div>

        <div className="col-12 col-xl-5">
          <Stack spacing={3}>
            <SurfaceCard title="Apply">
              {d.application ? (
                <Alert severity="success">
                  You applied on {fmtDate(d.application.appliedAt)}{d.application.viaException ? ' through an approved exception' : ''}. Current status: <strong>{titleCase(d.application.status)}</strong>.
                </Alert>
              ) : (
                <Stack spacing={2}>
                  {d.verificationStatus !== 'verified' && (
                    <Alert severity="info"><AlertTitle>Profile not verified</AlertTitle>Your placement cell must verify your profile before you can apply.</Alert>
                  )}
                  {d.status !== 'open' && <Alert severity="warning">This drive is {d.status}; applications are not being accepted.</Alert>}
                  <Button variant="contained" size="large" disabled={!d.canApply || apply.isPending} onClick={() => setConfirmApply(true)}>
                    {d.exception?.status === 'approved' ? 'Apply (exception approved)' : 'Apply now'}
                  </Button>
                  {apply.isError && <Alert severity="error">{apply.error.message}</Alert>}
                </Stack>
              )}
            </SurfaceCard>

            {(d.canRequestException || d.exception) && (
              <SurfaceCard title="Exception request" subtitle="Ask the placement cell to consider you despite a rule. A request alone never makes you eligible.">
                {d.exception ? (
                  <Stack spacing={1.5}>
                    <Stack direction="row" spacing={1} alignItems="center"><ExceptionStatusBadge value={d.exception.status} /></Stack>
                    <Typography variant="body2"><strong>Your reason:</strong> {d.exception.reason}</Typography>
                    {d.exception.decisionNote && <Typography variant="body2"><strong>Decision note:</strong> {d.exception.decisionNote}</Typography>}
                    {d.exception.status === 'pending' && <Button color="inherit" onClick={() => withdrawEx.mutate(d.exception.id)} disabled={withdrawEx.isPending}>Withdraw request</Button>}
                    {d.canRequestException && <Button variant="outlined" onClick={() => setExceptionOpen(true)}>Submit a new request</Button>}
                  </Stack>
                ) : (
                  <Button variant="outlined" onClick={() => setExceptionOpen(true)}>Request an exception</Button>
                )}
              </SurfaceCard>
            )}

            <SurfaceCard title="Skill gap & learning plan" ai action={<AiBadge />}>
              {m && (
                <Typography variant="body2" sx={{ mb: 1.5 }}>
                  Missing must-haves: <strong>{m.missingMandatory.length ? m.missingMandatory.map((x) => x.skill).join(', ') : 'none'}</strong>
                </Typography>
              )}
              {gapData?.complete ? (
                <Alert severity="success">You have every skill this drive asks for.</Alert>
              ) : (
                <Stack spacing={2}>
                  <AiNotice ai={gapData?.ai} onRun={() => runGap.mutate(gapData?.ai?.status === 'ok')} running={runGap.isPending} runLabel="Create a learning plan" />
                  {gapData?.plan?.map((p) => (
                    <Box key={p.skill} sx={{ border: '1px solid #ddd2fb', borderRadius: 3, p: 1.5, bgcolor: '#fff' }}>
                      <Stack direction="row" justifyContent="space-between" alignItems="center">
                        <Typography fontWeight={600}>{p.skill}</Typography>
                        <Stack direction="row" spacing={0.75}><Pill tone={p.priority === 'high' ? 'danger' : p.priority === 'medium' ? 'warning' : 'neutral'}>{p.priority} priority</Pill><Chip size="small" label={`~${p.estimatedWeeks} wk`} /></Stack>
                      </Stack>
                      <Stack component="ol" sx={{ m: 0, mt: 1, pl: 2.5 }}>{p.learningSteps.map((s) => <li key={s}><Typography variant="body2">{s}</Typography></li>)}</Stack>
                      {p.resourceTypes.length > 0 && <Typography variant="caption" color="text.secondary">Useful: {p.resourceTypes.join(' · ')}</Typography>}
                    </Box>
                  ))}
                </Stack>
              )}
            </SurfaceCard>

            <SurfaceCard title="Interview practice" ai action={<AiBadge />}>
              <Stack spacing={2}>
                <AiNotice ai={qData?.ai} onRun={() => runQuestions.mutate(qData?.ai?.status === 'ok')} running={runQuestions.isPending} runLabel="Generate practice questions" />
                {qData?.questions && (
                  <>
                    <Box>
                      <Typography fontWeight={600} sx={{ mb: 1 }}>Technical</Typography>
                      <Stack spacing={1.25}>
                        {qData.questions.technical.map((t, i) => (
                          <Box key={i}>
                            <Typography variant="body2"><strong>{i + 1}. {t.question}</strong></Typography>
                            <Typography variant="caption" color="text.secondary">{t.topic} · {t.difficulty}. Good answer: {t.whatGoodLooksLike}</Typography>
                          </Box>
                        ))}
                      </Stack>
                    </Box>
                    <Box>
                      <Typography fontWeight={600} sx={{ mb: 1 }}>HR</Typography>
                      <Stack spacing={1}>
                        {qData.questions.hr.map((h, i) => (
                          <Typography key={i} variant="body2">{i + 1}. {h.question} <Typography component="span" variant="caption" color="text.secondary">({h.whyAsked})</Typography></Typography>
                        ))}
                      </Stack>
                    </Box>
                  </>
                )}
              </Stack>
            </SurfaceCard>
          </Stack>
        </div>
      </div>

      <ConfirmDialog
        open={confirmApply} title="Apply to this drive?" message={`You are applying for ${d.title} at ${d.companyName}. Your current eligibility result is saved with the application.`}
        confirmLabel="Submit application" loading={apply.isPending} onClose={() => setConfirmApply(false)} onConfirm={() => apply.mutate()}
      />
      <ConfirmDialog
        open={exceptionOpen} title="Request an exception" message="Explain why the placement cell should consider you. Be specific and honest; staff see your eligibility result alongside your reason."
        confirmLabel="Send request" inputLabel="Your reason" inputRequired minLength={10} maxLength={1000}
        loading={requestException.isPending} onClose={() => setExceptionOpen(false)} onConfirm={(reason) => requestException.mutate(reason)}
      />
    </>
  );
}

