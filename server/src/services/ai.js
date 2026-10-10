// Orchestrates every AI feature. Pattern for each one:
//   deterministic part (always available) + AI part (via runFeature; may be "unavailable").
// The AI never decides eligibility, never changes a status, and its numbers never replace rule-based ones.
import { ctx } from '../context.js';
import { drives } from '../repositories/drives.js';
import { students, resumes } from '../repositories/students.js';
import { applications } from '../repositories/applications.js';
import { aiResults } from '../repositories/system.js';
import { criteriaFromRow, studentFromRow } from '../domain/eligibility.js';
import { computeMatch, computeReadiness } from '../domain/scoring.js';
import { matchSkills, uniqueSkills } from '../domain/skills.js';
import { anonymiseText, anonymiseValue } from '../ai/anonymise.js';
import { prompts } from '../ai/prompts/v1/index.js';
import { aiUnavailable, peek, runFeature, shapeCached } from '../ai/runner.js';
import {
  insightsSchema, interviewQuestionsSchema, matchAiSchema, resumeAnalysisSchema, resumeParseSchema,
  RESUME_COMPONENTS, roadmapSchema, skillGapSchema,
} from '../ai/schemas.js';
import { assertCollegeAccess, getSettings, scopeCollege } from './common.js';
import { buildProfileView } from './students.js';
import { analyticsService } from './analytics.js';
import { evaluateRow } from './drives.js';
import { conflict, notFound, unprocessable } from '../utils/errors.js';
import { round1 } from '../utils/helpers.js';

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------
async function studentContext(userId) {
  const sp = await students.findByUserId(userId);
  if (!sp) throw notFound('Student profile not found');
  const [projects, experience, resume] = await Promise.all([
    students.projects(userId), students.experience(userId), resumes.findActive(userId),
  ]);
  return { sp, projects, experience, resume };
}

const nameCtx = (sp) => ({ fullName: sp.fullName, collegeName: sp.collegeName });

/** Skills parsed from the active resume, if a fresh parse exists (never triggers a model call). */
async function parsedResumeOf(userId, resume) {
  if (!resume || resume.extractionStatus !== 'ok') return null;
  const p = await peek({ feature: 'resume_parse', userId, scopeKey: 'resume', hashObj: { textHash: resume.textHash } });
  return p.state === 'fresh' ? p.row.output : null;
}

const aiMeta = (r) => {
  if (!r || r.status === 'none') return { status: 'none' };
  if (r.status === 'unavailable') return { status: 'unavailable', reason: r.reason, message: r.message };
  return { status: 'ok', cached: r.meta.cached, stale: !!r.stale, model: r.meta.model, generatedAt: r.meta.generatedAt };
};

/** Turns raw validated model output into the explainable resume score (overall = mean of components). */
export function toResumeAnalysis(output) {
  const seen = new Set();
  const components = [];
  for (const c of output.components) {
    if (seen.has(c.key)) continue;
    seen.add(c.key);
    components.push({ key: c.key, label: RESUME_COMPONENTS[c.key], score: c.score, reason: c.reason });
  }
  const overall = components.reduce((a, c) => a + c.score, 0) / components.length;
  return {
    overallScore: round1(overall),
    components,
    strengths: output.strengths,
    weaknesses: output.weaknesses,
    missingSkills: output.missingSkills,
    improvements: output.improvements,
    projectRelevance: output.projectRelevance,
  };
}

function readableResumeOrThrow(resume) {
  if (!resume) throw unprocessable('Upload a resume first.', 'no_resume');
  if (resume.extractionStatus !== 'ok') {
    throw unprocessable('Your resume could not be read (it may be a scanned image). Upload a text-based PDF or DOCX.', 'resume_unreadable');
  }
}

const studentSummary = (sp, projects, experience, have) =>
  anonymiseValue(
    {
      skills: have,
      projects: projects.map((p) => ({ title: p.title, description: (p.description ?? '').slice(0, 600), technologies: p.tech })),
      experience: experience.map((e) => ({ kind: e.kind, role: e.role, organization: e.organization, description: (e.description ?? '').slice(0, 600) })),
      careerInterests: sp.careerInterests ?? [],
    },
    nameCtx(sp),
  );

async function loadDriveFor(user, driveId) {
  const drive = await drives.findById(driveId);
  if (!drive) throw notFound('Drive not found');
  if (user.role === 'student') {
    if (drive.collegeId !== user.collegeId || ['draft', 'cancelled'].includes(drive.status)) throw notFound('Drive not found');
  } else assertCollegeAccess(user, drive.collegeId);
  const [skills, eligibility] = await Promise.all([drives.skills(driveId), drives.eligibility(driveId)]);
  return { drive, skills, eligibility };
}

const driveSummary = (drive, skills) =>
  anonymiseValue({
    title: drive.title,
    jobType: drive.jobType,
    description: (drive.description ?? '').slice(0, 2500),
    requiredSkills: skills.map((s) => ({ skill: s.skill, importance: s.importance })),
  });

// ---------------------------------------------------------------------------
// match (shared by student endpoint, recommendations and candidate ranking)
// ---------------------------------------------------------------------------
async function matchForStudent({ studentId, drive, skills, eligibility, run, force = false }) {
  const { sp, projects, experience, resume } = await studentContext(studentId);
  const parsed = await parsedResumeOf(studentId, resume);
  const have = uniqueSkills([...(sp.skills ?? []), ...(parsed?.skills ?? [])]);
  const settings = await getSettings();

  const sSummary = studentSummary(sp, projects, experience, have);
  const dSummary = driveSummary(drive, skills);
  const hashObj = { drive: dSummary, student: sSummary };
  const thin = have.length === 0 && projects.length === 0 && experience.length === 0;

  let ai;
  if (thin) {
    ai = { status: 'unavailable', reason: 'insufficient_data', message: 'Add skills, projects or experience to your profile to get an AI fit assessment.' };
  } else if (run) {
    ai = await runFeature({
      feature: 'match_ai', userId: studentId, driveId: drive.id, scopeKey: drive.id, hashObj, schema: matchAiSchema, force,
      prompt: { system: prompts.matchAi.system, user: prompts.matchAi.user({ drive: dSummary, student: sSummary }) },
    });
  } else {
    ai = shapeCached(await peek({ feature: 'match_ai', userId: studentId, scopeKey: drive.id, hashObj }));
  }

  const usable = ai.status === 'ok' && !ai.stale ? ai.data : null;
  const match = computeMatch(
    { student: studentFromRow(sp), haveSkills: have, requiredSkills: skills, criteria: criteriaFromRow(eligibility), ai: usable },
    settings.match_weights,
  );
  return { match, ai: aiMeta(ai), sp, have };
}

// ---------------------------------------------------------------------------
// public service
// ---------------------------------------------------------------------------
export const aiService = {
  async status() {
    const s = await getSettings();
    return { configured: !!ctx.gemini?.configured, enabled: !!s.ai_enabled, available: !!ctx.gemini?.configured && !!s.ai_enabled };
  },

  // ---- resume parser ------------------------------------------------------
  async parseResume(user, { force = false } = {}) {
    const { sp, resume } = await studentContext(user.id);
    readableResumeOrThrow(resume);
    const text = anonymiseText(resume.extractedText, nameCtx(sp));
    const res = await runFeature({
      feature: 'resume_parse', userId: user.id, scopeKey: 'resume', hashObj: { textHash: resume.textHash }, schema: resumeParseSchema, force,
      prompt: { system: prompts.resumeParse.system, user: prompts.resumeParse.user({ text }) },
    });
    return res.status === 'ok' ? { ai: aiMeta(res), parsed: res.data, resumeId: resume.id } : { ai: aiMeta(res), parsed: null };
  },

  async getParsedResume(user) {
    const { resume } = await studentContext(user.id);
    if (!resume || resume.extractionStatus !== 'ok') return { ai: { status: 'none' }, parsed: null };
    const p = shapeCached(await peek({ feature: 'resume_parse', userId: user.id, scopeKey: 'resume', hashObj: { textHash: resume.textHash } }));
    return { ai: aiMeta(p), parsed: p.status === 'ok' ? p.data : null };
  },

  // ---- resume analysis ----------------------------------------------------
  async analyzeResume(user, { force = false } = {}) {
    const { sp, resume } = await studentContext(user.id);
    readableResumeOrThrow(resume);
    const text = anonymiseText(resume.extractedText, nameCtx(sp));
    const res = await runFeature({
      feature: 'resume_analysis', userId: user.id, scopeKey: 'resume', hashObj: { textHash: resume.textHash }, schema: resumeAnalysisSchema, force,
      prompt: { system: prompts.resumeAnalysis.system, user: prompts.resumeAnalysis.user({ text, interests: sp.careerInterests }) },
    });
    return res.status === 'ok' ? { ai: aiMeta(res), analysis: toResumeAnalysis(res.data) } : { ai: aiMeta(res), analysis: null };
  },

  async getResumeAnalysis(user) {
    const { resume } = await studentContext(user.id);
    if (!resume) return { ai: { status: 'none' }, analysis: null, reason: 'no_resume' };
    if (resume.extractionStatus !== 'ok') return { ai: { status: 'none' }, analysis: null, reason: 'resume_unreadable' };
    const p = shapeCached(await peek({ feature: 'resume_analysis', userId: user.id, scopeKey: 'resume', hashObj: { textHash: resume.textHash } }));
    return { ai: aiMeta(p), analysis: p.status === 'ok' ? toResumeAnalysis(p.data) : null };
  },

  // ---- readiness ------------------------------------------------------------
  async readiness(user) {
    const { sp, projects, experience, resume } = await studentContext(user.id);
    const settings = await getSettings();
    let analysis = null;
    let missingReason;
    if (!resume) missingReason = 'No resume uploaded yet.';
    else if (resume.extractionStatus !== 'ok') missingReason = 'The uploaded resume could not be read. Upload a text-based PDF or DOCX.';
    else {
      const p = await peek({ feature: 'resume_analysis', userId: user.id, scopeKey: 'resume', hashObj: { textHash: resume.textHash } });
      if (p.state === 'fresh') analysis = toResumeAnalysis(p.row.output);
      else if (p.state === 'stale') missingReason = 'Your resume changed since the last AI analysis. Run the analysis again.';
      else missingReason = 'AI resume analysis has not been run yet.';
    }
    const view = buildProfileView(sp, { projects, experience, resume });
    const result = computeReadiness({
      student: studentFromRow(sp), skills: sp.skills ?? [], projects, experience,
      completion: view.completion, resumeAnalysis: analysis, resumeMissingReason: missingReason,
    }, settings.readiness_weights);
    return { ...result, weights: settings.readiness_weights, completion: view.completion };
  },

  // ---- match -------------------------------------------------------------------
  async match(user, driveId, { run, force = false }) {
    const { drive, skills, eligibility } = await loadDriveFor(user, driveId);
    const sp = await students.findByUserId(user.id);
    const out = await matchForStudent({ studentId: user.id, drive, skills, eligibility, run, force });
    return {
      driveId, driveTitle: drive.title, companyName: drive.companyName,
      eligibility: (({ status, summary }) => ({ status, summary }))(evaluateRow(sp, eligibility)),
      match: out.match, ai: out.ai,
    };
  },

  // ---- skill gap -----------------------------------------------------------------
  async skillGap(user, { driveId, targetRole, force = false, run = true }) {
    const { sp, resume } = await studentContext(user.id);
    const parsed = await parsedResumeOf(user.id, resume);
    const have = uniqueSkills([...(sp.skills ?? []), ...(parsed?.skills ?? [])]);

    let target;
    let missing = [];
    let matched = [];
    let scopeKey;
    if (driveId) {
      const { drive, skills } = await loadDriveFor(user, driveId);
      const m = matchSkills(skills, have);
      missing = m.missing;
      matched = m.matched;
      target = { driveTitle: drive.title };
      scopeKey = `drive:${driveId}`;
    } else {
      target = { role: targetRole };
      scopeKey = `role:${targetRole.trim().toLowerCase()}`;
    }

    const rule = {
      target: driveId ? { driveId } : { role: targetRole },
      haveSkills: have,
      matched,
      missingMandatory: missing.filter((m) => m.importance === 'mandatory'),
      missingPreferred: missing.filter((m) => m.importance === 'preferred'),
    };

    // Nothing to plan when a drive's requirements are fully met.
    if (driveId && missing.length === 0) return { ...rule, plan: [], ai: { status: 'none' }, complete: true };

    const hashObj = { target, missing: missing.map((m) => m.skill).sort(), have: [...have].map((s) => s.toLowerCase()).sort() };
    const prompt = {
      system: prompts.skillGap.system,
      user: prompts.skillGap.user({ target, missing, have: anonymiseValue(have) }),
    };
    const res = run
      ? await runFeature({ feature: 'skill_gap', userId: user.id, scopeKey, hashObj, driveId: driveId ?? null, schema: skillGapSchema, prompt, force })
      : shapeCached(await peek({ feature: 'skill_gap', userId: user.id, scopeKey, hashObj }));

    let plan = [];
    if (res.status === 'ok') {
      const importance = new Map(missing.map((m) => [m.skill.toLowerCase(), m.importance]));
      plan = res.data.items.map((i) => {
        const imp = importance.get(i.skill.toLowerCase());
        // priority from the drive's own mandatory/preferred marking beats the model's opinion
        return { ...i, priority: imp ? (imp === 'mandatory' ? 'high' : 'medium') : i.priority };
      });
    }
    return { ...rule, plan, ai: aiMeta(res), complete: false };
  },

  // ---- recommendations (rule-based, no paid AI call) -------------------------------------
  async recommendations(user) {
    await drives.closeExpired(user.collegeId);
    const { sp } = await studentContext(user.id);
    const settings = await getSettings();
    const { items } = await drives.list({ collegeId: user.collegeId, status: 'open', limit: 50, offset: 0 });
    const ids = items.map((d) => d.id);
    const [skillsMap, eligMap, apps, cached, resume] = await Promise.all([
      drives.skillsForDrives(ids), drives.eligibilityForDrives(ids), applications.listByStudent(user.id),
      aiResults.latestForUser({ feature: 'match_ai', userId: user.id }), resumes.findActive(user.id),
    ]);
    const parsed = await parsedResumeOf(user.id, resume);
    const have = uniqueSkills([...(sp.skills ?? []), ...(parsed?.skills ?? [])]);
    const applied = new Set(apps.filter((a) => a.status !== 'withdrawn').map((a) => a.driveId));

    const recs = [];
    let incomplete = 0;
    for (const d of items) {
      const elig = evaluateRow(sp, eligMap.get(d.id));
      if (elig.status === 'incomplete') {
        incomplete += 1;
        continue;
      }
      const skills = skillsMap.get(d.id) ?? [];
      const ai = cached.get(d.id)?.output ?? null;
      const m = computeMatch({
        student: studentFromRow(sp), haveSkills: have, requiredSkills: skills, criteria: criteriaFromRow(eligMap.get(d.id)), ai,
      }, settings.match_weights);
      if (m.total === null) continue;
      const reasonParts = [];
      if (skills.length) {
        reasonParts.push(`Matches ${m.matchedSkills.length} of ${skills.length} required skills${m.matchedSkills.length ? ` (${m.matchedSkills.slice(0, 4).map((x) => x.skill).join(', ')})` : ''}.`);
        if (m.missingMandatory.length) reasonParts.push(`Missing must-have: ${m.missingMandatory.slice(0, 3).map((x) => x.skill).join(', ')}.`);
      }
      reasonParts.push(elig.status === 'eligible' ? 'You meet the eligibility criteria.' : 'You are not eligible by the rules, but you can request an exception.');
      recs.push({
        driveId: d.id, title: d.title, companyName: d.companyName, deadline: d.deadline, jobType: d.jobType,
        matchScore: m.total, basedOn: m.note, eligibility: elig.status, canRequestException: elig.status === 'ineligible',
        alreadyApplied: applied.has(d.id), reason: reasonParts.join(' '),
        matchedSkills: m.matchedSkills.map((x) => x.skill), missingSkills: m.missingSkills.map((x) => x.skill),
        aiAssisted: !!ai,
      });
    }
    recs.sort((a, b) => Number(a.alreadyApplied) - Number(b.alreadyApplied) || (a.eligibility === 'eligible' ? 0 : 1) - (b.eligibility === 'eligible' ? 0 : 1) || b.matchScore - a.matchScore);
    return {
      recommendations: recs.slice(0, 20),
      excludedIncomplete: incomplete,
      note: incomplete ? `${incomplete} open drive(s) were left out because your profile is missing data needed to check eligibility.` : null,
    };
  },

  // ---- candidate ranking (decision support) -----------------------------------------------
  async rankCandidates(user, driveId, { pool = 'applicants', ai = false, force = false }) {
    const { drive, skills, eligibility } = await loadDriveFor(user, driveId);
    const settings = await getSettings();

    let people;
    if (pool === 'eligible') {
      const all = await students.listAllForCollege(drive.collegeId, { verifiedOnly: true });
      const existing = new Map((await applications.applicantsOfDrive(driveId)).map((a) => [a.userId, a]));
      people = all
        .filter((s) => evaluateRow(s, eligibility).status === 'eligible')
        .map((s) => ({ ...s, applicationId: existing.get(s.userId)?.applicationId ?? null, status: existing.get(s.userId)?.status ?? null, manualRank: existing.get(s.userId)?.manualRank ?? null, viaException: false }));
    } else {
      people = await applications.applicantsOfDrive(driveId);
      people = people.map((p) => ({ ...p, userId: p.userId }));
    }
    const ids = people.map((p) => p.userId);
    let cached = await aiResults.latestForStudents({ feature: 'match_ai', scopeKey: driveId, userIds: ids });

    // Optional enrichment: run (cached) AI match for a bounded number of candidates.
    let enriched = 0;
    let skippedForCap = 0;
    if (ai) {
      const todo = people.filter((p) => force || !cached.has(p.userId));
      const batch = todo.slice(0, 20);
      skippedForCap = Math.max(0, todo.length - batch.length);
      const queue = [...batch];
      const worker = async () => {
        while (queue.length) {
          const p = queue.shift();
          const r = await matchForStudent({ studentId: p.userId, drive, skills, eligibility, run: true, force });
          if (r.ai.status === 'ok') enriched += 1;
        }
      };
      await Promise.all([worker(), worker(), worker()]);
      cached = await aiResults.latestForStudents({ feature: 'match_ai', scopeKey: driveId, userIds: ids });
    }

    const rows = await Promise.all(
      people.map(async (p) => {
        const evaluation = evaluateRow(p, eligibility);
        const aiOut = cached.get(p.userId)?.output ?? null;
        // include parsed-resume skills for accuracy when a fresh parse exists
        const resume = await resumes.findActive(p.userId);
        const parsed = await parsedResumeOf(p.userId, resume);
        const have = uniqueSkills([...(p.skills ?? []), ...(parsed?.skills ?? [])]);
        const m = computeMatch({
          student: studentFromRow(p), haveSkills: have, requiredSkills: skills, criteria: criteriaFromRow(eligibility), ai: aiOut,
        }, settings.match_weights);
        const reasons = [];
        if (skills.length) reasons.push(`${m.matchedSkills.length}/${skills.length} required skills matched${m.missingMandatory.length ? `; missing must-have: ${m.missingMandatory.map((x) => x.skill).join(', ')}` : ''}`);
        reasons.push(`Eligibility: ${evaluation.status}${p.viaException ? ' (approved exception)' : ''}`);
        reasons.push(`Profile ${p.verificationStatus}`);
        if (aiOut?.roleRelevance?.reason) reasons.push(`AI: ${aiOut.roleRelevance.reason}`);
        return {
          studentId: p.userId, applicationId: p.applicationId ?? null, name: p.fullName, department: p.department,
          cgpa: p.cgpa, passingYear: p.passingYear, applicationStatus: p.status ?? null, viaException: !!p.viaException,
          verification: p.verificationStatus, eligibility: evaluation.status,
          matchScore: m.total, matchNote: m.note, components: m.components.map((c) => ({
            key: c.key, label: c.label, source: c.source, available: c.available, score: c.score,
            effectiveWeight: c.effectiveWeight, contribution: c.contribution, reason: c.reason, evidence: c.evidence,
          })),
          matchedSkills: m.matchedSkills.map((x) => x.skill), missingSkills: m.missingSkills.map((x) => x.skill),
          aiAssisted: !!aiOut, reasons, manualRank: p.manualRank ?? null,
        };
      }),
    );

    const base = (r) => (r.eligibility === 'eligible' || r.viaException ? 0 : 1) * 1000 + (r.verification === 'verified' ? 0 : 500) - (r.matchScore ?? 0);
    rows.sort((a, b) => {
      if (a.manualRank != null || b.manualRank != null) {
        if (a.manualRank == null) return 1;
        if (b.manualRank == null) return -1;
        return a.manualRank - b.manualRank;
      }
      return base(a) - base(b);
    });
    return {
      driveId, pool, generated: new Date().toISOString(),
      disclaimer: 'Decision support only. Rankings never change an application status; a person makes every decision.',
      aiRequested: ai, aiEnriched: enriched, aiSkippedForCap: skippedForCap, aiAvailable: !!ctx.gemini?.configured && settings.ai_enabled,
      candidates: rows,
    };
  },

  // ---- interview questions -------------------------------------------------------------------
  async interviewQuestions(user, { driveId, studentId, force = false, run = true }) {
    const targetStudentId = user.role === 'student' ? user.id : studentId;
    if (!targetStudentId) throw conflict('studentId is required for staff requests', 'student_required');
    const { drive, skills } = await loadDriveFor(user, driveId);
    const { sp, projects, experience, resume } = await studentContext(targetStudentId);
    if (user.role !== 'student') assertCollegeAccess(user, sp.collegeId);
    const parsed = await parsedResumeOf(targetStudentId, resume);
    const have = uniqueSkills([...(sp.skills ?? []), ...(parsed?.skills ?? [])]);
    const sSummary = studentSummary(sp, projects, experience, have);
    const dSummary = driveSummary(drive, skills);
    const hashObj = { drive: dSummary, student: sSummary };
    const scopeKey = `drive:${driveId}`;
    const res = run
      ? await runFeature({
          feature: 'interview_questions', userId: targetStudentId, driveId, scopeKey, hashObj, schema: interviewQuestionsSchema, force, temperature: 0.5,
          prompt: { system: prompts.interviewQuestions.system, user: prompts.interviewQuestions.user({ drive: dSummary, student: sSummary }) },
        })
      : shapeCached(await peek({ feature: 'interview_questions', userId: targetStudentId, scopeKey, hashObj }));
    return { driveId, driveTitle: drive.title, ai: aiMeta(res), questions: res.status === 'ok' ? res.data : null };
  },

  // ---- roadmap ------------------------------------------------------------------------------------
  async roadmap(user, { weeks = 8, force = false, run = true }) {
    const { sp, projects, experience, resume } = await studentContext(user.id);
    const parsed = await parsedResumeOf(user.id, resume);
    const have = uniqueSkills([...(sp.skills ?? []), ...(parsed?.skills ?? [])]);

    // deterministic gaps: mandatory skills of open, not-ruled-out drives the student lacks, most frequent first
    const { items } = await drives.list({ collegeId: user.collegeId, status: 'open', limit: 50, offset: 0 });
    const skillsMap = await drives.skillsForDrives(items.map((d) => d.id));
    const eligMap = await drives.eligibilityForDrives(items.map((d) => d.id));
    const counts = new Map();
    for (const d of items) {
      if (evaluateRow(sp, eligMap.get(d.id)).status === 'ineligible') continue;
      for (const m of matchSkills((skillsMap.get(d.id) ?? []).filter((s) => s.importance === 'mandatory'), have).missing) {
        counts.set(m.skill, (counts.get(m.skill) ?? 0) + 1);
      }
    }
    const gaps = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([skill, drivesCount]) => ({ skill, neededInDrives: drivesCount }));

    const summary = { ...studentSummary(sp, projects, experience, have), department: sp.department, passingYear: sp.passingYear };
    const hashObj = { weeks, student: summary, gaps };
    const scopeKey = `weeks:${weeks}`;
    const res = run
      ? await runFeature({
          feature: 'roadmap', userId: user.id, scopeKey, hashObj, schema: roadmapSchema, force, temperature: 0.4,
          prompt: { system: prompts.roadmap.system, user: prompts.roadmap.user({ weeks, student: summary, gaps, targets: sp.careerInterests ?? [] }) },
        })
      : shapeCached(await peek({ feature: 'roadmap', userId: user.id, scopeKey, hashObj }));
    return { weeks, basedOnGaps: gaps, ai: aiMeta(res), roadmap: res.status === 'ok' ? res.data : null };
  },

  // ---- placement insights (numbers from SQL, narrative from AI) ----------------------------------------
  async insights(user, { collegeId, force = false, run = true }) {
    const college = scopeCollege(user, collegeId);
    const [overview, gaps, dropoff, exc] = await Promise.all([
      analyticsService.overview(user, college), analyticsService.skillGapReport(user, college),
      analyticsService.eligibilityDropoff(user, college), analyticsService.exceptionTrends(user, college),
    ]);

    const facts = {
      students_total: overview.students.total,
      students_verified: overview.students.byVerification.verified ?? 0,
      students_unverified: overview.students.byVerification.unverified ?? 0,
      students_needs_changes: overview.students.byVerification.needs_changes ?? 0,
      drives_open: overview.drives.byStatus.open ?? 0,
      drives_total: Object.values(overview.drives.byStatus).reduce((a, b) => a + b, 0),
      applications_total: overview.applications.total,
      applications_selected: overview.applications.byStatus.selected ?? 0,
      applications_rejected: overview.applications.byStatus.rejected ?? 0,
      exceptions_pending: exc.byStatus.pending ?? 0,
      exceptions_approved: exc.byStatus.approved ?? 0,
      exceptions_rejected: exc.byStatus.rejected ?? 0,
    };
    for (const [k, n] of Object.entries(dropoff.failedByCriterion)) facts[`eligibility_failures_${k}`] = n;
    gaps.skills.slice(0, 5).forEach((s, i) => {
      facts[`missing_skill_${i + 1}_${s.skill.toLowerCase().replace(/[^a-z0-9]+/g, '_')}`] = s.studentsMissing;
    });
    overview.departments.slice(0, 6).forEach((d) => {
      const key = d.department.toLowerCase().replace(/[^a-z0-9]+/g, '_');
      facts[`dept_${key}_students`] = d.students;
      facts[`dept_${key}_applicants`] = d.applicants;
      facts[`dept_${key}_selected`] = d.selected;
    });

    const base = { collegeId: college, facts, tables: { overview, skillGaps: gaps, eligibilityDropoff: dropoff, exceptions: exc } };
    if (facts.students_total < 3 || (facts.applications_total === 0 && facts.drives_total === 0)) {
      return { ...base, insufficientData: true, ai: { status: 'none' }, narrative: null, message: 'There is not enough activity yet to produce meaningful insights.' };
    }

    const scopeKey = `college:${college ?? 'all'}`;
    const prompt = { system: prompts.insights.system, user: prompts.insights.user({ facts }) };
    const res = run
      ? await runFeature({ feature: 'insights', userId: user.id, scopeKey, hashObj: { facts }, schema: insightsSchema, force, prompt, temperature: 0.3 })
      : shapeCached(await peek({ feature: 'insights', userId: user.id, scopeKey, hashObj: { facts } }));

    let narrative = null;
    if (res.status === 'ok') {
      const keys = new Set(Object.keys(facts));
      narrative = {
        ...res.data,
        observations: res.data.observations.map((o) => ({ ...o, metricRefs: o.metricRefs.filter((k) => keys.has(k)) })),
      };
    }
    return { ...base, insufficientData: false, ai: aiMeta(res), narrative };
  },

  unavailable: aiUnavailable,
};
