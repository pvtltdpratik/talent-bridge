import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bearer, createTestEnv } from '../helpers/harness.js';

let t;
let A; // college A
let B; // college B
let staffA;
let staffB;
let admin;
let companyA;

beforeAll(async () => {
  t = await createTestEnv();
  A = await t.seed.college('Alpha Institute');
  B = await t.seed.college('Beta College');
  staffA = await t.seed.user({ role: 'placement_cell', collegeId: A });
  staffB = await t.seed.user({ role: 'placement_cell', collegeId: B });
  admin = await t.seed.user({ role: 'admin' });
  companyA = await t.seed.company(A, 'Acme Corp');
});
afterAll(() => t.close());

const api = () => request(t.app);
const q = (sql, params) => t.db.query(sql, params).then((r) => r.rows);
const newDrive = (opts = {}) => t.seed.drive({ collegeId: A, companyId: companyA, eligibility: { minCgpa: 7 }, ...opts });
const verifiedStudent = (student = {}, collegeId = A) => t.seed.user({ role: 'student', collegeId, verified: true, student });
const apply = (user, driveId) => api().post('/api/applications').set(bearer(user)).send({ driveId });

describe('applying (Sections 6 and 7)', () => {
  it('lets an eligible, verified student apply once and stores history + eligibility snapshot', async () => {
    const drive = await newDrive();
    const s = await verifiedStudent({ cgpa: 8 });
    const res = await apply(s, drive);
    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({ status: 'applied', viaException: false });

    const [app] = await q('select * from applications where id = $1', [res.body.data.id]);
    expect(app.eligibility_snapshot.status).toBe('eligible');
    expect(app.eligibility_snapshot.criteria.find((c) => c.key === 'cgpa')).toMatchObject({ state: 'pass', actual: 8, required: 7 });
    const hist = await q('select * from application_status_history where application_id = $1', [app.id]);
    expect(hist).toHaveLength(1);
    expect(hist[0]).toMatchObject({ from_status: null, to_status: 'applied', changed_by: s.id });
  });

  it('blocks a duplicate application (API and database constraint)', async () => {
    const drive = await newDrive();
    const s = await verifiedStudent();
    expect((await apply(s, drive)).status).toBe(201);
    const dup = await apply(s, drive);
    expect(dup.status).toBe(409);
    expect(dup.body.error.code).toBe('already_applied');
    await expect(
      t.db.query(
        `insert into applications (student_id, drive_id, college_id, eligibility_snapshot) values ($1,$2,$3,'{}')`,
        [s.id, drive, A],
      ),
    ).rejects.toThrow(/applications_one_per_drive|duplicate key/);
  });

  it('only one of two concurrent applications succeeds', async () => {
    const drive = await newDrive();
    const s = await verifiedStudent();
    const results = await Promise.all([apply(s, drive), apply(s, drive)]);
    expect(results.map((r) => r.status).sort()).toEqual([201, 409]);
    expect(await q('select 1 from applications where student_id = $1 and drive_id = $2', [s.id, drive])).toHaveLength(1);
  });

  it('requires the profile to be verified by the placement cell', async () => {
    const drive = await newDrive();
    const s = await t.seed.user({ role: 'student', collegeId: A, student: { cgpa: 9 } });
    const res = await apply(s, drive);
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('profile_not_verified');
  });

  it('rejects an ineligible student with a reason per failed criterion', async () => {
    const drive = await newDrive({ eligibility: { minCgpa: 7, maxBacklogs: 0 } });
    const s = await verifiedStudent({ cgpa: 6.8, activeBacklogs: 2 });
    const res = await apply(s, drive);
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('not_eligible');
    const reasons = res.body.error.details.criteria.filter((c) => c.state === 'fail').map((c) => c.reason);
    expect(reasons).toContain('CGPA 6.8 is below the required 7');
    expect(reasons.some((r) => r.includes('backlog'))).toBe(true);
    expect(await q('select 1 from applications where student_id = $1', [s.id])).toHaveLength(0);
  });

  it('treats missing profile data as incomplete, not ineligible', async () => {
    const drive = await newDrive();
    const s = await verifiedStudent({ cgpa: null });
    const res = await apply(s, drive);
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('profile_incomplete');
    expect(res.body.error.details.missing).toContain('cgpa');
  });

  it('enforces the deadline and drive status on the backend', async () => {
    const s = await verifiedStudent();
    const late = await newDrive();
    await t.db.query("update drives set deadline = now() - interval '1 hour' where id = $1", [late]);
    const r1 = await apply(s, late);
    expect(r1.status).toBe(409);
    expect(r1.body.error.code).toBe('deadline_passed');

    const closed = await newDrive({ status: 'closed' });
    expect((await apply(s, closed)).body.error.code).toBe('drive_not_open');
    const draft = await newDrive({ status: 'draft' });
    expect((await apply(s, draft)).status).toBe(404);
  });

  it('hides other colleges\' drives', async () => {
    const otherCompany = await t.seed.company(B);
    const d = await t.seed.drive({ collegeId: B, companyId: otherCompany });
    const s = await verifiedStudent();
    expect((await apply(s, d)).status).toBe(404);
    expect((await api().get(`/api/drives/${d}`).set(bearer(s))).status).toBe(404);
  });

  it('lets a student withdraw before a decision and re-apply; decisions cannot be withdrawn', async () => {
    const drive = await newDrive();
    const s = await verifiedStudent();
    const { id } = (await apply(s, drive)).body.data;
    const w = await api().post(`/api/applications/${id}/withdraw`).set(bearer(s));
    expect(w.status).toBe(200);
    expect(w.body.data.status).toBe('withdrawn');
    const again = await apply(s, drive);
    expect(again.status).toBe(201);
    expect(again.body.data.id).toBe(id);

    await api().patch(`/api/applications/${id}/status`).set(bearer(staffA)).send({ status: 'shortlisted' });
    await api().patch(`/api/applications/${id}/status`).set(bearer(staffA)).send({ status: 'selected' });
    const late = await api().post(`/api/applications/${id}/withdraw`).set(bearer(s));
    expect(late.status).toBe(409);
  });
});

describe('application decisions are human, scoped and audited', () => {
  it('staff of the same college decide; history, audit and notification are written', async () => {
    const drive = await newDrive();
    const s = await verifiedStudent();
    const { id } = (await apply(s, drive)).body.data;

    const res = await api().patch(`/api/applications/${id}/status`).set(bearer(staffA)).send({ status: 'shortlisted', note: 'Strong profile' });
    expect(res.status).toBe(200);

    const hist = await q('select from_status, to_status, changed_by, note from application_status_history where application_id = $1 order by created_at, id', [id]);
    expect(hist.at(-1)).toEqual({ from_status: 'applied', to_status: 'shortlisted', changed_by: staffA.id, note: 'Strong profile' });
    const audit = await q("select * from audit_logs where action = 'application.status_changed' and target_id = $1", [id]);
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({ actor_id: staffA.id, old_value: { status: 'applied' } });
    const notes = await q("select * from notifications where user_id = $1 and type = 'application_status'", [s.id]);
    expect(notes).toHaveLength(1);
  });

  it('students cannot set statuses; other colleges\' staff get 404', async () => {
    const drive = await newDrive();
    const s = await verifiedStudent();
    const { id } = (await apply(s, drive)).body.data;
    expect((await api().patch(`/api/applications/${id}/status`).set(bearer(s)).send({ status: 'selected' })).status).toBe(403);
    expect((await api().patch(`/api/applications/${id}/status`).set(bearer(staffB)).send({ status: 'selected' })).status).toBe(404);
    const [row] = await q('select status from applications where id = $1', [id]);
    expect(row.status).toBe('applied');
  });

  it('rejects invalid transitions and the withdrawn status', async () => {
    const drive = await newDrive();
    const s = await verifiedStudent();
    const { id } = (await apply(s, drive)).body.data;
    expect((await api().patch(`/api/applications/${id}/status`).set(bearer(staffA)).send({ status: 'withdrawn' })).status).toBe(400);
    await api().patch(`/api/applications/${id}/status`).set(bearer(staffA)).send({ status: 'rejected' });
    const bad = await api().patch(`/api/applications/${id}/status`).set(bearer(staffA)).send({ status: 'selected' });
    expect(bad.status).toBe(409);
  });

  it('scopes application lists and student records by college; admin sees all', async () => {
    const drive = await newDrive();
    const s = await verifiedStudent();
    await apply(s, drive);
    const mine = await api().get('/api/applications').query({ driveId: drive }).set(bearer(staffA));
    expect(mine.body.data.items).toHaveLength(1);
    const theirs = await api().get('/api/applications').query({ driveId: drive }).set(bearer(staffB));
    expect(theirs.body.data.items).toHaveLength(0);
    expect((await api().get(`/api/students/${s.id}`).set(bearer(staffB))).status).toBe(404);
    expect((await api().get(`/api/students/${s.id}`).set(bearer(staffA))).status).toBe(200);
    expect((await api().get(`/api/students/${s.id}`).set(bearer(admin))).status).toBe(200);
    const all = await api().get('/api/students').set(bearer(staffB));
    expect(all.body.data.items.every((x) => x.collegeId === B)).toBe(true);
  });
});

describe('exception requests (Section 7)', () => {
  it('end to end: request -> approve (audited) -> apply via exception, original result preserved', async () => {
    const drive = await newDrive({ eligibility: { minCgpa: 7 } });
    const s = await verifiedStudent({ cgpa: 6.5 });

    // a request alone never makes the student eligible
    const reason = 'I have strong project work and a 6.5 CGPA after a medical break in semester 3.';
    const req = await api().post('/api/exceptions').set(bearer(s)).send({ driveId: drive, reason });
    expect(req.status).toBe(201);
    expect(req.body.data.status).toBe('pending');
    expect(req.body.data.eligibilitySnapshot.status).toBe('ineligible');
    const blocked = await apply(s, drive);
    expect(blocked.status).toBe(403);
    expect(blocked.body.error.code).toBe('not_eligible');

    // staff were notified; other college staff cannot decide
    expect(await q("select 1 from notifications where user_id = $1 and type = 'exception_request'", [staffA.id])).not.toHaveLength(0);
    const foreign = await api().post(`/api/exceptions/${req.body.data.id}/decision`).set(bearer(staffB)).send({ decision: 'approved' });
    expect(foreign.status).toBe(404);
    expect((await api().post(`/api/exceptions/${req.body.data.id}/decision`).set(bearer(s)).send({ decision: 'approved' })).status).toBe(403);

    // approve
    const dec = await api().post(`/api/exceptions/${req.body.data.id}/decision`).set(bearer(staffA)).send({ decision: 'approved', note: 'Approved on merit' });
    expect(dec.status).toBe(200);
    expect(dec.body.data).toMatchObject({ status: 'approved', decidedBy: staffA.id, decisionNote: 'Approved on merit' });
    const audit = await q("select * from audit_logs where action = 'exception.approved' and target_id = $1", [req.body.data.id]);
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({ actor_id: staffA.id, old_value: { status: 'pending' } });
    expect(audit[0].new_value).toMatchObject({ status: 'approved', studentId: s.id, driveId: drive });

    // cannot decide twice
    const twice = await api().post(`/api/exceptions/${req.body.data.id}/decision`).set(bearer(staffA)).send({ decision: 'rejected', note: 'no' });
    expect(twice.status).toBe(409);

    // apply via exception
    const applied = await apply(s, drive);
    expect(applied.status).toBe(201);
    expect(applied.body.data.viaException).toBe(true);
    const [app] = await q('select * from applications where id = $1', [applied.body.data.id]);
    expect(app.via_exception).toBe(true);
    expect(app.exception_request_id).toBe(req.body.data.id);
    expect(app.eligibility_snapshot.status).toBe('ineligible'); // original eligibility NOT overwritten
    expect(app.eligibility_snapshot.viaException).toBe(true);
    const hist = await q('select note from application_status_history where application_id = $1', [app.id]);
    expect(hist[0].note).toMatch(/approved exception/i);
    const [ex] = await q('select status from exception_requests where id = $1', [req.body.data.id]);
    expect(ex.status).toBe('approved');
  });

  it('allows only one active request per student per drive (API + DB constraint)', async () => {
    const drive = await newDrive();
    const s = await verifiedStudent({ cgpa: 6 });
    const reason = 'Please consider my application, I have relevant experience.';
    expect((await api().post('/api/exceptions').set(bearer(s)).send({ driveId: drive, reason })).status).toBe(201);
    const dup = await api().post('/api/exceptions').set(bearer(s)).send({ driveId: drive, reason });
    expect(dup.status).toBe(409);
    expect(dup.body.error.code).toBe('exception_already_active');
    await expect(
      t.db.query(
        `insert into exception_requests (student_id, drive_id, college_id, reason, eligibility_snapshot) values ($1,$2,$3,'a long enough reason','{}')`,
        [s.id, drive, A],
      ),
    ).rejects.toThrow(/exception_active_uq|duplicate key/);
  });

  it('validates the reason, and only ineligible students may request', async () => {
    const drive = await newDrive();
    const poor = await verifiedStudent({ cgpa: 6 });
    expect((await api().post('/api/exceptions').set(bearer(poor)).send({ driveId: drive, reason: 'short' })).status).toBe(400);
    expect((await api().post('/api/exceptions').set(bearer(poor)).send({ driveId: drive, reason: 'x'.repeat(1001) })).status).toBe(400);

    const eligible = await verifiedStudent({ cgpa: 9 });
    const res = await api().post('/api/exceptions').set(bearer(eligible)).send({ driveId: drive, reason: 'I would like an exception please.' });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('already_eligible');

    const incomplete = await verifiedStudent({ cgpa: null });
    const inc = await api().post('/api/exceptions').set(bearer(incomplete)).send({ driveId: drive, reason: 'I would like an exception please.' });
    expect(inc.status).toBe(422);
  });

  it('a rejection requires a note, blocks applying, and allows a fresh request afterwards', async () => {
    const drive = await newDrive();
    const s = await verifiedStudent({ cgpa: 6 });
    const reason = 'I would like to be considered for this drive.';
    const req = await api().post('/api/exceptions').set(bearer(s)).send({ driveId: drive, reason });
    const noNote = await api().post(`/api/exceptions/${req.body.data.id}/decision`).set(bearer(staffA)).send({ decision: 'rejected' });
    expect(noNote.status).toBe(400);
    const rej = await api().post(`/api/exceptions/${req.body.data.id}/decision`).set(bearer(staffA)).send({ decision: 'rejected', note: 'Does not meet minimum bar' });
    expect(rej.status).toBe(200);
    expect((await apply(s, drive)).status).toBe(403);
    const again = await api().post('/api/exceptions').set(bearer(s)).send({ driveId: drive, reason: 'Re-submitting with more context on my projects.' });
    expect(again.status).toBe(201);
  });

  it('an approved exception does not bypass the deadline; extending it (audited) does', async () => {
    const drive = await newDrive();
    const s = await verifiedStudent({ cgpa: 6 });
    const req = await api().post('/api/exceptions').set(bearer(s)).send({ driveId: drive, reason: 'Please consider my application.' });
    await api().post(`/api/exceptions/${req.body.data.id}/decision`).set(bearer(staffA)).send({ decision: 'approved' });

    await t.db.query("update drives set deadline = now() - interval '2 hours' where id = $1", [drive]);
    const late = await apply(s, drive);
    expect(late.status).toBe(409);
    expect(late.body.error.code).toBe('deadline_passed');

    const future = new Date(Date.now() + 5 * 86_400_000).toISOString();
    expect((await api().post(`/api/drives/${drive}/extend-deadline`).set(bearer(staffB)).send({ deadline: future, reason: 'extension' })).status).toBe(404);
    expect((await api().post(`/api/drives/${drive}/extend-deadline`).set(bearer(s)).send({ deadline: future, reason: 'extension' })).status).toBe(403);
    const ext = await api().post(`/api/drives/${drive}/extend-deadline`).set(bearer(staffA)).send({ deadline: future, reason: 'Company asked for more time' });
    expect(ext.status).toBe(200);
    const audit = await q("select * from audit_logs where action = 'drive.deadline_extended' and target_id = $1", [drive]);
    expect(audit).toHaveLength(1);
    expect(audit[0].new_value.reason).toBe('Company asked for more time');

    expect((await apply(s, drive)).status).toBe(201);
  });

  it('lets a student withdraw a pending request only', async () => {
    const drive = await newDrive();
    const s = await verifiedStudent({ cgpa: 6 });
    const req = await api().post('/api/exceptions').set(bearer(s)).send({ driveId: drive, reason: 'Please consider my application.' });
    const w = await api().post(`/api/exceptions/${req.body.data.id}/withdraw`).set(bearer(s));
    expect(w.body.data.status).toBe('withdrawn');
    const again = await api().post(`/api/exceptions/${req.body.data.id}/withdraw`).set(bearer(s));
    expect(again.status).toBe(409);
  });
});

describe('verification (Section 4)', () => {
  it('needs_changes requires a comment; both outcomes are audited and notified; scoped by college', async () => {
    const s = await t.seed.user({ role: 'student', collegeId: A });
    const none = await api().patch(`/api/students/${s.id}/verification`).set(bearer(staffA)).send({ status: 'needs_changes' });
    expect(none.status).toBe(400);
    const foreign = await api().patch(`/api/students/${s.id}/verification`).set(bearer(staffB)).send({ status: 'verified' });
    expect(foreign.status).toBe(404);
    const nc = await api().patch(`/api/students/${s.id}/verification`).set(bearer(staffA)).send({ status: 'needs_changes', comment: 'Add your CGPA proof' });
    expect(nc.status).toBe(200);
    const ok = await api().patch(`/api/students/${s.id}/verification`).set(bearer(staffA)).send({ status: 'verified' });
    expect(ok.status).toBe(200);
    const audits = await q("select action from audit_logs where target_id = $1 and action like 'profile.%' order by id", [s.id]);
    expect(audits.map((a) => a.action)).toEqual(['profile.needs_changes', 'profile.verified']);
    expect(await q("select 1 from notifications where user_id = $1 and type = 'verification'", [s.id])).toHaveLength(2);
  });

  it('resets verification when a verified student edits academic data', async () => {
    const s = await verifiedStudent({ cgpa: 7.5 });
    const res = await api().put('/api/students/me').set(bearer(s)).send({ cgpa: 9.9 });
    expect(res.status).toBe(200);
    expect(res.body.data.verificationReset).toBe(true);
    expect(res.body.data.verification.status).toBe('unverified');
    // non-academic edits keep verification
    const s2 = await verifiedStudent();
    const ok = await api().put('/api/students/me').set(bearer(s2)).send({ careerInterests: ['web'] });
    expect(ok.body.data.verification.status).toBe('verified');
  });
});

describe('interviews and notifications (Section 8)', () => {
  it('schedules only for shortlisted candidates, updates status, notifies the student', async () => {
    const drive = await newDrive();
    const s = await verifiedStudent();
    const { id } = (await apply(s, drive)).body.data;
    const body = { applicationId: id, roundName: 'Technical round 1', scheduledAt: new Date(Date.now() + 86_400_000).toISOString(), mode: 'online', venueOrLink: 'https://meet.example.com/x' };

    const early = await api().post('/api/interviews').set(bearer(staffA)).send(body);
    expect(early.status).toBe(409);
    await api().patch(`/api/applications/${id}/status`).set(bearer(staffA)).send({ status: 'shortlisted' });
    expect((await api().post('/api/interviews').set(bearer(staffB)).send(body)).status).toBe(404);
    const ok = await api().post('/api/interviews').set(bearer(staffA)).send(body);
    expect(ok.status).toBe(201);

    const [app] = await q('select status from applications where id = $1', [id]);
    expect(app.status).toBe('interview_scheduled');
    const mine = await api().get('/api/interviews/mine').set(bearer(s));
    expect(mine.body.data).toHaveLength(1);
    expect(mine.body.data[0].roundName).toBe('Technical round 1');
    const notes = await api().get('/api/notifications').set(bearer(s));
    expect(notes.body.data.items.some((n) => n.type === 'interview_scheduled')).toBe(true);
    expect(notes.body.data.unreadCount).toBeGreaterThan(0);

    const first = notes.body.data.items[0];
    await api().post(`/api/notifications/${first.id}/read`).set(bearer(s));
    const all = await api().post('/api/notifications/read-all').set(bearer(s));
    expect(all.status).toBe(200);
    expect((await api().get('/api/notifications/unread-count').set(bearer(s))).body.data.unreadCount).toBe(0);
  });

  it('a student cannot read another student\'s notifications or application', async () => {
    const drive = await newDrive();
    const s1 = await verifiedStudent();
    const s2 = await verifiedStudent();
    const { id } = (await apply(s1, drive)).body.data;
    expect((await api().get(`/api/applications/${id}`).set(bearer(s2))).status).toBe(404);
    const n = await api().get('/api/notifications').set(bearer(s2));
    expect(n.body.data.items.every((x) => x.userId === s2.id)).toBe(true);
  });
});

describe('drives and eligibility reporting', () => {
  it('staff create drives with skills + eligibility; opening notifies students who are not ruled out', async () => {
    const eligible = await verifiedStudent({ cgpa: 8 });
    const ruledOut = await verifiedStudent({ cgpa: 5 });
    const res = await api().post('/api/drives').set(bearer(staffA)).send({
      companyId: companyA, title: 'Backend Engineer', deadline: new Date(Date.now() + 7 * 86_400_000).toISOString(), status: 'open',
      skills: [{ skill: 'Node.js', importance: 'mandatory' }, { skill: 'Docker', importance: 'preferred' }],
      eligibility: { minCgpa: 7, maxBacklogs: 0, allowedDepartments: ['CSE'], allowedYears: [2026] },
    });
    expect(res.status).toBe(201);
    expect(res.body.data.skills).toHaveLength(2);
    expect(res.body.data.eligibility).toMatchObject({ minCgpa: 7, maxBacklogs: 0 });
    const got = (u) => q("select 1 from notifications where user_id = $1 and type = 'new_drive'", [u.id]);
    expect(await got(eligible)).toHaveLength(1);
    expect(await got(ruledOut)).toHaveLength(0);
  });

  it('staff cannot create a drive for another college\'s company', async () => {
    const res = await api().post('/api/drives').set(bearer(staffB)).send({
      companyId: companyA, title: 'X', deadline: new Date(Date.now() + 86_400_000).toISOString(),
    });
    expect(res.status).toBe(404);
  });

  it('students see eligibility + application state in the drive list', async () => {
    const drive = await newDrive({ title: 'Listed Drive' });
    const s = await verifiedStudent({ cgpa: 8 });
    await apply(s, drive);
    const list = await api().get('/api/drives').set(bearer(s));
    const item = list.body.data.items.find((d) => d.id === drive);
    expect(item.eligibilityResult.status).toBe('eligible');
    expect(item.application.status).toBe('applied');
    const detail = await api().get(`/api/drives/${drive}`).set(bearer(s));
    expect(detail.body.data.eligibilityResult.criteria.length).toBeGreaterThan(0);
    expect(detail.body.data.canApply).toBe(false); // already applied
  });

  it('produces a deterministic eligibility report for staff', async () => {
    const drive = await newDrive({ eligibility: { minCgpa: 7.5 } });
    await verifiedStudent({ cgpa: 9 });
    await verifiedStudent({ cgpa: 6 });
    const res = await api().get(`/api/drives/${drive}/eligibility-report`).set(bearer(staffA));
    expect(res.status).toBe(200);
    expect(res.body.data.summary.eligible).toBeGreaterThan(0);
    expect(res.body.data.summary.ineligible).toBeGreaterThan(0);
    expect(res.body.data.failedBy.cgpa).toBeGreaterThan(0);
    expect((await api().get(`/api/drives/${drive}/eligibility-report`).set(bearer(staffB))).status).toBe(404);
  });

  it('exports a CSV hiring report with formula-injection protection', async () => {
    const drive = await newDrive();
    const s = await t.seed.user({ role: 'student', collegeId: A, verified: true, fullName: '=HYPERLINK("http://evil")' });
    await apply(s, drive);
    const res = await api().get(`/api/drives/${drive}/report.csv`).set(bearer(staffA));
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/text\/csv/);
    expect(res.text).toContain("'=HYPERLINK");
    expect(res.text.split('\r\n')[0]).toContain('Name,Email');
  });

  it('provides real-data analytics scoped to the college', async () => {
    const res = await api().get('/api/analytics/overview').set(bearer(staffA));
    expect(res.status).toBe(200);
    expect(res.body.data.students.total).toBeGreaterThan(0);
    expect(res.body.data.applications.total).toBeGreaterThan(0);
    // college B has no students/applications from this suite
    const b = await api().get('/api/analytics/overview').set(bearer(staffB));
    expect(b.body.data.applications.total).toBe(0);
  });
});
