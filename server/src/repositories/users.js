// SQL for profiles, colleges and placement-cell invitations. Rows are returned camelCased.
import { db } from '../context.js';
import { camelRow, camelRows } from '../utils/helpers.js';

export const profiles = {
  async findById(id, ex = db()) {
    const { rows } = await ex.query(
      `select p.*, c.name as college_name from profiles p
         left join colleges c on c.id = p.college_id where p.id = $1`,
      [id],
    );
    return camelRow(rows[0]);
  },

  async findByEmail(email, ex = db()) {
    const { rows } = await ex.query('select * from profiles where lower(email) = lower($1)', [email]);
    return camelRow(rows[0]);
  },

  async lock(id, ex) {
    const { rows } = await ex.query('select * from profiles where id = $1 for update', [id]);
    return camelRow(rows[0]);
  },

  async insert(p, ex = db()) {
    const { rows } = await ex.query(
      `insert into profiles (id, email, full_name, phone, role, status, college_id, consent_at)
       values ($1,$2,$3,$4,$5,$6,$7,$8) returning *`,
      [p.id, p.email.toLowerCase(), p.fullName, p.phone ?? null, p.role, p.status, p.collegeId ?? null, p.consentAt ?? null],
    );
    return camelRow(rows[0]);
  },

  async list({ role, status, collegeId, q, limit, offset }, ex = db()) {
    const { rows } = await ex.query(
      `select p.*, c.name as college_name, count(*) over() as total
         from profiles p left join colleges c on c.id = p.college_id
        where ($1::text is null or p.role = $1)
          and ($2::text is null or p.status = $2)
          and ($3::uuid is null or p.college_id = $3)
          and ($4::text is null or p.full_name ilike $4 or p.email ilike $4)
        order by p.created_at desc
        limit $5 offset $6`,
      [role ?? null, status ?? null, collegeId ?? null, q ?? null, limit, offset],
    );
    return { items: camelRows(rows).map(({ total, ...r }) => r), total: rows[0]?.total ?? 0 };
  },

  async setStatus(id, { status, reason }, ex = db()) {
    const { rows } = await ex.query(
      'update profiles set status = $2, status_reason = $3 where id = $1 returning *',
      [id, status, reason ?? null],
    );
    return camelRow(rows[0]);
  },

  async setRole(id, role, ex = db()) {
    const { rows } = await ex.query('update profiles set role = $2 where id = $1 returning *', [id, role]);
    return camelRow(rows[0]);
  },

  async updateBasics(id, { fullName, phone }, ex = db()) {
    const { rows } = await ex.query(
      `update profiles set full_name = coalesce($2, full_name), phone = coalesce($3, phone)
        where id = $1 returning *`,
      [id, fullName ?? null, phone ?? null],
    );
    return camelRow(rows[0]);
  },

  async countActiveAdmins(ex = db()) {
    const { rows } = await ex.query("select count(*)::int as n from profiles where role = 'admin' and status = 'active'");
    return rows[0].n;
  },

  async listByCollegeAndRole(collegeId, role, ex = db()) {
    const { rows } = await ex.query(
      "select * from profiles where college_id = $1 and role = $2 and status = 'active'",
      [collegeId, role],
    );
    return camelRows(rows);
  },

  async listActiveAdmins(ex = db()) {
    const { rows } = await ex.query("select * from profiles where role = 'admin' and status = 'active'");
    return camelRows(rows);
  },

  async remove(id, ex = db()) {
    await ex.query('delete from profiles where id = $1', [id]);
  },
};

export const colleges = {
  async list(ex = db()) {
    const { rows } = await ex.query('select * from colleges order by name');
    return camelRows(rows);
  },
  async findById(id, ex = db()) {
    const { rows } = await ex.query('select * from colleges where id = $1', [id]);
    return camelRow(rows[0]);
  },
  async insert({ name, code, city }, ex = db()) {
    const { rows } = await ex.query(
      'insert into colleges (name, code, city) values ($1,$2,$3) returning *',
      [name, code ?? null, city ?? null],
    );
    return camelRow(rows[0]);
  },
  async update(id, { name, code, city }, ex = db()) {
    const { rows } = await ex.query(
      `update colleges set name = coalesce($2, name), code = coalesce($3, code), city = coalesce($4, city)
        where id = $1 returning *`,
      [id, name ?? null, code ?? null, city ?? null],
    );
    return camelRow(rows[0]);
  },
};

export const invitations = {
  async insert({ email, collegeId, tokenHash, invitedBy, expiresAt }, ex = db()) {
    const { rows } = await ex.query(
      `insert into placement_cell_invitations (email, college_id, token_hash, invited_by, expires_at)
       values ($1,$2,$3,$4,$5) returning *`,
      [email.toLowerCase(), collegeId, tokenHash, invitedBy, expiresAt],
    );
    return camelRow(rows[0]);
  },
  async findByHash(tokenHash, ex = db()) {
    const { rows } = await ex.query(
      `select i.*, c.name as college_name from placement_cell_invitations i
         join colleges c on c.id = i.college_id where i.token_hash = $1`,
      [tokenHash],
    );
    return camelRow(rows[0]);
  },
  async lockByHash(tokenHash, ex) {
    const { rows } = await ex.query(
      'select * from placement_cell_invitations where token_hash = $1 for update',
      [tokenHash],
    );
    return camelRow(rows[0]);
  },
  async findById(id, ex = db()) {
    const { rows } = await ex.query('select * from placement_cell_invitations where id = $1', [id]);
    return camelRow(rows[0]);
  },
  async list({ limit, offset }, ex = db()) {
    const { rows } = await ex.query(
      `select i.id, i.email, i.college_id, i.expires_at, i.accepted_at, i.revoked_at, i.created_at,
              c.name as college_name, count(*) over() as total
         from placement_cell_invitations i join colleges c on c.id = i.college_id
        order by i.created_at desc limit $1 offset $2`,
      [limit, offset],
    );
    return { items: camelRows(rows).map(({ total, ...r }) => r), total: rows[0]?.total ?? 0 };
  },
  async markAccepted(id, userId, ex) {
    await ex.query(
      'update placement_cell_invitations set accepted_at = now(), accepted_by = $2 where id = $1',
      [id, userId],
    );
  },
  async revoke(id, ex = db()) {
    const { rows } = await ex.query(
      `update placement_cell_invitations set revoked_at = now()
        where id = $1 and accepted_at is null and revoked_at is null returning *`,
      [id],
    );
    return camelRow(rows[0]);
  },
};
