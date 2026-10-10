// LOCAL PREVIEW ONLY. Boots the real API on an in-memory Postgres (PGlite) with a fake auth provider and
// storage, so the UI can be explored without Supabase credentials. Nothing is persisted.
//
//   npm run preview                    # AI shows "not configured" (honest default)
//   PREVIEW_FAKE_AI=1 npm run preview  # canned AI answers, to look at the AI screens (clearly marked)
//
// Refuses to run in production. Never use this for real users.
import { createTestEnv } from '../tests/helpers/harness.js';

if (process.env.NODE_ENV === 'production') {
  console.error('dev-preview refuses to run with NODE_ENV=production.');
  process.exit(1);
}

const PORT = Number(process.env.PORT || 4000);
const PREVIEW_PW = 'Preview#2026';
const t = await createTestEnv({ configuredAi: process.env.PREVIEW_FAKE_AI === '1' });
const { seed, db } = t;

// ---- sample data (labelled) ----------------------------------------------------------------------------
const college = await seed.college('Preview Institute of Technology (sample data)');
const other = await seed.college('Another College (sample data)');
await db.query("update colleges set city = 'Sample City' where id = $1", [college]);
const mk = async (opts) => {
  const u = await seed.user(opts);
  await db.query('update profiles set email = $2 where id = $1', [u.id, opts.email]);
  t.authAdmin.users.delete(u.email);
  t.authAdmin.users.set(opts.email, { id: u.id, password: PREVIEW_PW, confirmed: true });
  return u;
};
const admin = await mk({ role: 'admin', fullName: 'Asha Admin', email: 'admin@preview.test' });
const staff = await mk({ role: 'placement_cell', collegeId: college, fullName: 'Pooja Placement', email: 'placement@preview.test' });
await mk({ role: 'placement_cell', collegeId: college, status: 'pending', fullName: 'Pending Officer', email: 'pending@preview.test' });
const s1 = await mk({ role: 'student', collegeId: college, fullName: 'Riya Sharma', email: 'riya@preview.test', verified: true, student: { cgpa: 8.6, skills: ['JavaScript', 'React', 'Node.js', 'SQL', 'Git'], department: 'CSE' } });
await mk({ role: 'student', collegeId: college, fullName: 'Arjun Mehta', email: 'arjun@preview.test', verified: true, student: { cgpa: 6.4, activeBacklogs: 1, skills: ['Java', 'SQL'], department: 'IT' } });
await mk({ role: 'student', collegeId: college, fullName: 'Neha Iyer', email: 'neha@preview.test', student: { cgpa: 7.8, skills: ['Python', 'SQL'], department: 'CSE' } });
await mk({ role: 'student', collegeId: other, fullName: 'Other College Student', email: 'other@preview.test', verified: true });

const acme = await seed.company(college, 'Acme Software (sample data)');
const orbit = await seed.company(college, 'Orbit Labs (sample data)');
const d1 = await seed.drive({
  collegeId: college, companyId: acme, title: 'Software Engineer', deadlineHours: 24 * 9,
  eligibility: { minCgpa: 7, maxBacklogs: 0, allowedDepartments: ['CSE', 'IT'], allowedYears: [2026] },
  skills: [{ skill: 'JavaScript' }, { skill: 'React' }, { skill: 'Docker' }, { skill: 'GraphQL', importance: 'preferred' }],
});
await seed.drive({
  collegeId: college, companyId: orbit, title: 'Data Analyst Intern', deadlineHours: 24 * 5, eligibility: { minCgpa: 6 },
  skills: [{ skill: 'SQL' }, { skill: 'Python' }],
});
await db.query("update drives set description = $2, job_type = 'full_time', package_lpa = 9.5, location = 'Pune' where id = $1", [d1, 'Build and ship product features with a small team.\nSample drive for local preview.']);
await db.query(`insert into applications (student_id, drive_id, college_id, eligibility_snapshot) values ($1,$2,$3,$4::jsonb)`, [s1.id, d1, college, JSON.stringify({ status: 'eligible', criteria: [] })]);
await db.query("insert into application_status_history (application_id, to_status, changed_by) select id, 'applied', $1 from applications", [s1.id]);
await db.query("insert into notifications (user_id, type, title, body, link) values ($1,'new_drive','New drive: Software Engineer','Acme Software is hiring.','/student/drives')", [s1.id]);
void admin; void staff;

// ---- optional canned AI ----------------------------------------------------------------------------------------
if (process.env.PREVIEW_FAKE_AI === '1') {
  t.gemini.handler = ({ system, user }) => {
    if (/extract structured information/i.test(system)) {
      return { skills: ['React', 'Node.js', 'Docker'], education: [], experience: [{ organization: 'Sample Labs', role: 'Intern', duration: '2 months', description: '[preview AI] Built dashboards.' }], projects: [{ title: 'Campus portal', description: '[preview AI] Event portal using React and Express.', technologies: ['React', 'Express'] }], certifications: ['Sample certification'] };
    }
    if (/resume reviewer/i.test(system)) {
      const c = (key, score, reason) => ({ key, score, reason: `[preview AI] ${reason}` });
      return {
        components: [c('content_clarity', 78, 'Clear, concise bullet points.'), c('skills_presentation', 72, 'Skills are grouped sensibly.'), c('project_quality', 64, 'One strong project; add outcomes.'), c('experience_impact', 55, 'Internship lacks measurable results.'), c('structure_formatting', 88, 'Clean single-column layout.'), c('ats_keywords', 70, 'Good keywords for web roles.')],
        strengths: ['Hands-on web projects', 'Readable layout'], weaknesses: ['Few quantified results', 'No testing evidence'], missingSkills: ['Docker', 'TypeScript'],
        improvements: [{ area: 'Projects', suggestion: 'Add users, performance or accuracy numbers to each project.', priority: 'high' }, { area: 'Summary', suggestion: 'Open with a two-line profile tailored to your target role.', priority: 'medium' }],
        projectRelevance: { score: 66, reason: '[preview AI] Projects use common web stacks.' },
      };
    }
    if (/PROFILE fits a job posting/i.test(system)) {
      return { roleRelevance: { score: 74, reason: '[preview AI] Internship experience is close to the role.', signals: ['Web internship'] }, projectRelevance: { score: 68, reason: '[preview AI] Projects use the same stack.' } };
    }
    if (/placement mentor/i.test(system)) {
      let missing = [];
      try { missing = JSON.parse(user.replace(/[\s\S]*?<profile_data>\n([\s\S]*?)\n<\/profile_data>[\s\S]*/, '$1')).missingSkills ?? []; } catch { /* ignore */ }
      return { items: missing.map((m) => ({ skill: m.skill ?? m, priority: 'medium', learningSteps: [`[preview AI] Learn the fundamentals of ${m.skill ?? m}`, 'Build a small project using it'], resourceTypes: ['official documentation', 'hands-on project'], estimatedWeeks: 3 })) };
    }
    if (/prepare interview questions/i.test(system)) {
      return { technical: [{ question: '[preview AI] Explain how React re-renders a component.', topic: 'React', difficulty: 'medium', whatGoodLooksLike: 'Mentions state, props and reconciliation.' }], hr: [{ question: '[preview AI] Why do you want to join this company?', whyAsked: 'Checks motivation.' }] };
    }
    if (/career mentor/i.test(system)) {
      return { summary: '[preview AI] Focus on closing your top skill gaps, then practise interviews.', phases: [{ label: 'Weeks 1-2', focus: 'Fundamentals', goals: ['Learn Docker basics'], tasks: ['Containerise one project'] }, { label: 'Weeks 3-4', focus: 'Practice', goals: ['Mock interviews'], tasks: ['Solve 20 practice problems'] }] };
    }
    return { headline: '[preview AI] Participation is concentrated in a few departments.', observations: [{ title: 'Verification backlog', detail: 'Some students are still unverified.', metricRefs: ['students_unverified'] }], recommendations: ['Verify pending profiles before the next drive.'] };
  };
}

const server = t.app.listen(PORT, () => {
  console.log('\n=================  TalentBridge LOCAL PREVIEW (not for real use)  =================');
  console.log(`API on http://localhost:${PORT}  |  in-memory data, resets on restart`);
  console.log(`AI: ${process.env.PREVIEW_FAKE_AI === '1' ? 'canned preview answers (marked [preview AI])' : 'not configured (shows the unavailable state)'}`);
  console.log(`Password for every account: ${PREVIEW_PW}`);
  console.log('  admin@preview.test      (admin)');
  console.log('  placement@preview.test  (placement cell)');
  console.log('  pending@preview.test    (placement cell awaiting approval)');
  console.log('  riya@preview.test       (verified student, applied)');
  console.log('  arjun@preview.test      (verified, ineligible for the SWE drive)');
  console.log('  neha@preview.test       (unverified student)');
  console.log('===================================================================================\n');
});
process.on('SIGINT', () => server.close(() => process.exit(0)));
