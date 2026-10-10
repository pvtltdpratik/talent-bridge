// Thin controllers: take validated input from req.valid, call exactly one service, shape the response.
// Success envelope: { data: ... }. Errors are produced by the central error handler.
import { authService } from '../services/auth.js';
import { adminService } from '../services/admin.js';
import { studentService, resumeService } from '../services/students.js';
import { companyService, driveService } from '../services/drives.js';
import { applicationService, exceptionService, interviewService } from '../services/applications.js';
import { notificationService } from '../services/notifications.js';
import { analyticsService } from '../services/analytics.js';
import { aiService } from '../services/ai.js';
import { ctx } from '../context.js';
import { notFound } from '../utils/errors.js';
import { parsePaging } from '../utils/helpers.js';

const ok = (res, data, status = 200) => res.status(status).json({ data });
const paging = (req) => parsePaging(req.valid?.query ?? req.query);
const csv = (res, { csv: body, filename }) => {
  res.set('Content-Type', 'text/csv; charset=utf-8');
  res.set('Content-Disposition', `attachment; filename="${filename}"`);
  res.send(body);
};

/** Signed, short-lived download links for the local storage provider. The signature is the credential. */
export const files = {
  get: async (req, res) => {
    const found = await ctx.storage.resolveToken?.(req.params.token);
    if (!found) throw notFound('This link is invalid or has expired');
    res.sendFile(found.fullPath, {
      dotfiles: 'allow',
      cacheControl: false,
      etag: false,
      lastModified: false,
      headers: {
        'Content-Type': found.contentType,
        'Content-Disposition': `inline; filename="${found.filename}"`,
        'Cache-Control': 'private, no-store',
        'X-Content-Type-Options': 'nosniff',
      },
    });
  },
};

export const auth = {
  colleges: async (_req, res) => ok(res, await authService.listColleges()),
  registerStudent: async (req, res) => ok(res, await authService.registerStudent(req.valid.body, req.ip), 201),
  registerPlacementCell: async (req, res) => ok(res, await authService.registerPlacementCell(req.valid.body, req.ip), 201),
  inviteInfo: async (req, res) => ok(res, await authService.inviteInfo(req.params.token)),
  acceptInvite: async (req, res) => ok(res, await authService.acceptInvite(req.valid.body, req.ip), 201),
  login: async (req, res) => ok(res, await authService.login(req.valid.body)),
  refresh: async (req, res) => ok(res, await authService.refresh(req.valid.body.refreshToken)),
  logout: async (req, res) => ok(res, await authService.logout(req.token).then(() => ({ ok: true }))),
  forgot: async (req, res) => ok(res, await authService.forgotPassword(req.valid.body.email), 202),
  reset: async (req, res) => ok(res, await authService.resetPassword(req.valid.body)),
  me: async (req, res) => ok(res, await authService.me(req.user.id)),
  deleteMe: async (req, res) => ok(res, await authService.deleteOwnAccount(req.user)),
};

export const admin = {
  listUsers: async (req, res) => ok(res, await adminService.listUsers(req.valid.query, paging(req))),
  setStatus: async (req, res) => ok(res, await adminService.setUserStatus(req.user, req.valid.params.id, req.valid.body)),
  setRole: async (req, res) => ok(res, await adminService.setUserRole(req.user, req.valid.params.id, req.valid.body)),
  createAdmin: async (req, res) => ok(res, await adminService.createAdmin(req.user, req.valid.body), 201),
  createInvite: async (req, res) => ok(res, await adminService.createInvitation(req.user, req.valid.body), 201),
  listInvites: async (req, res) => ok(res, await adminService.listInvitations(paging(req))),
  revokeInvite: async (req, res) => ok(res, await adminService.revokeInvitation(req.user, req.valid.params.id)),
  listColleges: async (_req, res) => ok(res, await adminService.listColleges()),
  createCollege: async (req, res) => ok(res, await adminService.createCollege(req.user, req.valid.body), 201),
  updateCollege: async (req, res) => ok(res, await adminService.updateCollege(req.user, req.valid.params.id, req.valid.body)),
  audit: async (req, res) => ok(res, await adminService.listAudit(req.valid.query, paging(req))),
  getSettings: async (_req, res) => ok(res, await adminService.getSettings()),
  updateSettings: async (req, res) => ok(res, await adminService.updateSettings(req.user, req.valid.body)),
  metrics: async (_req, res) => ok(res, await analyticsService.platformMetrics()),
};

export const students = {
  getMe: async (req, res) => ok(res, await studentService.getMe(req.user.id)),
  updateMe: async (req, res) => ok(res, await studentService.updateMe(req.user, req.valid.body)),
  addProject: async (req, res) => ok(res, await studentService.addProject(req.user, req.valid.body), 201),
  updateProject: async (req, res) => ok(res, await studentService.updateProject(req.user, req.valid.params.id, req.valid.body)),
  deleteProject: async (req, res) => (await studentService.deleteProject(req.user, req.valid.params.id), res.status(204).end()),
  addExperience: async (req, res) => ok(res, await studentService.addExperience(req.user, req.valid.body), 201),
  updateExperience: async (req, res) => ok(res, await studentService.updateExperience(req.user, req.valid.params.id, req.valid.body)),
  deleteExperience: async (req, res) => (await studentService.deleteExperience(req.user, req.valid.params.id), res.status(204).end()),
  applyParsed: async (req, res) => ok(res, await studentService.applyParsed(req.user, req.valid.body)),
  uploadResume: async (req, res) => ok(res, await resumeService.upload(req.user, req.file), 201),
  listResumes: async (req, res) => ok(res, await resumeService.list(req.user)),
  resumeUrl: async (req, res) => ok(res, await resumeService.signedUrlForOwner(req.user, req.valid.params.id)),
  deleteResume: async (req, res) => (await resumeService.remove(req.user, req.valid.params.id), res.status(204).end()),
  // staff
  list: async (req, res) => ok(res, await studentService.list(req.user, req.valid.query, paging(req))),
  get: async (req, res) => ok(res, await studentService.getForStaff(req.user, req.valid.params.id)),
  staffResumeUrl: async (req, res) => ok(res, await resumeService.signedUrlForStaff(req.user, req.valid.params.id)),
  verify: async (req, res) => ok(res, await studentService.setVerification(req.user, req.valid.params.id, req.valid.body)),
};

export const companies = {
  create: async (req, res) => ok(res, await companyService.create(req.user, req.valid.body), 201),
  list: async (req, res) => ok(res, await companyService.list(req.user, req.valid.query, paging(req))),
  workspace: async (req, res) => ok(res, await companyService.workspace(req.user, req.valid.params.id)),
  update: async (req, res) => ok(res, await companyService.update(req.user, req.valid.params.id, req.valid.body)),
  reportCsv: async (req, res) => csv(res, await analyticsService.companyReportCsv(req.user, req.valid.params.id)),
};

export const drives = {
  create: async (req, res) => ok(res, await driveService.create(req.user, req.valid.body), 201),
  update: async (req, res) => ok(res, await driveService.update(req.user, req.valid.params.id, req.valid.body)),
  setStatus: async (req, res) => ok(res, await driveService.setStatus(req.user, req.valid.params.id, req.valid.body.status)),
  extend: async (req, res) => ok(res, await driveService.extendDeadline(req.user, req.valid.params.id, req.valid.body)),
  list: async (req, res) =>
    ok(res, req.user.role === 'student'
      ? await driveService.listForStudent(req.user, req.valid.query, paging(req))
      : await driveService.listForStaff(req.user, req.valid.query, paging(req))),
  get: async (req, res) =>
    ok(res, req.user.role === 'student'
      ? await driveService.getForStudent(req.user, req.valid.params.id)
      : await driveService.getForStaff(req.user, req.valid.params.id)),
  eligibilityReport: async (req, res) => ok(res, await driveService.eligibilityReport(req.user, req.valid.params.id, req.valid.query)),
  report: async (req, res) => ok(res, await analyticsService.driveReport(req.user, req.valid.params.id)),
  reportCsv: async (req, res) => csv(res, await analyticsService.driveReportCsv(req.user, req.valid.params.id)),
};

export const applications = {
  apply: async (req, res) => ok(res, await applicationService.apply(req.user, req.valid.body.driveId), 201),
  mine: async (req, res) => ok(res, await applicationService.listMine(req.user)),
  get: async (req, res) => ok(res, await applicationService.getForUser(req.user, req.valid.params.id)),
  withdraw: async (req, res) => ok(res, await applicationService.withdraw(req.user, req.valid.params.id)),
  list: async (req, res) => ok(res, await applicationService.listForStaff(req.user, req.valid.query, paging(req))),
  setStatus: async (req, res) => ok(res, await applicationService.setStatus(req.user, req.valid.params.id, req.valid.body)),
  setOrder: async (req, res) => ok(res, await applicationService.setOrder(req.user, req.valid.body.driveId, req.valid.body.applicationIds)),
};

export const exceptions = {
  create: async (req, res) => ok(res, await exceptionService.create(req.user, req.valid.body), 201),
  mine: async (req, res) => ok(res, await exceptionService.listMine(req.user)),
  get: async (req, res) => ok(res, await exceptionService.get(req.user, req.valid.params.id)),
  withdraw: async (req, res) => ok(res, await exceptionService.withdraw(req.user, req.valid.params.id)),
  list: async (req, res) => ok(res, await exceptionService.listForStaff(req.user, req.valid.query, paging(req))),
  decide: async (req, res) => ok(res, await exceptionService.decide(req.user, req.valid.params.id, req.valid.body)),
};

export const interviews = {
  create: async (req, res) => ok(res, await interviewService.schedule(req.user, req.valid.body), 201),
  update: async (req, res) => ok(res, await interviewService.update(req.user, req.valid.params.id, req.valid.body)),
  mine: async (req, res) => ok(res, await interviewService.listMine(req.user)),
  list: async (req, res) => ok(res, await interviewService.listForStaff(req.user, req.valid.query, paging(req))),
};

export const notifications = {
  list: async (req, res) => ok(res, await notificationService.list(req.user, { unreadOnly: req.valid.query.unread }, paging(req))),
  unread: async (req, res) => ok(res, await notificationService.unreadCount(req.user)),
  read: async (req, res) => ok(res, await notificationService.markRead(req.user, req.valid.params.id)),
  readAll: async (req, res) => ok(res, await notificationService.markAllRead(req.user)),
};

export const analytics = {
  overview: async (req, res) => ok(res, await analyticsService.overview(req.user, req.valid.query.collegeId)),
  skillGaps: async (req, res) => ok(res, await analyticsService.skillGapReport(req.user, req.valid.query.collegeId)),
  dropoff: async (req, res) => ok(res, await analyticsService.eligibilityDropoff(req.user, req.valid.query.collegeId)),
  exceptions: async (req, res) => ok(res, await analyticsService.exceptionTrends(req.user, req.valid.query.collegeId)),
};

export const ai = {
  status: async (_req, res) => ok(res, await aiService.status()),
  parse: async (req, res) => ok(res, await aiService.parseResume(req.user, req.valid.body)),
  getParsed: async (req, res) => ok(res, await aiService.getParsedResume(req.user)),
  analyze: async (req, res) => ok(res, await aiService.analyzeResume(req.user, req.valid.body)),
  getAnalysis: async (req, res) => ok(res, await aiService.getResumeAnalysis(req.user)),
  readiness: async (req, res) => ok(res, await aiService.readiness(req.user)),
  match: async (req, res) => ok(res, await aiService.match(req.user, req.valid.params.id, { run: true, force: !!req.valid.body?.force })),
  getMatch: async (req, res) => ok(res, await aiService.match(req.user, req.valid.params.id, { run: false })),
  skillGap: async (req, res) => ok(res, await aiService.skillGap(req.user, { ...req.valid.body, run: true })),
  getSkillGap: async (req, res) => ok(res, await aiService.skillGap(req.user, { driveId: req.valid.params.id, run: false })),
  getQuestions: async (req, res) => ok(res, await aiService.interviewQuestions(req.user, { driveId: req.valid.params.id, run: false })),
  recommendations: async (req, res) => ok(res, await aiService.recommendations(req.user)),
  ranking: async (req, res) => ok(res, await aiService.rankCandidates(req.user, req.valid.params.id, req.valid.body)),
  questions: async (req, res) => ok(res, await aiService.interviewQuestions(req.user, { ...req.valid.body, run: true })),
  roadmap: async (req, res) => ok(res, await aiService.roadmap(req.user, { ...req.valid.body, run: true })),
  getRoadmap: async (req, res) => ok(res, await aiService.roadmap(req.user, { weeks: Number(req.valid.query?.weeks) || 8, run: false })),
  insights: async (req, res) => ok(res, await aiService.insights(req.user, { ...req.valid.body, run: true })),
  getInsights: async (req, res) => ok(res, await aiService.insights(req.user, { collegeId: req.valid.query.collegeId, run: false })),
};
