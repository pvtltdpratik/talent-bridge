import { db } from '../context.js';
import { camelRow, camelRows } from '../utils/helpers.js';

const PROFILE_FIELDS = {
  department: 'department',
  rollNumber: 'roll_number',
  passingYear: 'passing_year',
  cgpa: 'cgpa',
  tenthPercent: 'tenth_percent',
  twelfthPercent: 'twelfth_percent',
  activeBacklogs: 'active_backlogs',
  skills: 'skills',
  certifications: 'certifications',
  links: 'links',
  careerInterests: 'career_interests',
};

export const students = {
  async ensure(userId, collegeId, ex = db()) {
    await ex.query(
      'insert into student_profiles (user_id, college_id) values ($1,$2) on conflict (user_id) do nothing',
      [userId, collegeId],
    );
  },

  async findByUserId(userId, ex = db()) {
    const { rows } = await ex.query(
      `select sp.*, p.full_name, p.email, p.phone, p.status as account_status, c.name as college_name
         from student_profiles sp
         join profiles p on p.id = sp.user_id
         join colleges c on c.id = sp.college_id
        where sp.user_id = $1`,
      [userId],
    );
    return camelRow(rows[0]);
  },

  async lock(userId, ex) {
    const { rows } = await ex.query('select * from student_profiles where user_id = $1 for update', [userId]);
    return camelRow(rows[0]);
  },

  /** Partial update: only keys present in `fields` are touched. */
  async update(userId, fields, ex = db()) {
    const sets = [];
    const params = [userId];
    for (const [k, col] of Object.entries(PROFILE_FIELDS)) {
      if (fields[k] === undefined) continue;
      params.push(['certifications', 'links'].includes(k) ? JSON.stringify(fields[k]) : fields[k]);
      sets.push(`${col} = $${params.length}${['certifications', 'links'].includes(k) ? '::jsonb' : ''}`);
    }
    if (!sets.length) return this.findByUserId(userId, ex);
    await ex.query(`update student_profiles set ${sets.join(', ')} where user_id = $1`, params);
    return this.findByUserId(userId, ex);
  },

  async setVerification(userId, { status, comment, by }, ex = db()) {
    const { rows } = await ex.query(
      `update student_profiles
          set verification_status = $2, verification_comment = $3,
              verified_by = $4, verified_at = case when $2 = 'verified' then now() else null end
        where user_id = $1 returning *`,
      [userId, status, comment ?? null, by],
    );
    return camelRow(rows[0]);
  },

  /** Any profile edit by the student that changes verified data resets verification. */
  async resetVerification(userId, ex = db()) {
    await ex.query(
      `update student_profiles set verification_status = 'unverified', verified_at = null, verified_by = null
        where user_id = $1 and verification_status = 'verified'`,
      [userId],
    );
  },

  async list({ collegeId, department, passingYear, verification, q, limit, offset }, ex = db()) {
    const { rows } = await ex.query(
      `select sp.user_id, sp.college_id, sp.department, sp.roll_number, sp.passing_year, sp.cgpa,
              sp.active_backlogs, sp.verification_status, sp.verification_comment,
              coalesce(array_length(sp.skills, 1), 0) as skill_count,
              p.full_name, p.email, p.status as account_status,
              exists (select 1 from resumes r where r.student_id = sp.user_id and r.is_active) as has_resume,
              count(*) over() as total
         from student_profiles sp join profiles p on p.id = sp.user_id
        where ($1::uuid is null or sp.college_id = $1)
          and ($2::text is null or lower(sp.department) = lower($2))
          and ($3::int is null or sp.passing_year = $3)
          and ($4::text is null or sp.verification_status = $4)
          and ($5::text is null or p.full_name ilike $5 or p.email ilike $5 or sp.roll_number ilike $5)
          and p.status = 'active'
        order by p.full_name
        limit $6 offset $7`,
      [collegeId ?? null, department ?? null, passingYear ?? null, verification ?? null, q ?? null, limit, offset],
    );
    return { items: camelRows(rows).map(({ total, ...r }) => r), total: rows[0]?.total ?? 0 };
  },

  /** Everyone in a college (bounded) for eligibility / reporting. */
  async listAllForCollege(collegeId, { verifiedOnly = false } = {}, ex = db()) {
    const { rows } = await ex.query(
      `select sp.*, p.full_name, p.email
         from student_profiles sp join profiles p on p.id = sp.user_id
        where ($1::uuid is null or sp.college_id = $1) and p.status = 'active'
          and ($2::boolean = false or sp.verification_status = 'verified')
        order by p.full_name limit 5000`,
      [collegeId ?? null, verifiedOnly],
    );
    return camelRows(rows);
  },

  // ---- projects --------------------------------------------------------
  async projects(studentId, ex = db()) {
    const { rows } = await ex.query('select * from student_projects where student_id = $1 order by created_at', [studentId]);
    return camelRows(rows);
  },
  async addProject(studentId, p, ex = db()) {
    const { rows } = await ex.query(
      `insert into student_projects (student_id, title, description, tech, url) values ($1,$2,$3,$4,$5) returning *`,
      [studentId, p.title, p.description ?? null, p.tech ?? [], p.url ?? null],
    );
    return camelRow(rows[0]);
  },
  async updateProject(studentId, id, p, ex = db()) {
    const { rows } = await ex.query(
      `update student_projects set title = $3, description = $4, tech = $5, url = $6
        where id = $2 and student_id = $1 returning *`,
      [studentId, id, p.title, p.description ?? null, p.tech ?? [], p.url ?? null],
    );
    return camelRow(rows[0]);
  },
  async deleteProject(studentId, id, ex = db()) {
    const { rowCount } = await ex.query('delete from student_projects where id = $2 and student_id = $1', [studentId, id]);
    return rowCount > 0;
  },

  // ---- experience ------------------------------------------------------
  async experience(studentId, ex = db()) {
    const { rows } = await ex.query(
      'select * from student_experience where student_id = $1 order by start_date desc nulls last, created_at',
      [studentId],
    );
    return camelRows(rows);
  },
  async addExperience(studentId, e, ex = db()) {
    const { rows } = await ex.query(
      `insert into student_experience (student_id, kind, organization, role, start_date, end_date, description)
       values ($1,$2,$3,$4,$5,$6,$7) returning *`,
      [studentId, e.kind ?? 'internship', e.organization, e.role ?? null, e.startDate ?? null, e.endDate ?? null, e.description ?? null],
    );
    return camelRow(rows[0]);
  },
  async updateExperience(studentId, id, e, ex = db()) {
    const { rows } = await ex.query(
      `update student_experience set kind = $3, organization = $4, role = $5, start_date = $6, end_date = $7, description = $8
        where id = $2 and student_id = $1 returning *`,
      [studentId, id, e.kind ?? 'internship', e.organization, e.role ?? null, e.startDate ?? null, e.endDate ?? null, e.description ?? null],
    );
    return camelRow(rows[0]);
  },
  async deleteExperience(studentId, id, ex = db()) {
    const { rowCount } = await ex.query('delete from student_experience where id = $2 and student_id = $1', [studentId, id]);
    return rowCount > 0;
  },
};

export const resumes = {
  async listByStudent(studentId, ex = db()) {
    const { rows } = await ex.query(
      `select id, student_id, version, file_name, mime_type, size_bytes, extraction_status,
              extraction_error, is_active, created_at, length(extracted_text) as text_length
         from resumes where student_id = $1 order by version desc`,
      [studentId],
    );
    return camelRows(rows);
  },
  async findActive(studentId, ex = db()) {
    const { rows } = await ex.query('select * from resumes where student_id = $1 and is_active', [studentId]);
    return camelRow(rows[0]);
  },
  async findById(id, ex = db()) {
    const { rows } = await ex.query('select * from resumes where id = $1', [id]);
    return camelRow(rows[0]);
  },
  async nextVersion(studentId, ex) {
    const { rows } = await ex.query('select coalesce(max(version), 0) + 1 as v from resumes where student_id = $1', [studentId]);
    return rows[0].v;
  },
  async deactivateAll(studentId, ex) {
    await ex.query('update resumes set is_active = false where student_id = $1 and is_active', [studentId]);
  },
  async insert(r, ex) {
    const { rows } = await ex.query(
      `insert into resumes (student_id, version, file_path, file_name, mime_type, size_bytes,
                            extraction_status, extraction_error, extracted_text, text_hash, is_active)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,true) returning *`,
      [r.studentId, r.version, r.filePath, r.fileName, r.mimeType, r.sizeBytes, r.extractionStatus,
        r.extractionError ?? null, r.extractedText ?? null, r.textHash ?? null],
    );
    return camelRow(rows[0]);
  },
  async remove(id, ex = db()) {
    await ex.query('delete from resumes where id = $1', [id]);
  },
  async filePathsForStudent(studentId, ex = db()) {
    const { rows } = await ex.query('select file_path from resumes where student_id = $1', [studentId]);
    return rows.map((r) => r.file_path);
  },
  /** After deleting the active one, promote the most recent remaining version. */
  async promoteLatest(studentId, ex) {
    await ex.query(
      `update resumes set is_active = true
        where id = (select id from resumes where student_id = $1 order by version desc limit 1)
          and not exists (select 1 from resumes where student_id = $1 and is_active)`,
      [studentId],
    );
  },
};
