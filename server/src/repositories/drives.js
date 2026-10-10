import { db } from '../context.js';
import { camelRow, camelRows } from '../utils/helpers.js';

export const companies = {
  async insert(c, ex = db()) {
    const { rows } = await ex.query(
      `insert into companies (college_id, name, website, industry, contact_person, contact_email, contact_phone, notes, status, created_by)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) returning *`,
      [c.collegeId, c.name, c.website ?? null, c.industry ?? null, c.contactPerson ?? null, c.contactEmail ?? null,
        c.contactPhone ?? null, c.notes ?? null, c.status ?? 'active', c.createdBy],
    );
    return camelRow(rows[0]);
  },
  async update(id, c, ex = db()) {
    const { rows } = await ex.query(
      `update companies set
          name = coalesce($2, name), website = coalesce($3, website), industry = coalesce($4, industry),
          contact_person = coalesce($5, contact_person), contact_email = coalesce($6, contact_email),
          contact_phone = coalesce($7, contact_phone), notes = coalesce($8, notes), status = coalesce($9, status)
        where id = $1 returning *`,
      [id, c.name ?? null, c.website ?? null, c.industry ?? null, c.contactPerson ?? null, c.contactEmail ?? null,
        c.contactPhone ?? null, c.notes ?? null, c.status ?? null],
    );
    return camelRow(rows[0]);
  },
  async findById(id, ex = db()) {
    const { rows } = await ex.query('select * from companies where id = $1', [id]);
    return camelRow(rows[0]);
  },
  async list({ collegeId, status, q, limit, offset }, ex = db()) {
    const { rows } = await ex.query(
      `select c.*, col.name as college_name,
              (select count(*)::int from drives d where d.company_id = c.id) as drive_count,
              count(*) over() as total
         from companies c join colleges col on col.id = c.college_id
        where ($1::uuid is null or c.college_id = $1)
          and ($2::text is null or c.status = $2)
          and ($3::text is null or c.name ilike $3 or c.industry ilike $3)
        order by c.name limit $4 offset $5`,
      [collegeId ?? null, status ?? null, q ?? null, limit, offset],
    );
    return { items: camelRows(rows).map(({ total, ...r }) => r), total: rows[0]?.total ?? 0 };
  },
};

const DRIVE_SELECT = `
  select d.*, c.name as company_name, c.industry as company_industry, col.name as college_name,
         (select count(*)::int from applications a where a.drive_id = d.id) as application_count`;

export const drives = {
  async insert(d, ex = db()) {
    const { rows } = await ex.query(
      `insert into drives (college_id, company_id, title, description, job_type, location, package_lpa,
                           stipend_per_month, openings, deadline, original_deadline, drive_date, status, created_by)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$10,$11,$12,$13) returning *`,
      [d.collegeId, d.companyId, d.title, d.description ?? null, d.jobType ?? 'full_time', d.location ?? null,
        d.packageLpa ?? null, d.stipendPerMonth ?? null, d.openings ?? null, d.deadline, d.driveDate ?? null,
        d.status ?? 'draft', d.createdBy],
    );
    return camelRow(rows[0]);
  },

  async update(id, d, ex = db()) {
    const { rows } = await ex.query(
      `update drives set
          title = coalesce($2, title), description = coalesce($3, description), job_type = coalesce($4, job_type),
          location = coalesce($5, location), package_lpa = coalesce($6, package_lpa),
          stipend_per_month = coalesce($7, stipend_per_month), openings = coalesce($8, openings),
          drive_date = coalesce($9, drive_date)
        where id = $1 returning *`,
      [id, d.title ?? null, d.description ?? null, d.jobType ?? null, d.location ?? null, d.packageLpa ?? null,
        d.stipendPerMonth ?? null, d.openings ?? null, d.driveDate ?? null],
    );
    return camelRow(rows[0]);
  },

  async setDeadline(id, deadline, by, ex = db()) {
    const { rows } = await ex.query(
      `update drives set deadline = $2, deadline_extended_by = $3,
              status = case when status = 'closed' and $2 > now() then 'open' else status end
        where id = $1 returning *`,
      [id, deadline, by],
    );
    return camelRow(rows[0]);
  },

  async setStatus(id, status, ex = db()) {
    const { rows } = await ex.query('update drives set status = $2 where id = $1 returning *', [id, status]);
    return camelRow(rows[0]);
  },

  async findById(id, ex = db()) {
    const { rows } = await ex.query(
      `${DRIVE_SELECT} from drives d join companies c on c.id = d.company_id
         join colleges col on col.id = d.college_id where d.id = $1`,
      [id],
    );
    return camelRow(rows[0]);
  },

  async lock(id, ex) {
    const { rows } = await ex.query('select * from drives where id = $1 for update', [id]);
    return camelRow(rows[0]);
  },

  async list({ collegeId, status, statuses, companyId, q, limit, offset }, ex = db()) {
    const { rows } = await ex.query(
      `${DRIVE_SELECT}, count(*) over() as total
         from drives d join companies c on c.id = d.company_id join colleges col on col.id = d.college_id
        where ($1::uuid is null or d.college_id = $1)
          and ($2::text is null or d.status = $2)
          and ($3::text[] is null or d.status = any($3))
          and ($4::uuid is null or d.company_id = $4)
          and ($5::text is null or d.title ilike $5 or c.name ilike $5)
        order by d.deadline desc limit $6 offset $7`,
      [collegeId ?? null, status ?? null, statuses ?? null, companyId ?? null, q ?? null, limit, offset],
    );
    return { items: camelRows(rows).map(({ total, ...r }) => r), total: rows[0]?.total ?? 0 };
  },

  async skills(driveId, ex = db()) {
    const { rows } = await ex.query('select skill, importance from drive_skills where drive_id = $1 order by importance, skill', [driveId]);
    return rows;
  },
  async skillsForDrives(ids, ex = db()) {
    if (!ids.length) return new Map();
    const { rows } = await ex.query('select drive_id, skill, importance from drive_skills where drive_id = any($1::uuid[]) order by importance, skill', [ids]);
    const map = new Map();
    for (const r of rows) {
      if (!map.has(r.drive_id)) map.set(r.drive_id, []);
      map.get(r.drive_id).push({ skill: r.skill, importance: r.importance });
    }
    return map;
  },
  async replaceSkills(driveId, skills, ex) {
    await ex.query('delete from drive_skills where drive_id = $1', [driveId]);
    for (const s of skills) {
      await ex.query(
        `insert into drive_skills (drive_id, skill, importance) values ($1,$2,$3)
         on conflict (drive_id, lower(skill)) do update set importance = excluded.importance`,
        [driveId, s.skill, s.importance ?? 'mandatory'],
      );
    }
  },

  async eligibility(driveId, ex = db()) {
    const { rows } = await ex.query('select * from drive_eligibility where drive_id = $1', [driveId]);
    return camelRow(rows[0]) ?? null;
  },
  async eligibilityForDrives(ids, ex = db()) {
    if (!ids.length) return new Map();
    const { rows } = await ex.query('select * from drive_eligibility where drive_id = any($1::uuid[])', [ids]);
    return new Map(rows.map((r) => [r.drive_id, camelRow(r)]));
  },
  async upsertEligibility(driveId, e, ex) {
    await ex.query(
      `insert into drive_eligibility (drive_id, min_cgpa, max_backlogs, allowed_departments, allowed_years,
                                      min_tenth_percent, min_twelfth_percent)
       values ($1,$2,$3,$4,$5,$6,$7)
       on conflict (drive_id) do update set min_cgpa = excluded.min_cgpa, max_backlogs = excluded.max_backlogs,
         allowed_departments = excluded.allowed_departments, allowed_years = excluded.allowed_years,
         min_tenth_percent = excluded.min_tenth_percent, min_twelfth_percent = excluded.min_twelfth_percent`,
      [driveId, e.minCgpa ?? null, e.maxBacklogs ?? null, e.allowedDepartments ?? [], e.allowedYears ?? [],
        e.minTenthPercent ?? null, e.minTwelfthPercent ?? null],
    );
  },

  /** Auto-close drives whose deadline has passed (called opportunistically on reads). */
  async closeExpired(collegeId, ex = db()) {
    await ex.query(
      `update drives set status = 'closed'
        where status = 'open' and deadline < now() and ($1::uuid is null or college_id = $1)`,
      [collegeId ?? null],
    );
  },
};
