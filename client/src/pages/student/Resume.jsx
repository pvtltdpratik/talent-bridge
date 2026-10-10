import { useRef, useState } from 'react';
import { Alert, Box, Button, Checkbox, Chip, FormControlLabel, IconButton, Tooltip, Typography } from '@mui/material';
import { Stack } from '../../components/layout.jsx';
import CloudUploadIcon from '@mui/icons-material/CloudUpload';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutlined';
import OpenInNewIcon from '@mui/icons-material/OpenInNew';
import AutoAwesomeIcon from '@mui/icons-material/AutoAwesome';
import { api } from '../../api/client.js';
import { useGet, useSend } from '../../api/hooks.js';
import { AiNotice } from '../../components/AiPanel.jsx';
import { AiBadge, Pill } from '../../components/badges.jsx';
import { PageHeader, SurfaceCard } from '../../components/cards.jsx';
import { ConfirmDialog } from '../../components/ConfirmDialog.jsx';
import { ErrorState, LoadingState } from '../../components/feedback.jsx';
import { ScoreRing } from '../../components/score.jsx';
import { useToast } from '../../components/Toast.jsx';
import { fmtDateTime } from '../../lib/format.js';

const ACCEPT = '.pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document';

function ParsedReview({ parsed, onDone }) {
  const [skills, setSkills] = useState(() => new Set(parsed.skills));
  const [projects, setProjects] = useState(() => new Set(parsed.projects.map((_, i) => i)));
  const [experience, setExperience] = useState(() => new Set(parsed.experience.map((_, i) => i)));
  const [certs, setCerts] = useState(() => new Set(parsed.certifications));
  const toggle = (set, setter, v) => {
    const next = new Set(set);
    if (next.has(v)) next.delete(v);
    else next.add(v);
    setter(next);
  };
  const save = useSend((body) => api.post('/students/me/apply-parsed', body), {
    invalidate: ['/students/me', '/ai/'], success: 'Added to your profile.', onSuccess: onDone,
  });

  const submit = () =>
    save.mutate({
      skills: [...skills],
      certifications: [...certs],
      projects: parsed.projects.filter((_, i) => projects.has(i)).map((p) => ({ title: p.title || 'Untitled project', description: p.description || undefined, tech: p.technologies })),
      experience: parsed.experience.filter((_, i) => experience.has(i)).map((e) => ({ kind: 'internship', organization: e.organization || 'Unknown', role: e.role || undefined, description: e.description || undefined })),
    });

  const nothing = !skills.size && !projects.size && !experience.size && !certs.size;

  return (
    <Stack spacing={2.5}>
      <Alert severity="info" icon={<AutoAwesomeIcon />}>
        The AI read your resume. Untick anything that is wrong before adding it. Nothing is saved to your profile until you confirm.
      </Alert>
      {parsed.skills.length > 0 && (
        <Box>
          <Typography fontWeight={600}>Skills</Typography>
          <Stack direction="row" flexWrap="wrap" useFlexGap>
            {parsed.skills.map((s) => (
              <FormControlLabel key={s} control={<Checkbox size="small" checked={skills.has(s)} onChange={() => toggle(skills, setSkills, s)} />} label={s} />
            ))}
          </Stack>
        </Box>
      )}
      {parsed.projects.length > 0 && (
        <Box>
          <Typography fontWeight={600}>Projects</Typography>
          {parsed.projects.map((p, i) => (
            <FormControlLabel key={i} sx={{ alignItems: 'flex-start', display: 'flex' }}
              control={<Checkbox size="small" checked={projects.has(i)} onChange={() => toggle(projects, setProjects, i)} />}
              label={<Box><Typography fontWeight={500}>{p.title}</Typography><Typography variant="body2" color="text.secondary">{p.description}</Typography><Typography variant="caption" color="text.secondary">{p.technologies.join(' · ')}</Typography></Box>} />
          ))}
        </Box>
      )}
      {parsed.experience.length > 0 && (
        <Box>
          <Typography fontWeight={600}>Experience</Typography>
          {parsed.experience.map((e, i) => (
            <FormControlLabel key={i} sx={{ alignItems: 'flex-start', display: 'flex' }}
              control={<Checkbox size="small" checked={experience.has(i)} onChange={() => toggle(experience, setExperience, i)} />}
              label={<Box><Typography fontWeight={500}>{[e.role, e.organization].filter(Boolean).join(' · ')}</Typography><Typography variant="body2" color="text.secondary">{e.duration} {e.description}</Typography></Box>} />
          ))}
        </Box>
      )}
      {parsed.certifications.length > 0 && (
        <Box>
          <Typography fontWeight={600}>Certifications</Typography>
          <Stack direction="row" flexWrap="wrap" useFlexGap>
            {parsed.certifications.map((c) => (
              <FormControlLabel key={c} control={<Checkbox size="small" checked={certs.has(c)} onChange={() => toggle(certs, setCerts, c)} />} label={c} />
            ))}
          </Stack>
        </Box>
      )}
      <Stack direction="row" spacing={1}>
        <Button variant="contained" onClick={submit} disabled={save.isPending || nothing}>Add selected to my profile</Button>
        <Button color="inherit" onClick={onDone}>Dismiss</Button>
      </Stack>
    </Stack>
  );
}

export default function StudentResume() {
  const toast = useToast();
  const fileRef = useRef(null);
  const resumes = useGet('/students/me/resumes');
  const analysis = useGet('/ai/resume/analysis');
  const parsedQ = useGet('/ai/resume/parsed');
  const [reviewing, setReviewing] = useState(false);
  const [del, setDel] = useState(null);

  const upload = useSend((file) => api.upload('/students/me/resumes', file), {
    invalidate: ['/students/me', '/ai/'],
    onSuccess: (r) => (r.extractionStatus === 'ok' ? toast.success(r.message) : toast.error(r.message)),
  });
  const remove = useSend((id) => api.delete(`/students/me/resumes/${id}`), { invalidate: ['/students/me', '/ai/'], success: 'Resume deleted.', onSuccess: () => setDel(null) });
  const analyze = useSend((force) => api.post('/ai/resume/analyze', { force }), { invalidate: ['/ai/'] });
  const parse = useSend((force) => api.post('/ai/resume/parse', { force }), { invalidate: ['/ai/resume'], onSuccess: (r) => r.parsed && setReviewing(true) });

  const openResume = async (id) => {
    try {
      const { url } = await api.get(`/students/me/resumes/${id}/url`);
      window.open(url, '_blank', 'noopener,noreferrer');
    } catch (e) {
      toast.error(e.message);
    }
  };

  if (resumes.isLoading) return <LoadingState lines={6} />;
  if (resumes.isError) return <ErrorState error={resumes.error} onRetry={resumes.refetch} />;

  const list = resumes.data;
  const active = list.find((r) => r.isActive);
  const readable = active?.extractionStatus === 'ok';
  const a = analysis.data?.analysis;
  const parsed = parse.data?.parsed ?? parsedQ.data?.parsed;

  return (
    <>
      <PageHeader title="Resume & AI review" subtitle="Upload a text-based PDF or DOCX. Only you and your placement cell can open it." />

      <div className="row g-3">
        <div className="col-12 col-xl-5">
          <Stack spacing={3}>
            <SurfaceCard title="Your resume">
              <input ref={fileRef} type="file" accept={ACCEPT} hidden aria-label="Choose resume file"
                onChange={(e) => { const f = e.target.files?.[0]; if (f) upload.mutate(f); e.target.value = ''; }} />
              <Button variant="contained" startIcon={<CloudUploadIcon />} onClick={() => fileRef.current?.click()} disabled={upload.isPending}>
                {upload.isPending ? 'Uploading…' : active ? 'Upload a new version' : 'Upload resume'}
              </Button>
              <Typography variant="caption" color="text.secondary" display="block" sx={{ mt: 1 }}>PDF or DOCX, up to 5 MB. Scanned images cannot be read.</Typography>

              {active && !readable && (
                <Alert severity="warning" sx={{ mt: 2 }}>
                  <strong>This resume could not be read.</strong> {active.extractionError} No score is shown because nothing was read from it.
                </Alert>
              )}
              {list.length === 0 && <Typography sx={{ mt: 2 }} color="text.secondary">No resume uploaded yet.</Typography>}

              <Stack spacing={1} sx={{ mt: 2 }}>
                {list.map((r) => (
                  <Stack key={r.id} direction="row" alignItems="center" spacing={1} sx={{ border: '1px solid var(--tb-border)', borderRadius: 3, p: 1.25 }}>
                    <Box sx={{ flexGrow: 1, minWidth: 0 }}>
                      <Typography fontWeight={600} noWrap>{r.fileName}</Typography>
                      <Typography variant="caption" color="text.secondary">Version {r.version} · {fmtDateTime(r.createdAt)} · {(r.sizeBytes / 1024).toFixed(0)} KB</Typography>
                    </Box>
                    {r.isActive && <Chip size="small" color="primary" label="Active" />}
                    <Tooltip title="Open (link expires in 2 minutes)"><IconButton aria-label={`Open ${r.fileName}`} onClick={() => openResume(r.id)}><OpenInNewIcon /></IconButton></Tooltip>
                    <IconButton aria-label={`Delete ${r.fileName}`} onClick={() => setDel(r)}><DeleteOutlineIcon /></IconButton>
                  </Stack>
                ))}
              </Stack>
            </SurfaceCard>

            {readable && (
              <SurfaceCard title="Add details from your resume" subtitle="Let AI extract skills, projects and experience for you to review." ai action={<AiBadge />}>
                {reviewing && parsed ? (
                  <ParsedReview parsed={parsed} onDone={() => setReviewing(false)} />
                ) : (
                  <Stack spacing={1.5}>
                    <AiNotice
                      ai={parse.data?.ai ?? parsedQ.data?.ai}
                      onRun={() => parse.mutate(false)}
                      running={parse.isPending}
                      runLabel="Extract details"
                      rerunLabel="Extract again"
                    />
                    {parsed && <Button variant="outlined" onClick={() => setReviewing(true)}>Review extracted details</Button>}
                  </Stack>
                )}
              </SurfaceCard>
            )}
          </Stack>
        </div>

        <div className="col-12 col-xl-7">
          <SurfaceCard title="AI resume review" subtitle="Explainable: each part of the score has a reason." ai action={<AiBadge />}>
            {!active && <Typography color="text.secondary">Upload a resume to get a review.</Typography>}
            {active && !readable && <Typography color="text.secondary">Upload a readable (text-based) resume to get a review.</Typography>}
            {readable && (
              <Stack spacing={2.5}>
                <AiNotice
                  ai={analyze.data?.ai ?? analysis.data?.ai}
                  onRun={() => analyze.mutate(a ? true : false)}
                  running={analyze.isPending}
                  runLabel="Analyse my resume"
                />
                {(analyze.isError) && <ErrorState error={analyze.error} />}
                {a && (
                  <>
                    <Stack direction={{ xs: 'column', sm: 'row' }} spacing={3} alignItems={{ sm: 'center' }}>
                      <ScoreRing value={a.overallScore} label="Resume score" ai />
                      <Box>
                        <Typography variant="h6" component="p">{Math.round(a.overallScore)} / 100</Typography>
                        <Typography color="text.secondary">Average of the six components below.</Typography>
                      </Box>
                    </Stack>
                    <Stack spacing={1.5}>
                      {a.components.map((c) => (
                        <Box key={c.key} sx={{ borderTop: '1px solid var(--tb-border)', pt: 1.5 }}>
                          <Stack direction="row" justifyContent="space-between"><Typography fontWeight={600}>{c.label}</Typography><Typography>{c.score}/100</Typography></Stack>
                          <Typography variant="body2" color="text.secondary">{c.reason}</Typography>
                        </Box>
                      ))}
                    </Stack>
                    <div className="row g-3">
                      <div className="col-12 col-md-6">
                        <Typography fontWeight={600} sx={{ mb: 0.5 }}>Strengths</Typography>
                        <Stack component="ul" sx={{ m: 0, pl: 2.5 }}>{a.strengths.map((s) => <li key={s}><Typography variant="body2">{s}</Typography></li>)}</Stack>
                      </div>
                      <div className="col-12 col-md-6">
                        <Typography fontWeight={600} sx={{ mb: 0.5 }}>To improve</Typography>
                        <Stack component="ul" sx={{ m: 0, pl: 2.5 }}>{a.weaknesses.map((s) => <li key={s}><Typography variant="body2">{s}</Typography></li>)}</Stack>
                      </div>
                    </div>
                    {a.missingSkills.length > 0 && (
                      <Box>
                        <Typography fontWeight={600} sx={{ mb: 0.5 }}>Skills worth adding</Typography>
                        <Stack direction="row" spacing={0.75} flexWrap="wrap" useFlexGap>{a.missingSkills.map((s) => <Chip key={s} size="small" label={s} variant="outlined" />)}</Stack>
                      </Box>
                    )}
                    {a.improvements.length > 0 && (
                      <Box>
                        <Typography fontWeight={600} sx={{ mb: 1 }}>Suggested changes</Typography>
                        <Stack spacing={1}>
                          {a.improvements.map((i, idx) => (
                            <Stack key={idx} direction="row" spacing={1} alignItems="flex-start">
                              <Pill tone={i.priority === 'high' ? 'danger' : i.priority === 'medium' ? 'warning' : 'neutral'}>{i.priority}</Pill>
                              <Typography variant="body2"><strong>{i.area}:</strong> {i.suggestion}</Typography>
                            </Stack>
                          ))}
                        </Stack>
                      </Box>
                    )}
                  </>
                )}
              </Stack>
            )}
          </SurfaceCard>
        </div>
      </div>

      <ConfirmDialog
        open={!!del} title="Delete this resume?" message={del ? `${del.fileName} (version ${del.version}) will be permanently deleted. This cannot be undone.` : ''}
        confirmLabel="Delete" danger loading={remove.isPending} onClose={() => setDel(null)} onConfirm={() => remove.mutate(del.id)}
      />
    </>
  );
}
