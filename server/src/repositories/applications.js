import { db } from '../context.js';
import { camelRow, camelRows } from '../utils/helpers.js';

export const applications = {
  async insert(a, ex) {
    const { rows } = await ex.query(
      `insert into applications (student_id, drive_id, college_id, status, via_exception, exception_request_id, eligibility_snapshot)
       values ($1,$2,$3,'applied',$4,$5,$6::jsonb) returning *`,
      [a.studentId, a.driveId, a.collegeId, a.viaException ?? false, a.exceptionRequestId ?? null, JSON.stringify(a.snapshot)],
    );
    return camelRow(rows[0]);
  },

  async findById(id, ex = db()) {
    const { rows } = await ex.query(
      `select a.*, d.title as drive_title, d.deadline, c.name as company_name, p.full_name as student_name
         from applications a join drives d on d.id = a.drive_id join companies c on c.id = d.company_id
         join profiles p on p.id = a.student_id where a.id = $1`,
      [id],
    );
    return camelRow(rows[0]);
  },

  async lock(id, ex) {
    const { rows } = await ex.query('select * from applications where id = $1 for update', [id]);
    return camelRow(rows[0]);
  },

  async findByStudentDrive(studentId, driveId, ex = db()) {
    const { rows } = await ex.query('select * from applications where student_id = $1 and drive_id = $2', [studentId, driveId]);
    return camelRow(rows[0]);
  },

  async listByStudent(studentId, ex = db()) {
    const { rows } = await ex.query(
      `select a.id, a.drive_id, a.status, a.via_exception, a.applied_at, a.updated_at,
              d.title as drive_title, d.deadline, d.drive_date, d.job_type, c.name as company_name
         from applications a join drives d on d.id = a.drive_id join companies c on c.id = d.company_id
        where a.student_id = $1 order by a.applied_at desc`,
      [studentId],
    );
    return camelRows(rows);
  },

  async listForStaff({ collegeId, driveId, status, q, limit, offset }, ex = db()) {
    const { rows } = await ex.query(
      `select a.id, a.student_id, a.drive_id, a.college_id, a.status, a.via_exception, a.applied_at, a.manual_rank,
              a.eligibility_snapshot,
              d.title as drive_title, c.name as company_name,
              p.full_name as student_name, p.email as student_email,
              sp.department, sp.roll_number, sp.cgpa, sp.passing_year, sp.verification_status,
              count(*) over() as total
         from applications a
         join drives d on d.id = a.drive_id join companies c on c.id = d.company_id
         join profiles p on p.id = a.student_id join student_profiles sp on sp.user_id = a.student_id
        where ($1::uuid is null or a.college_id = $1)
          and ($2::uuid is null or a.drive_id = $2)
          and ($3::text is null or a.status = $3)
          and ($4::text is null or p.full_name ilike $4 or sp.roll_number ilike $4)
        order by a.manual_rank nulls last, a.applied_at
        limit $5 offset $6`,
      [collegeId ?? null, driveId ?? null, status ?? null, q ?? null, limit, offset],
    );
    return { items: camelRows(rows).map(({ total, ...r }) => r), total: rows[0]?.total ?? 0 };
  },

  /** All applicants of a drive with the fields needed for scoring (bounded). */
  async applicantsOfDrive(driveId, ex = db()) {
    const { rows } = await ex.query(
      `select a.id as application_id, a.status, a.via_exception, a.manual_rank, a.applied_at, a.eligibility_snapshot,
              sp.*, p.full_name, p.email
         from applications a join student_profiles sp on sp.user_id = a.student_id
         join profiles p on p.id = a.student_id
        where a.drive_id = $1 and a.status <> 'withdrawn' limit 2000`,
      [driveId],
    );
    return camelRows(rows);
  },

  async setStatus(id, status, ex) {
    const { rows } = await ex.query('update applications set status = $2 where id = $1 returning *', [id, status]);
    return camelRow(rows[0]);
  },

  async addHistory({ applicationId, fromStatus, toStatus, changedBy, note }, ex) {
    await ex.query(
      `insert into application_status_history (application_id, from_status, to_status, changed_by, note)
       values ($1,$2,$3,$4,$5)`,
      [applicationId, fromStatus ?? null, toStatus, changedBy ?? null, note ?? null],
    );
  },

  async history(applicationId, ex = db()) {
    const { rows } = await ex.query(
      `select h.*, p.full_name as changed_by_name, p.role as changed_by_role
         from application_status_history h left join profiles p on p.id = h.changed_by
        where h.application_id = $1 order by h.created_at, h.id`,
      [applicationId],
    );
    return camelRows(rows);
  },

  async setManualRanks(driveId, orderedIds, ex) {
    await ex.query('update applications set manual_rank = null where drive_id = $1', [driveId]);
    for (let i = 0; i < orderedIds.length; i += 1) {
      await ex.query('update applications set manual_rank = $3 where id = $1 and drive_id = $2', [orderedIds[i], driveId, i + 1]);
    }
  },

  async countsByStatus(driveId, ex = db()) {
    const { rows } = await ex.query('select status, count(*)::int as n from applications where drive_id = $1 group by status', [driveId]);
    return Object.fromEntries(rows.map((r) => [r.status, r.n]));
  },
};

export const exceptions = {
  async insert(e, ex) {
    const { rows } = await ex.query(
      `insert into exception_requests (student_id, drive_id, college_id, reason, eligibility_snapshot)
       values ($1,$2,$3,$4,$5::jsonb) returning *`,
      [e.studentId, e.driveId, e.collegeId, e.reason, JSON.stringify(e.snapshot)],
    );
    return camelRow(rows[0]);
  },

  async findById(id, ex = db()) {
    const { rows } = await ex.query(
      `select r.*, d.title as drive_title, c.name as company_name, p.full_name as student_name,
              sp.department, sp.roll_number, sp.cgpa, dp.full_name as decided_by_name
         from exception_requests r join drives d on d.id = r.drive_id join companies c on c.id = d.company_id
         join profiles p on p.id = r.student_id join student_profiles sp on sp.user_id = r.student_id
         left join profiles dp on dp.id = r.decided_by
        where r.id = $1`,
      [id],
    );
    return camelRow(rows[0]);
  },

  async lock(id, ex) {
    const { rows } = await ex.query('select * from exception_requests where id = $1 for update', [id]);
    return camelRow(rows[0]);
  },

  async findActive(studentId, driveId, ex = db()) {
    const { rows } = await ex.query(
      "select * from exception_requests where student_id = $1 and drive_id = $2 and status in ('pending','approved')",
      [studentId, driveId],
    );
    return camelRow(rows[0]);
  },

  async latestForStudentDrive(studentId, driveId, ex = db()) {
    const { rows } = await ex.query(
      'select * from exception_requests where student_id = $1 and drive_id = $2 order by created_at desc limit 1',
      [studentId, driveId],
    );
    return camelRow(rows[0]);
  },

  async listByStudent(studentId, ex = db()) {
    const { rows } = await ex.query(
      `select r.*, d.title as drive_title, c.name as company_name
         from exception_requests r join drives d on d.id = r.drive_id join companies c on c.id = d.company_id
        where r.student_id = $1 order by r.created_at desc`,
      [studentId],
    );
    return camelRows(rows);
  },

  async listForStaff({ collegeId, status, driveId, limit, offset }, ex = db()) {
    const { rows } = await ex.query(
      `select r.*, d.title as drive_title, c.name as company_name, p.full_name as student_name,
              sp.department, sp.roll_number, sp.cgpa, sp.active_backlogs, count(*) over() as total
         from exception_requests r join drives d on d.id = r.drive_id join companies c on c.id = d.company_id
         join profiles p on p.id = r.student_id join student_profiles sp on sp.user_id = r.student_id
        where ($1::uuid is null or r.college_id = $1) and ($2::text is null or r.status = $2)
          and ($3::uuid is null or r.drive_id = $3)
        order by (r.status = 'pending') desc, r.created_at desc limit $4 offset $5`,
      [collegeId ?? null, status ?? null, driveId ?? null, limit, offset],
    );
    return { items: camelRows(rows).map(({ total, ...r }) => r), total: rows[0]?.total ?? 0 };
  },

  async decide(id, { status, note, by }, ex) {
    const { rows } = await ex.query(
      `update exception_requests set status = $2, decision_note = $3, decided_by = $4, decided_at = now()
        where id = $1 returning *`,
      [id, status, note ?? null, by],
    );
    return camelRow(rows[0]);
  },

  async withdraw(id, ex) {
    const { rows } = await ex.query("update exception_requests set status = 'withdrawn' where id = $1 returning *", [id]);
    return camelRow(rows[0]);
  },
};

export const interviews = {
  async insert(i, ex) {
    const { rows } = await ex.query(
      `insert into interviews (application_id, drive_id, student_id, college_id, round_name, scheduled_at, mode, venue_or_link, notes, created_by)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) returning *`,
      [i.applicationId, i.driveId, i.studentId, i.collegeId, i.roundName, i.scheduledAt, i.mode, i.venueOrLink ?? null,
        i.notes ?? null, i.createdBy],
    );
    return camelRow(rows[0]);
  },
  async findById(id, ex = db()) {
    const { rows } = await ex.query('select * from interviews where id = $1', [id]);
    return camelRow(rows[0]);
  },
  async update(id, i, ex = db()) {
    const { rows } = await ex.query(
      `update interviews set round_name = coalesce($2, round_name), scheduled_at = coalesce($3, scheduled_at),
              mode = coalesce($4, mode), venue_or_link = coalesce($5, venue_or_link),
              notes = coalesce($6, notes), status = coalesce($7, status)
        where id = $1 returning *`,
      [id, i.roundName ?? null, i.scheduledAt ?? null, i.mode ?? null, i.venueOrLink ?? null, i.notes ?? null, i.status ?? null],
    );
    return camelRow(rows[0]);
  },
  async listByStudent(studentId, ex = db()) {
    const { rows } = await ex.query(
      `select i.*, d.title as drive_title, c.name as company_name
         from interviews i join drives d on d.id = i.drive_id join companies c on c.id = d.company_id
        where i.student_id = $1 order by i.scheduled_at`,
      [studentId],
    );
    return camelRows(rows);
  },
  async listForStaff({ collegeId, driveId, upcomingOnly, limit, offset }, ex = db()) {
    const { rows } = await ex.query(
      `select i.*, d.title as drive_title, c.name as company_name, p.full_name as student_name,
              count(*) over() as total
         from interviews i join drives d on d.id = i.drive_id join companies c on c.id = d.company_id
         join profiles p on p.id = i.student_id
        where ($1::uuid is null or i.college_id = $1) and ($2::uuid is null or i.drive_id = $2)
          and ($3::boolean = false or i.scheduled_at >= now())
        order by i.scheduled_at limit $4 offset $5`,
      [collegeId ?? null, driveId ?? null, upcomingOnly ?? false, limit, offset],
    );
    return { items: camelRows(rows).map(({ total, ...r }) => r), total: rows[0]?.total ?? 0 };
  },
};
