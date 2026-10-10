// Request validation schemas (zod). Unknown keys are stripped, so a client can never smuggle
// `role`, `status`, `collegeId` (for staff) or similar fields into a mutation.
import { z } from 'zod';

export const uuid = z.string().uuid();
export const idParam = z.object({ id: uuid });

const text = (max, min = 0) => z.string().trim().min(min).max(max);
const optText = (max) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .transform((v) => (v === '' ? undefined : v));
const httpUrl = z
  .string()
  .trim()
  .max(300)
  .refine((v) => {
    try {
      const u = new URL(v);
      return ['http:', 'https:'].includes(u.protocol);
    } catch {
      return false;
    }
  }, 'Must be a valid http(s) link');
const optUrl = z.union([httpUrl, z.literal('')]).optional().transform((v) => (v === '' ? undefined : v));
const email = z.string().trim().toLowerCase().email().max(254);
const password = z.string().min(8, 'Use at least 8 characters').max(72);
const phone = z
  .string()
  .trim()
  .regex(/^[0-9+\-\s()]{7,20}$/, 'Enter a valid phone number')
  .optional()
  .or(z.literal('').transform(() => undefined));
const num = (min, max) => z.coerce.number().min(min).max(max);
const isoDate = z.coerce.date().transform((d) => d.toISOString());
const dateOnly = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD');

export const pagingQuery = z.object({
  page: z.coerce.number().int().min(1).optional(),
  pageSize: z.coerce.number().int().min(1).max(100).optional(),
});

// ---- auth -------------------------------------------------------------------
export const registerBody = z.object({
  email,
  password,
  fullName: text(120, 1),
  phone,
  collegeId: uuid,
  consent: z.literal(true, { error: 'You must accept the privacy notice to register' }),
});

export const acceptInviteBody = z.object({
  token: text(200, 20),
  password,
  fullName: text(120, 1),
  phone,
  consent: z.literal(true, { error: 'You must accept the privacy notice' }),
});

export const loginBody = z.object({ email, password: z.string().min(1).max(200) });
export const refreshBody = z.object({ refreshToken: text(2000, 10) });
export const forgotBody = z.object({ email });
export const resetBody = z.object({ accessToken: text(4000, 10), password });

// ---- student profile ---------------------------------------------------------------
export const profileBody = z.object({
  fullName: text(120, 1).optional(),
  phone,
  department: text(80).optional(),
  rollNumber: text(40).optional(),
  passingYear: z.coerce.number().int().min(2000).max(2100).nullable().optional(),
  cgpa: num(0, 10).nullable().optional(),
  tenthPercent: num(0, 100).nullable().optional(),
  twelfthPercent: num(0, 100).nullable().optional(),
  activeBacklogs: z.coerce.number().int().min(0).max(50).nullable().optional(),
  skills: z.array(text(60, 1)).max(60).optional(),
  certifications: z.array(z.object({ name: text(160, 1), issuer: optText(120), year: z.coerce.number().int().min(1990).max(2100).optional() })).max(30).optional(),
  links: z.object({ github: optUrl, linkedin: optUrl, portfolio: optUrl }).optional(),
  careerInterests: z.array(text(80, 1)).max(10).optional(),
});

export const projectBody = z.object({
  title: text(200, 1),
  description: optText(2000),
  tech: z.array(text(40, 1)).max(15).default([]),
  url: optUrl,
});

export const experienceBody = z.object({
  kind: z.enum(['internship', 'job', 'other']).default('internship'),
  organization: text(200, 1),
  role: optText(120),
  startDate: dateOnly.optional(),
  endDate: dateOnly.optional(),
  description: optText(2000),
});

export const applyParsedBody = z.object({
  skills: z.array(text(60, 1)).max(60).default([]),
  projects: z.array(projectBody).max(10).default([]),
  experience: z.array(experienceBody).max(10).default([]),
  certifications: z.array(text(160, 1)).max(15).default([]),
});

export const verificationBody = z.object({
  status: z.enum(['verified', 'needs_changes']),
  comment: optText(1000),
});

export const studentListQuery = pagingQuery.extend({
  collegeId: uuid.optional(),
  department: text(80).optional(),
  passingYear: z.coerce.number().int().optional(),
  verification: z.enum(['unverified', 'verified', 'needs_changes']).optional(),
  q: text(100).optional(),
});

// ---- companies / drives -----------------------------------------------------------------
export const companyBody = z.object({
  name: text(200, 1),
  website: optUrl,
  industry: optText(120),
  contactPerson: optText(120),
  contactEmail: z.union([email, z.literal('')]).optional().transform((v) => v || undefined),
  contactPhone: phone,
  notes: optText(2000),
  status: z.enum(['active', 'inactive']).optional(),
  collegeId: uuid.optional(),
});
export const companyPatch = companyBody.partial().omit({ collegeId: true });

export const eligibilityBody = z.object({
  minCgpa: num(0, 10).nullable().optional(),
  maxBacklogs: z.coerce.number().int().min(0).max(50).nullable().optional(),
  allowedDepartments: z.array(text(80, 1)).max(30).default([]),
  allowedYears: z.array(z.coerce.number().int().min(2000).max(2100)).max(10).default([]),
  minTenthPercent: num(0, 100).nullable().optional(),
  minTwelfthPercent: num(0, 100).nullable().optional(),
});

const driveSkills = z.array(z.object({ skill: text(80, 1), importance: z.enum(['mandatory', 'preferred']).default('mandatory') })).max(40);

export const driveBody = z.object({
  companyId: uuid,
  collegeId: uuid.optional(),
  title: text(200, 1),
  description: optText(5000),
  jobType: z.enum(['full_time', 'internship']).default('full_time'),
  location: optText(120),
  packageLpa: num(0, 1000).optional(),
  stipendPerMonth: num(0, 10_000_000).optional(),
  openings: z.coerce.number().int().min(1).max(100_000).optional(),
  deadline: isoDate,
  driveDate: isoDate.optional(),
  status: z.enum(['draft', 'open']).default('draft'),
  skills: driveSkills.default([]),
  eligibility: eligibilityBody.default({ allowedDepartments: [], allowedYears: [] }),
});

export const drivePatch = z.object({
  title: text(200, 1).optional(),
  description: optText(5000),
  jobType: z.enum(['full_time', 'internship']).optional(),
  location: optText(120),
  packageLpa: num(0, 1000).optional(),
  stipendPerMonth: num(0, 10_000_000).optional(),
  openings: z.coerce.number().int().min(1).max(100_000).optional(),
  driveDate: isoDate.optional(),
  skills: driveSkills.optional(),
  eligibility: eligibilityBody.optional(),
});

export const driveStatusBody = z.object({ status: z.enum(['open', 'closed', 'completed', 'cancelled']) });
export const extendDeadlineBody = z.object({ deadline: isoDate, reason: text(500, 5) });

export const driveListQuery = pagingQuery.extend({
  collegeId: uuid.optional(),
  status: z.enum(['draft', 'open', 'closed', 'completed', 'cancelled']).optional(),
  companyId: uuid.optional(),
  q: text(100).optional(),
});

// ---- applications / exceptions / interviews -----------------------------------------------------
export const applyBody = z.object({ driveId: uuid });
export const applicationStatusBody = z.object({
  status: z.enum(['under_review', 'shortlisted', 'interview_scheduled', 'selected', 'rejected']),
  note: optText(500),
});
export const applicationOrderBody = z.object({ driveId: uuid, applicationIds: z.array(uuid).min(1).max(2000) });
export const applicationListQuery = pagingQuery.extend({
  collegeId: uuid.optional(),
  driveId: uuid.optional(),
  status: z.enum(['applied', 'under_review', 'shortlisted', 'interview_scheduled', 'selected', 'rejected', 'withdrawn']).optional(),
  q: text(100).optional(),
});

export const exceptionBody = z.object({ driveId: uuid, reason: text(1000, 10) });
export const exceptionDecisionBody = z.object({ decision: z.enum(['approved', 'rejected']), note: optText(1000) });
export const exceptionListQuery = pagingQuery.extend({
  collegeId: uuid.optional(),
  status: z.enum(['pending', 'approved', 'rejected', 'withdrawn']).optional(),
  driveId: uuid.optional(),
});

export const interviewBody = z.object({
  applicationId: uuid,
  roundName: text(100, 1),
  scheduledAt: isoDate,
  mode: z.enum(['online', 'offline']),
  venueOrLink: optText(500),
  notes: optText(1000),
});
export const interviewPatch = z.object({
  roundName: text(100, 1).optional(),
  scheduledAt: isoDate.optional(),
  mode: z.enum(['online', 'offline']).optional(),
  venueOrLink: optText(500),
  notes: optText(1000),
  status: z.enum(['scheduled', 'completed', 'cancelled']).optional(),
});
export const interviewListQuery = pagingQuery.extend({
  collegeId: uuid.optional(),
  driveId: uuid.optional(),
  upcoming: z.enum(['true', 'false']).optional().transform((v) => v === 'true'),
});

// ---- admin ----------------------------------------------------------------------------------------
export const userListQuery = pagingQuery.extend({
  role: z.enum(['admin', 'placement_cell', 'student']).optional(),
  status: z.enum(['pending', 'active', 'suspended', 'rejected']).optional(),
  collegeId: uuid.optional(),
  q: text(100).optional(),
});
export const userStatusBody = z.object({ status: z.enum(['active', 'rejected', 'suspended']), reason: optText(500) });
export const userRoleBody = z.object({ role: z.enum(['admin', 'placement_cell', 'student']), collegeId: uuid.optional() });
export const createAdminBody = z.object({ email, fullName: text(120, 1), password });
export const inviteBody = z.object({ email, collegeId: uuid });
export const collegeBody = z.object({ name: text(200, 2), code: optText(30), city: optText(80) });
export const collegePatch = collegeBody.partial();
export const auditQuery = pagingQuery.extend({
  action: text(80).optional(),
  actorId: uuid.optional(),
  targetType: text(60).optional(),
  collegeId: uuid.optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
});

const weights = (keys) =>
  z
    .object(Object.fromEntries(keys.map((k) => [k, z.coerce.number().min(0).max(100)])))
    .refine((o) => Object.values(o).some((v) => v > 0), 'At least one weight must be above zero');
export const settingsBody = z
  .object({
    readiness_weights: weights(['academics', 'skills', 'projects', 'experience', 'resume', 'completeness']),
    match_weights: weights(['skills', 'role', 'academic', 'projects']),
    upload_max_mb: z.coerce.number().min(1).max(25),
    ai_enabled: z.boolean(),
    ai_user_hourly_limit: z.coerce.number().int().min(1).max(500),
    invite_expiry_days: z.coerce.number().int().min(1).max(30),
  })
  .partial()
  .strict();

// ---- notifications / ai -------------------------------------------------------------------------------
export const notificationQuery = pagingQuery.extend({
  unread: z.enum(['true', 'false']).optional().transform((v) => v === 'true'),
});
export const forceBody = z.object({ force: z.boolean().optional() });
export const skillGapBody = z
  .object({ driveId: uuid.optional(), targetRole: text(120, 2).optional(), force: z.boolean().optional() })
  .refine((o) => o.driveId || o.targetRole, 'Provide a driveId or a targetRole');
export const questionsBody = z.object({ driveId: uuid, studentId: uuid.optional(), force: z.boolean().optional() });
export const roadmapBody = z.object({ weeks: z.union([z.literal(4), z.literal(8), z.literal(12)]).default(8), force: z.boolean().optional() });
export const rankingBody = z.object({
  pool: z.enum(['applicants', 'eligible']).default('applicants'),
  ai: z.boolean().default(false),
  force: z.boolean().optional(),
});
export const insightsBody = z.object({ collegeId: uuid.optional(), force: z.boolean().optional() });
export const collegeQuery = z.object({ collegeId: uuid.optional() });
