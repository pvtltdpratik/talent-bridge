import { Router } from 'express';
import multer from 'multer';
import { z } from 'zod';
import * as S from './schemas.js';
import * as c from '../controllers/index.js';
import { authenticate, requireRole, requireStaff } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';

const student = requireRole('student');
const adminOnly = requireRole('admin');
const hardCap = 25 * 1024 * 1024; // absolute cap; the admin-configurable limit is enforced in the service
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: hardCap, files: 1 } }).single('file');

/**
 * Builds the API router. `limiters` comes from middleware/rateLimit.js.
 *
 * Permission matrix (see docs/API.md for the full table):
 *   public      auth/* (rate limited)
 *   any active  auth/me, notifications/*, drives (view)
 *   student     students/me/*, applications (apply/mine/withdraw), exceptions (create/mine), interviews/mine, ai/*
 *   staff       students (list/verify), companies, drives (manage), applications (decide), exceptions (decide), interviews, analytics, ai ranking/insights
 *   admin       admin/*
 */
export function buildRouter(limiters) {
  const r = Router();
  const authed = authenticate();

  // ---------------------------------------------------------------- auth (public)
  r.get('/auth/colleges', c.auth.colleges);
  r.post('/auth/register/student', limiters.register, validate({ body: S.registerBody }), c.auth.registerStudent);
  r.post('/auth/register/placement-cell', limiters.register, validate({ body: S.registerBody }), c.auth.registerPlacementCell);
  r.get('/auth/invite/:token', limiters.login, c.auth.inviteInfo);
  r.post('/auth/accept-invite', limiters.register, validate({ body: S.acceptInviteBody }), c.auth.acceptInvite);
  r.post('/auth/login', limiters.login, validate({ body: S.loginBody }), c.auth.login);
  r.post('/auth/refresh', limiters.login, validate({ body: S.refreshBody }), c.auth.refresh);
  r.post('/auth/forgot-password', limiters.passwordReset, validate({ body: S.forgotBody }), c.auth.forgot);
  r.post('/auth/reset-password', limiters.passwordReset, validate({ body: S.resetBody }), c.auth.reset);
  // /me works for pending/suspended users too so the UI can show their state
  r.get('/auth/me', authenticate({ allowInactive: true }), c.auth.me);
  r.post('/auth/logout', authenticate({ allowInactive: true }), c.auth.logout);
  r.delete('/auth/me', authed, student, c.auth.deleteMe);

  // signed file links (local storage provider); authorised by the HMAC in the token itself
  r.get('/files/:token', c.files.get);

  // ---------------------------------------------------------------- notifications (any active user)
  r.get('/notifications', authed, validate({ query: S.notificationQuery }), c.notifications.list);
  r.get('/notifications/unread-count', authed, c.notifications.unread);
  r.post('/notifications/read-all', authed, c.notifications.readAll);
  r.post('/notifications/:id/read', authed, validate({ params: S.idParam }), c.notifications.read);

  // ---------------------------------------------------------------- student self-service
  r.get('/students/me', authed, student, c.students.getMe);
  r.put('/students/me', authed, student, validate({ body: S.profileBody }), c.students.updateMe);
  r.post('/students/me/projects', authed, student, validate({ body: S.projectBody }), c.students.addProject);
  r.put('/students/me/projects/:id', authed, student, validate({ params: S.idParam, body: S.projectBody }), c.students.updateProject);
  r.delete('/students/me/projects/:id', authed, student, validate({ params: S.idParam }), c.students.deleteProject);
  r.post('/students/me/experience', authed, student, validate({ body: S.experienceBody }), c.students.addExperience);
  r.put('/students/me/experience/:id', authed, student, validate({ params: S.idParam, body: S.experienceBody }), c.students.updateExperience);
  r.delete('/students/me/experience/:id', authed, student, validate({ params: S.idParam }), c.students.deleteExperience);
  r.post('/students/me/apply-parsed', authed, student, validate({ body: S.applyParsedBody }), c.students.applyParsed);
  r.get('/students/me/resumes', authed, student, c.students.listResumes);
  r.post('/students/me/resumes', authed, student, limiters.upload, upload, c.students.uploadResume);
  r.get('/students/me/resumes/:id/url', authed, student, validate({ params: S.idParam }), c.students.resumeUrl);
  r.delete('/students/me/resumes/:id', authed, student, validate({ params: S.idParam }), c.students.deleteResume);

  // ---------------------------------------------------------------- staff: students
  r.get('/students', authed, requireStaff, validate({ query: S.studentListQuery }), c.students.list);
  r.get('/students/:id', authed, requireStaff, validate({ params: S.idParam }), c.students.get);
  r.get('/students/:id/resume-url', authed, requireStaff, validate({ params: S.idParam }), c.students.staffResumeUrl);
  r.patch('/students/:id/verification', authed, requireStaff, validate({ params: S.idParam, body: S.verificationBody }), c.students.verify);

  // ---------------------------------------------------------------- companies (company workspace)
  r.get('/companies', authed, requireStaff, validate({ query: S.pagingQuery.extend({ collegeId: S.uuid.optional(), status: z.enum(['active', 'inactive']).optional(), q: z.string().max(100).optional() }) }), c.companies.list);
  r.post('/companies', authed, requireStaff, validate({ body: S.companyBody }), c.companies.create);
  r.get('/companies/:id', authed, requireStaff, validate({ params: S.idParam }), c.companies.workspace);
  r.patch('/companies/:id', authed, requireStaff, validate({ params: S.idParam, body: S.companyPatch }), c.companies.update);
  r.get('/companies/:id/report.csv', authed, requireStaff, validate({ params: S.idParam }), c.companies.reportCsv);

  // ---------------------------------------------------------------- drives
  r.get('/drives', authed, validate({ query: S.driveListQuery }), c.drives.list);
  r.get('/drives/:id', authed, validate({ params: S.idParam }), c.drives.get);
  r.post('/drives', authed, requireStaff, validate({ body: S.driveBody }), c.drives.create);
  r.patch('/drives/:id', authed, requireStaff, validate({ params: S.idParam, body: S.drivePatch }), c.drives.update);
  r.post('/drives/:id/status', authed, requireStaff, validate({ params: S.idParam, body: S.driveStatusBody }), c.drives.setStatus);
  r.post('/drives/:id/extend-deadline', authed, requireStaff, validate({ params: S.idParam, body: S.extendDeadlineBody }), c.drives.extend);
  r.get('/drives/:id/eligibility-report', authed, requireStaff, validate({ params: S.idParam, query: z.object({ status: z.enum(['eligible', 'ineligible', 'incomplete']).optional() }) }), c.drives.eligibilityReport);
  r.get('/drives/:id/report', authed, requireStaff, validate({ params: S.idParam }), c.drives.report);
  r.get('/drives/:id/report.csv', authed, requireStaff, validate({ params: S.idParam }), c.drives.reportCsv);

  // ---------------------------------------------------------------- applications
  r.post('/applications', authed, student, validate({ body: S.applyBody }), c.applications.apply);
  r.get('/applications/mine', authed, student, c.applications.mine);
  r.get('/applications', authed, requireStaff, validate({ query: S.applicationListQuery }), c.applications.list);
  r.put('/applications/order', authed, requireStaff, validate({ body: S.applicationOrderBody }), c.applications.setOrder);
  r.get('/applications/:id', authed, validate({ params: S.idParam }), c.applications.get);
  r.post('/applications/:id/withdraw', authed, student, validate({ params: S.idParam }), c.applications.withdraw);
  r.patch('/applications/:id/status', authed, requireStaff, validate({ params: S.idParam, body: S.applicationStatusBody }), c.applications.setStatus);

  // ---------------------------------------------------------------- exception requests
  r.post('/exceptions', authed, student, validate({ body: S.exceptionBody }), c.exceptions.create);
  r.get('/exceptions/mine', authed, student, c.exceptions.mine);
  r.get('/exceptions', authed, requireStaff, validate({ query: S.exceptionListQuery }), c.exceptions.list);
  r.get('/exceptions/:id', authed, validate({ params: S.idParam }), c.exceptions.get);
  r.post('/exceptions/:id/withdraw', authed, student, validate({ params: S.idParam }), c.exceptions.withdraw);
  r.post('/exceptions/:id/decision', authed, requireStaff, validate({ params: S.idParam, body: S.exceptionDecisionBody }), c.exceptions.decide);

  // ---------------------------------------------------------------- interviews
  r.get('/interviews/mine', authed, student, c.interviews.mine);
  r.get('/interviews', authed, requireStaff, validate({ query: S.interviewListQuery }), c.interviews.list);
  r.post('/interviews', authed, requireStaff, validate({ body: S.interviewBody }), c.interviews.create);
  r.patch('/interviews/:id', authed, requireStaff, validate({ params: S.idParam, body: S.interviewPatch }), c.interviews.update);

  // ---------------------------------------------------------------- analytics (real data only)
  r.get('/analytics/overview', authed, requireStaff, validate({ query: S.collegeQuery }), c.analytics.overview);
  r.get('/analytics/skill-gaps', authed, requireStaff, validate({ query: S.collegeQuery }), c.analytics.skillGaps);
  r.get('/analytics/eligibility-dropoff', authed, requireStaff, validate({ query: S.collegeQuery }), c.analytics.dropoff);
  r.get('/analytics/exceptions', authed, requireStaff, validate({ query: S.collegeQuery }), c.analytics.exceptions);

  // ---------------------------------------------------------------- AI (POST = may spend; GET = cached only)
  const aiGuard = [limiters.aiGlobal, limiters.aiUser];
  r.get('/ai/status', authed, c.ai.status);
  r.get('/ai/resume/parsed', authed, student, c.ai.getParsed);
  r.post('/ai/resume/parse', authed, student, ...aiGuard, validate({ body: S.forceBody }), c.ai.parse);
  r.get('/ai/resume/analysis', authed, student, c.ai.getAnalysis);
  r.post('/ai/resume/analyze', authed, student, ...aiGuard, validate({ body: S.forceBody }), c.ai.analyze);
  r.get('/ai/readiness', authed, student, c.ai.readiness);
  r.get('/ai/match/:id', authed, student, validate({ params: S.idParam }), c.ai.getMatch);
  r.post('/ai/match/:id', authed, student, ...aiGuard, validate({ params: S.idParam, body: S.forceBody }), c.ai.match);
  r.post('/ai/skill-gap', authed, student, ...aiGuard, validate({ body: S.skillGapBody }), c.ai.skillGap);
  r.get('/ai/skill-gap/:id', authed, student, validate({ params: S.idParam }), c.ai.getSkillGap);
  r.get('/ai/interview-questions/:id', authed, student, validate({ params: S.idParam }), c.ai.getQuestions);
  r.get('/ai/recommendations', authed, student, c.ai.recommendations);
  r.post('/ai/interview-questions', authed, ...aiGuard, validate({ body: S.questionsBody }), c.ai.questions);
  r.get('/ai/roadmap', authed, student, validate({ query: z.object({ weeks: z.coerce.number().optional() }) }), c.ai.getRoadmap);
  r.post('/ai/roadmap', authed, student, ...aiGuard, validate({ body: S.roadmapBody }), c.ai.roadmap);
  r.post('/ai/ranking/:id', authed, requireStaff, ...aiGuard, validate({ params: S.idParam, body: S.rankingBody }), c.ai.ranking);
  r.get('/ai/insights', authed, requireStaff, validate({ query: S.collegeQuery }), c.ai.getInsights);
  r.post('/ai/insights', authed, requireStaff, ...aiGuard, validate({ body: S.insightsBody }), c.ai.insights);

  // ---------------------------------------------------------------- admin
  const a = [authed, adminOnly];
  r.get('/admin/users', ...a, validate({ query: S.userListQuery }), c.admin.listUsers);
  r.patch('/admin/users/:id/status', ...a, validate({ params: S.idParam, body: S.userStatusBody }), c.admin.setStatus);
  r.patch('/admin/users/:id/role', ...a, validate({ params: S.idParam, body: S.userRoleBody }), c.admin.setRole);
  r.post('/admin/admins', ...a, validate({ body: S.createAdminBody }), c.admin.createAdmin);
  r.get('/admin/invitations', ...a, validate({ query: S.pagingQuery }), c.admin.listInvites);
  r.post('/admin/invitations', ...a, validate({ body: S.inviteBody }), c.admin.createInvite);
  r.delete('/admin/invitations/:id', ...a, validate({ params: S.idParam }), c.admin.revokeInvite);
  r.get('/admin/colleges', ...a, c.admin.listColleges);
  r.post('/admin/colleges', ...a, validate({ body: S.collegeBody }), c.admin.createCollege);
  r.patch('/admin/colleges/:id', ...a, validate({ params: S.idParam, body: S.collegePatch }), c.admin.updateCollege);
  r.get('/admin/audit-logs', ...a, validate({ query: S.auditQuery }), c.admin.audit);
  r.get('/admin/settings', ...a, c.admin.getSettings);
  r.put('/admin/settings', ...a, validate({ body: S.settingsBody }), c.admin.updateSettings);
  r.get('/admin/metrics', ...a, c.admin.metrics);

  return r;
}
