// Analytics: every number here comes from SQL/code over real app data. Nothing is estimated or invented.
import { ctx } from '../context.js';
import { drives } from '../repositories/drives.js';
import { students } from '../repositories/students.js';
import { assertCollegeAccess, scopeCollege } from './common.js';
import { evaluateRow } from './drives.js';
import { skillKey } from '../domain/skills.js';
import { notFound } from '../utils/errors.js';
import { toCsv } from '../utils/helpers.js';

const q = (text, params) => ctx.db.query(text, params).then((r) => r.rows);
const kv = (rows, k = 'status') => Object.fromEntries(rows.map((r) => [r[k], r.n]));

export const analyticsService = {
  async overview(user, requestedCollegeId) {
    const college = scopeCollege(user, requestedCollegeId);
    const [studentsBy, drivesBy, appsBy, exBy, dept, perDrive, trend, upcoming, interviewsUp] = await Promise.all([
      q(`select sp.verification_status as status, count(*)::int as n
           from student_profiles sp join profiles p on p.id = sp.user_id
          where p.status = 'active' and ($1::uuid is null or sp.college_id = $1) group by 1`, [college]),
      q(`select status, count(*)::int as n from drives where ($1::uuid is null or college_id = $1) group by 1`, [college]),
      q(`select status, count(*)::int as n from applications where ($1::uuid is null or college_id = $1) group by 1`, [college]),
      q(`select status, count(*)::int as n from exception_requests where ($1::uuid is null or college_id = $1) group by 1`, [college]),
      q(`select coalesce(nullif(sp.department,''), 'Not set') as department,
               count(*)::int as students,
               count(*) filter (where exists (select 1 from applications a where a.student_id = sp.user_id and a.status <> 'withdrawn'))::int as applicants,
               count(*) filter (where exists (select 1 from applications a where a.student_id = sp.user_id and a.status = 'selected'))::int as selected
          from student_profiles sp join profiles p on p.id = sp.user_id
         where p.status = 'active' and ($1::uuid is null or sp.college_id = $1)
         group by 1 order by 2 desc`, [college]),
      q(`select d.id, d.title, c.name as company, d.status,
               count(a.id) filter (where a.status <> 'withdrawn')::int as applications,
               count(a.id) filter (where a.status in ('shortlisted','interview_scheduled'))::int as shortlisted,
               count(a.id) filter (where a.status = 'selected')::int as selected
          from drives d join companies c on c.id = d.company_id left join applications a on a.drive_id = d.id
         where ($1::uuid is null or d.college_id = $1)
         group by d.id, c.name order by applications desc, d.created_at desc limit 10`, [college]),
      q(`select to_char(date_trunc('month', applied_at), 'YYYY-MM') as month, count(*)::int as applications,
               count(*) filter (where status = 'selected')::int as selected
          from applications where ($1::uuid is null or college_id = $1) and applied_at >= now() - interval '6 months'
         group by 1 order by 1`, [college]),
      q(`select d.id, d.title, c.name as company, d.deadline
          from drives d join companies c on c.id = d.company_id
         where d.status = 'open' and d.deadline >= now() and ($1::uuid is null or d.college_id = $1)
         order by d.deadline limit 5`, [college]),
      q(`select count(*)::int as n from interviews where status = 'scheduled' and scheduled_at >= now()
            and ($1::uuid is null or college_id = $1)`, [college]),
    ]);

    const totalStudents = Object.values(kv(studentsBy)).reduce((a, b) => a + b, 0);
    return {
      collegeId: college,
      students: { total: totalStudents, byVerification: kv(studentsBy) },
      drives: { byStatus: kv(drivesBy) },
      applications: { total: Object.values(kv(appsBy)).reduce((a, b) => a + b, 0), byStatus: kv(appsBy) },
      exceptions: { byStatus: kv(exBy) },
      departments: dept,
      topDrives: perDrive,
      monthlyTrend: trend,
      upcomingDeadlines: upcoming,
      upcomingInterviews: interviewsUp[0]?.n ?? 0,
      hasData: totalStudents > 0,
    };
  },

  /** Most common missing mandatory skills across students, for currently open drives (profile skills only). */
  async skillGapReport(user, requestedCollegeId) {
    const college = scopeCollege(user, requestedCollegeId);
    const open = (await drives.list({ collegeId: college, status: 'open', limit: 200, offset: 0 })).items;
    const skillsMap = await drives.skillsForDrives(open.map((d) => d.id));
    const roster = await students.listAllForCollege(college);
    const verified = roster;
    const agg = new Map();
    for (const d of open) {
      for (const s of (skillsMap.get(d.id) ?? []).filter((x) => x.importance === 'mandatory')) {
        const key = skillKey(s.skill);
        const entry = agg.get(key) ?? { skill: s.skill, drives: new Set(), missing: 0 };
        entry.drives.add(d.id);
        agg.set(key, entry);
      }
    }
    for (const entry of agg.values()) {
      const key = skillKey(entry.skill);
      entry.missing = verified.filter((s) => !(s.skills ?? []).some((x) => skillKey(x) === key)).length;
    }
    const total = verified.length;
    return {
      studentsConsidered: total,
      openDrives: open.length,
      skills: [...agg.values()]
        .map((e) => ({ skill: e.skill, drives: e.drives.size, studentsMissing: e.missing, percentMissing: total ? Math.round((e.missing / total) * 100) : 0 }))
        .sort((a, b) => b.studentsMissing - a.studentsMissing)
        .slice(0, 15),
      note: 'Based on skills listed on student profiles only.',
    };
  },

  /** Why students fall out of eligibility across open drives. */
  async eligibilityDropoff(user, requestedCollegeId) {
    const college = scopeCollege(user, requestedCollegeId);
    const open = (await drives.list({ collegeId: college, status: 'open', limit: 200, offset: 0 })).items;
    const eligMap = await drives.eligibilityForDrives(open.map((d) => d.id));
    const roster = await students.listAllForCollege(college);
    const totals = { eligible: 0, ineligible: 0, incomplete: 0 };
    const failedBy = {};
    const perDrive = open.map((d) => {
      const c = { eligible: 0, ineligible: 0, incomplete: 0 };
      for (const s of roster) {
        const ev = evaluateRow(s, eligMap.get(d.id));
        c[ev.status] += 1;
        totals[ev.status] += 1;
        for (const k of ev.failed) failedBy[k] = (failedBy[k] ?? 0) + 1;
      }
      return { driveId: d.id, title: d.title, company: d.companyName, ...c };
    });
    return { openDrives: open.length, students: roster.length, totals, failedByCriterion: failedBy, perDrive };
  },

  async exceptionTrends(user, requestedCollegeId) {
    const college = scopeCollege(user, requestedCollegeId);
    const [byStatus, byMonth, byCriterion] = await Promise.all([
      q(`select status, count(*)::int as n from exception_requests where ($1::uuid is null or college_id = $1) group by 1`, [college]),
      q(`select to_char(date_trunc('month', created_at), 'YYYY-MM') as month, count(*)::int as n
           from exception_requests where ($1::uuid is null or college_id = $1) group by 1 order by 1`, [college]),
      q(`select c->>'key' as key, count(*)::int as n
           from exception_requests r, jsonb_array_elements(r.eligibility_snapshot->'criteria') c
          where c->>'state' = 'fail' and ($1::uuid is null or r.college_id = $1) group by 1 order by 2 desc`, [college]),
    ]);
    return { byStatus: kv(byStatus), byMonth, byCriterion: kv(byCriterion, 'key') };
  },

  async driveReport(user, driveId) {
    const drive = await drives.findById(driveId);
    if (!drive) throw notFound('Drive not found');
    assertCollegeAccess(user, drive.collegeId);
    const [byStatus, byDept, rows] = await Promise.all([
      q('select status, count(*)::int as n from applications where drive_id = $1 group by 1', [driveId]),
      q(`select coalesce(nullif(sp.department,''), 'Not set') as department,
               count(*)::int as applicants,
               count(*) filter (where a.status in ('shortlisted','interview_scheduled','selected'))::int as shortlisted,
               count(*) filter (where a.status = 'selected')::int as selected
          from applications a join student_profiles sp on sp.user_id = a.student_id
         where a.drive_id = $1 and a.status <> 'withdrawn' group by 1 order by 2 desc`, [driveId]),
      q(`select p.full_name, p.email, sp.roll_number, sp.department, sp.passing_year, sp.cgpa, a.status, a.via_exception, a.applied_at
          from applications a join profiles p on p.id = a.student_id join student_profiles sp on sp.user_id = a.student_id
         where a.drive_id = $1 order by a.applied_at`, [driveId]),
    ]);
    const counts = kv(byStatus);
    return {
      drive: { id: drive.id, title: drive.title, company: drive.companyName, status: drive.status },
      totals: {
        applicants: Object.entries(counts).filter(([s]) => s !== 'withdrawn').reduce((a, [, n]) => a + n, 0),
        shortlisted: (counts.shortlisted ?? 0) + (counts.interview_scheduled ?? 0) + (counts.selected ?? 0),
        selected: counts.selected ?? 0,
        rejected: counts.rejected ?? 0,
        withdrawn: counts.withdrawn ?? 0,
      },
      byStatus: counts,
      byDepartment: byDept,
      rows,
    };
  },

  async driveReportCsv(user, driveId) {
    const r = await this.driveReport(user, driveId);
    const csv = toCsv(r.rows, [
      { label: 'Name', key: 'full_name' }, { label: 'Email', key: 'email' }, { label: 'Roll number', key: 'roll_number' },
      { label: 'Department', key: 'department' }, { label: 'Batch', key: 'passing_year' }, { label: 'CGPA', key: 'cgpa' },
      { label: 'Status', key: 'status' }, { label: 'Via exception', value: (x) => (x.via_exception ? 'Yes' : 'No') },
      { label: 'Applied at', key: 'applied_at' },
    ]);
    return { csv, filename: `drive-${r.drive.title.replace(/[^\w]+/g, '-').toLowerCase()}.csv` };
  },

  async companyReportCsv(user, companyId) {
    const company = await ctx.db.query('select * from companies where id = $1', [companyId]).then((r) => r.rows[0]);
    if (!company) throw notFound('Company not found');
    assertCollegeAccess(user, company.college_id);
    const rows = await q(
      `select d.title as drive, d.status as drive_status, d.deadline,
              count(a.id) filter (where a.status <> 'withdrawn')::int as applicants,
              count(a.id) filter (where a.status in ('shortlisted','interview_scheduled','selected'))::int as shortlisted,
              count(a.id) filter (where a.status = 'selected')::int as selected
         from drives d left join applications a on a.drive_id = d.id
        where d.company_id = $1 group by d.id order by d.created_at`, [companyId]);
    return {
      csv: toCsv(rows, [
        { label: 'Drive', key: 'drive' }, { label: 'Status', key: 'drive_status' }, { label: 'Deadline', key: 'deadline' },
        { label: 'Applicants', key: 'applicants' }, { label: 'Shortlisted', key: 'shortlisted' }, { label: 'Selected', key: 'selected' },
      ]),
      filename: `company-${company.name.replace(/[^\w]+/g, '-').toLowerCase()}.csv`,
    };
  },

  /** Platform-wide numbers for admins. */
  async platformMetrics() {
    const [users, colleges, companies, drivesBy, apps, ai, audit7, pending] = await Promise.all([
      q('select role, status, count(*)::int as n from profiles group by 1, 2'),
      q('select count(*)::int as n from colleges'),
      q('select count(*)::int as n from companies'),
      q('select status, count(*)::int as n from drives group by 1'),
      q('select status, count(*)::int as n from applications group by 1'),
      q(`select feature, status, count(*)::int as n from ai_analyses where created_at >= now() - interval '30 days' group by 1, 2`),
      q(`select count(*)::int as n from audit_logs where created_at >= now() - interval '7 days'`),
      q("select count(*)::int as n from profiles where role = 'placement_cell' and status = 'pending'"),
    ]);
    return {
      users,
      colleges: colleges[0].n,
      companies: companies[0].n,
      drives: kv(drivesBy),
      applications: kv(apps),
      aiUsageLast30Days: ai,
      auditEventsLast7Days: audit7[0].n,
      pendingPlacementCellApprovals: pending[0].n,
    };
  },
};
