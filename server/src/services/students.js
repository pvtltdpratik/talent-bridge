import crypto from 'node:crypto';
import mammoth from 'mammoth';
import { PDFParse } from 'pdf-parse';
import { ctx } from '../context.js';
import { students, resumes } from '../repositories/students.js';
import { profiles } from '../repositories/users.js';
import { computeProfileCompletion } from '../domain/profileCompletion.js';
import { uniqueSkills } from '../domain/skills.js';
import { assertCollegeAccess, getSettings, notify, recordAudit, scopeCollege } from './common.js';
import { AppError, badRequest, notFound, unprocessable } from '../utils/errors.js';
import { likePattern, pageResult, sha256 } from '../utils/helpers.js';

// Fields that, once verified by the placement cell, force re-verification when the student changes them.
const VERIFIED_FIELDS = ['cgpa', 'tenthPercent', 'twelfthPercent', 'activeBacklogs', 'department', 'passingYear', 'rollNumber'];

export function buildProfileView(sp, { projects, experience, resume }) {
  const completion = computeProfileCompletion({
    phone: sp.phone, department: sp.department, rollNumber: sp.rollNumber, passingYear: sp.passingYear,
    cgpa: sp.cgpa, tenthPercent: sp.tenthPercent, twelfthPercent: sp.twelfthPercent, activeBacklogs: sp.activeBacklogs,
    skills: sp.skills, projectCount: projects.length, experienceCount: experience.length,
    links: sp.links, careerInterests: sp.careerInterests, hasResume: !!resume,
  });
  return {
    userId: sp.userId, fullName: sp.fullName, email: sp.email, phone: sp.phone,
    collegeId: sp.collegeId, collegeName: sp.collegeName,
    department: sp.department, rollNumber: sp.rollNumber, passingYear: sp.passingYear,
    cgpa: sp.cgpa, tenthPercent: sp.tenthPercent, twelfthPercent: sp.twelfthPercent, activeBacklogs: sp.activeBacklogs,
    skills: sp.skills ?? [], certifications: sp.certifications ?? [], links: sp.links ?? {},
    careerInterests: sp.careerInterests ?? [],
    verification: {
      status: sp.verificationStatus, comment: sp.verificationComment, verifiedAt: sp.verifiedAt,
    },
    projects, experience,
    resume: resume ? { id: resume.id, version: resume.version, fileName: resume.fileName, extractionStatus: resume.extractionStatus, extractionError: resume.extractionError, createdAt: resume.createdAt } : null,
    completion,
  };
}

async function loadFull(userId) {
  const sp = await students.findByUserId(userId);
  if (!sp) throw notFound('Student profile not found');
  const [projects, experience, resume] = await Promise.all([
    students.projects(userId), students.experience(userId), resumes.findActive(userId),
  ]);
  return { sp, projects, experience, resume };
}

export const studentService = {
  async getMe(userId) {
    const { sp, projects, experience, resume } = await loadFull(userId);
    return buildProfileView(sp, { projects, experience, resume });
  },

  async updateMe(user, input) {
    const { fullName, phone, ...fields } = input;
    if (fields.skills) fields.skills = uniqueSkills(fields.skills).slice(0, 60);
    const result = await ctx.db.tx(async (ex) => {
      const before = await students.lock(user.id, ex);
      if (!before) throw notFound('Student profile not found');
      if (fullName !== undefined || phone !== undefined) await profiles.updateBasics(user.id, { fullName, phone }, ex);
      await students.update(user.id, fields, ex);
      let reset = false;
      if (before.verificationStatus === 'verified') {
        const changed = VERIFIED_FIELDS.some((k) => fields[k] !== undefined && String(fields[k] ?? '') !== String(before[k] ?? ''));
        if (changed) {
          await students.resetVerification(user.id, ex);
          await recordAudit(user, { action: 'profile.verification_reset', targetType: 'student', targetId: user.id, collegeId: user.collegeId, oldValue: { status: 'verified' }, newValue: { status: 'unverified' } }, ex);
          reset = true;
        }
      }
      return reset;
    });
    return { ...(await this.getMe(user.id)), verificationReset: result };
  },

  addProject: (user, p) => students.addProject(user.id, p),
  async updateProject(user, id, p) {
    const row = await students.updateProject(user.id, id, p);
    if (!row) throw notFound('Project not found');
    return row;
  },
  async deleteProject(user, id) {
    if (!(await students.deleteProject(user.id, id))) throw notFound('Project not found');
  },
  addExperience: (user, e) => students.addExperience(user.id, e),
  async updateExperience(user, id, e) {
    const row = await students.updateExperience(user.id, id, e);
    if (!row) throw notFound('Experience not found');
    return row;
  },
  async deleteExperience(user, id) {
    if (!(await students.deleteExperience(user.id, id))) throw notFound('Experience not found');
  },

  /** Merge the (student-reviewed) parsed resume data into the profile. */
  async applyParsed(user, { skills = [], projects = [], experience = [], certifications = [] }) {
    const { sp } = await loadFull(user.id);
    await ctx.db.tx(async (ex) => {
      if (skills.length) await students.update(user.id, { skills: uniqueSkills([...(sp.skills ?? []), ...skills]).slice(0, 60) }, ex);
      if (certifications.length) {
        const have = new Set((sp.certifications ?? []).map((c) => String(c.name ?? c).toLowerCase()));
        const add = certifications.filter((c) => !have.has(c.toLowerCase())).map((name) => ({ name }));
        if (add.length) await students.update(user.id, { certifications: [...(sp.certifications ?? []), ...add] }, ex);
      }
      for (const p of projects) await students.addProject(user.id, p, ex);
      for (const e of experience) await students.addExperience(user.id, e, ex);
    });
    return this.getMe(user.id);
  },

  // ---- staff views --------------------------------------------------------
  async list(user, query, paging) {
    const { items, total } = await students.list({
      collegeId: scopeCollege(user, query.collegeId),
      department: query.department, passingYear: query.passingYear, verification: query.verification,
      q: query.q ? likePattern(query.q) : null, limit: paging.limit, offset: paging.offset,
    });
    return pageResult(items, total, paging);
  },

  async getForStaff(user, studentId) {
    const { sp, projects, experience, resume } = await loadFull(studentId);
    assertCollegeAccess(user, sp.collegeId);
    return buildProfileView(sp, { projects, experience, resume });
  },

  /** verified | needs_changes (+ comment). Audited and notified. */
  async setVerification(actor, studentId, { status, comment }) {
    return ctx.db.tx(async (ex) => {
      const sp = await students.lock(studentId, ex);
      if (!sp) throw notFound('Student not found');
      assertCollegeAccess(actor, sp.collegeId);
      if (status === 'needs_changes' && !comment?.trim()) {
        throw badRequest('Please tell the student what to fix', [{ field: 'comment', message: 'A comment is required' }]);
      }
      const row = await students.setVerification(studentId, { status, comment, by: actor.id }, ex);
      await recordAudit(actor, {
        action: `profile.${status}`, targetType: 'student', targetId: studentId, collegeId: sp.collegeId,
        oldValue: { status: sp.verificationStatus }, newValue: { status, comment: comment ?? null },
      }, ex);
      await notify(ex, {
        userId: studentId, type: 'verification',
        title: status === 'verified' ? 'Profile verified' : 'Profile needs changes',
        body: status === 'verified' ? 'Your profile was verified. You can now apply to drives.' : `Please update your profile: ${comment}`,
        link: '/student/profile',
      });
      return row;
    });
  },
};

// ===========================================================================
// Resumes
// ===========================================================================
const PDF_MAGIC = Buffer.from('%PDF-');
const ZIP_MAGIC = Buffer.from([0x50, 0x4b, 0x03, 0x04]);

/** Content-based type detection (the client-supplied mimetype/extension is never trusted). */
export function detectResumeType(buffer) {
  if (buffer.length >= 5 && buffer.subarray(0, 5).equals(PDF_MAGIC)) return 'pdf';
  if (buffer.length >= 4 && buffer.subarray(0, 4).equals(ZIP_MAGIC) && buffer.includes('word/document.xml')) return 'docx';
  return null;
}

const MIME = {
  pdf: 'application/pdf',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
};

async function extractText(buffer, type) {
  if (type === 'pdf') {
    const parser = new PDFParse({ data: new Uint8Array(buffer) });
    try {
      const result = await parser.getText();
      return result.text ?? '';
    } finally {
      await parser.destroy().catch(() => {});
    }
  }
  const result = await mammoth.extractRawText({ buffer });
  return result.value ?? '';
}

const normaliseText = (t) => t.replace(/\r/g, '').replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();

export const resumeService = {
  async upload(user, file) {
    if (!file) throw badRequest('Please choose a PDF or DOCX file', [{ field: 'file', message: 'File is required' }]);
    const settings = await getSettings();
    const maxBytes = settings.upload_max_mb * 1024 * 1024;
    if (file.size > maxBytes) throw new AppError(413, 'file_too_large', `The file is larger than the ${settings.upload_max_mb} MB limit`);

    const type = detectResumeType(file.buffer);
    if (!type) throw unprocessable('Only PDF and DOCX resumes are accepted. The file content does not match either format.', 'unsupported_file');

    let text = '';
    let extractionError = null;
    try {
      text = normaliseText(await extractText(file.buffer, type));
    } catch {
      extractionError = 'The file could not be opened or read.';
    }
    if (!extractionError && text.length < 100) {
      extractionError = 'No readable text was found. This often means the resume is a scanned image. Please upload a text-based PDF or DOCX.';
    }
    const ok = !extractionError;

    const safeName = file.originalname.replace(/[^\w.\- ]+/g, '_').slice(0, 120) || `resume.${type}`;
    const filePath = `${user.id}/${crypto.randomUUID()}.${type}`;
    await ctx.storage.upload(filePath, file.buffer, MIME[type]);

    try {
      const row = await ctx.db.tx(async (ex) => {
        await students.lock(user.id, ex); // serialise concurrent uploads per student
        const version = await resumes.nextVersion(user.id, ex);
        await resumes.deactivateAll(user.id, ex);
        return resumes.insert({
          studentId: user.id, version, filePath, fileName: safeName, mimeType: MIME[type], sizeBytes: file.size,
          extractionStatus: ok ? 'ok' : 'failed', extractionError, extractedText: ok ? text : null,
          textHash: ok ? sha256(text) : null,
        }, ex);
      });
      return {
        id: row.id, version: row.version, fileName: row.fileName, extractionStatus: row.extractionStatus,
        message: ok ? 'Resume uploaded and read successfully.' : `Resume uploaded, but ${extractionError}`,
        extractionError,
      };
    } catch (err) {
      await ctx.storage.remove([filePath]).catch(() => {});
      throw err;
    }
  },

  list: (user) => resumes.listByStudent(user.id),

  /** Signed URL after an ownership/role check. Short-lived (2 minutes). */
  async signedUrlForOwner(user, resumeId) {
    const r = await resumes.findById(resumeId);
    if (!r || r.studentId !== user.id) throw notFound('Resume not found');
    return { url: await ctx.storage.signedUrl(r.filePath, 120), expiresInSeconds: 120, fileName: r.fileName };
  },

  async signedUrlForStaff(user, studentId) {
    const sp = await students.findByUserId(studentId);
    if (!sp) throw notFound('Student not found');
    assertCollegeAccess(user, sp.collegeId);
    const r = await resumes.findActive(studentId);
    if (!r) throw notFound('This student has not uploaded a resume');
    return { url: await ctx.storage.signedUrl(r.filePath, 120), expiresInSeconds: 120, fileName: r.fileName };
  },

  async remove(user, resumeId) {
    const r = await resumes.findById(resumeId);
    if (!r || r.studentId !== user.id) throw notFound('Resume not found');
    await ctx.db.tx(async (ex) => {
      await resumes.remove(resumeId, ex);
      if (r.isActive) await resumes.promoteLatest(user.id, ex);
    });
    await ctx.storage.remove([r.filePath]).catch(() => {});
  },

  /** Active resume with text, for AI features. */
  activeWithText: (studentId) => resumes.findActive(studentId),
};
