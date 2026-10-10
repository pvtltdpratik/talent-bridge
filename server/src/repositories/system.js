import { db } from '../context.js';
import { camelRow, camelRows } from '../utils/helpers.js';

export const notifications = {
  async insert({ userId, type, title, body, link }, ex = db()) {
    await ex.query(
      'insert into notifications (user_id, type, title, body, link) values ($1,$2,$3,$4,$5)',
      [userId, type, title, body ?? null, link ?? null],
    );
  },
  async list(userId, { unreadOnly, limit, offset }, ex = db()) {
    const { rows } = await ex.query(
      `select *, count(*) over() as total from notifications
        where user_id = $1 and ($2::boolean = false or read_at is null)
        order by created_at desc limit $3 offset $4`,
      [userId, unreadOnly ?? false, limit, offset],
    );
    return { items: camelRows(rows).map(({ total, ...r }) => r), total: rows[0]?.total ?? 0 };
  },
  async unreadCount(userId, ex = db()) {
    const { rows } = await ex.query('select count(*)::int as n from notifications where user_id = $1 and read_at is null', [userId]);
    return rows[0].n;
  },
  async markRead(userId, id, ex = db()) {
    const { rowCount } = await ex.query('update notifications set read_at = now() where id = $1 and user_id = $2 and read_at is null', [id, userId]);
    return rowCount;
  },
  async markAllRead(userId, ex = db()) {
    await ex.query('update notifications set read_at = now() where user_id = $1 and read_at is null', [userId]);
  },
};

export const audit = {
  async insert(e, ex = db()) {
    await ex.query(
      `insert into audit_logs (actor_id, actor_role, action, target_type, target_id, college_id, old_value, new_value, ip)
       values ($1,$2,$3,$4,$5,$6,$7::jsonb,$8::jsonb,$9)`,
      [e.actorId ?? null, e.actorRole ?? null, e.action, e.targetType ?? null, e.targetId ?? null, e.collegeId ?? null,
        e.oldValue === undefined ? null : JSON.stringify(e.oldValue),
        e.newValue === undefined ? null : JSON.stringify(e.newValue), e.ip ?? null],
    );
  },
  async list({ action, actorId, targetType, from, to, collegeId, limit, offset }, ex = db()) {
    const { rows } = await ex.query(
      `select a.*, p.full_name as actor_name, count(*) over() as total
         from audit_logs a left join profiles p on p.id = a.actor_id
        where ($1::text is null or a.action = $1) and ($2::uuid is null or a.actor_id = $2)
          and ($3::text is null or a.target_type = $3) and ($4::timestamptz is null or a.created_at >= $4)
          and ($5::timestamptz is null or a.created_at <= $5) and ($6::uuid is null or a.college_id = $6)
        order by a.created_at desc, a.id desc limit $7 offset $8`,
      [action ?? null, actorId ?? null, targetType ?? null, from ?? null, to ?? null, collegeId ?? null, limit, offset],
    );
    return { items: camelRows(rows).map(({ total, ...r }) => r), total: rows[0]?.total ?? 0 };
  },
};

export const settings = {
  async all(ex = db()) {
    const { rows } = await ex.query('select key, value from system_settings');
    return Object.fromEntries(rows.map((r) => [r.key, r.value]));
  },
  async upsert(key, value, by, ex = db()) {
    await ex.query(
      `insert into system_settings (key, value, updated_by) values ($1,$2::jsonb,$3)
       on conflict (key) do update set value = excluded.value, updated_by = excluded.updated_by, updated_at = now()`,
      [key, JSON.stringify(value), by],
    );
  },
};

export const aiResults = {
  async findOk({ feature, userId, scopeKey, inputHash }, ex = db()) {
    const { rows } = await ex.query(
      `select * from ai_analyses where feature = $1 and subject_user_id = $2 and scope_key = $3
          and input_hash = $4 and status = 'ok'`,
      [feature, userId, scopeKey, inputHash],
    );
    return camelRow(rows[0]);
  },
  async findLatestOk({ feature, userId, scopeKey }, ex = db()) {
    const { rows } = await ex.query(
      `select * from ai_analyses where feature = $1 and subject_user_id = $2 and scope_key = $3 and status = 'ok'
        order by created_at desc limit 1`,
      [feature, userId, scopeKey],
    );
    return camelRow(rows[0]);
  },
  async upsertOk(r, ex = db()) {
    const { rows } = await ex.query(
      `insert into ai_analyses (feature, subject_user_id, drive_id, scope_key, model, prompt_version, input_hash, status, output)
       values ($1,$2,$3,$4,$5,$6,$7,'ok',$8::jsonb)
       on conflict (feature, subject_user_id, scope_key, input_hash) where status = 'ok'
       do update set output = excluded.output, model = excluded.model, prompt_version = excluded.prompt_version,
                     created_at = now()
       returning *`,
      [r.feature, r.userId, r.driveId ?? null, r.scopeKey, r.model, r.promptVersion, r.inputHash, JSON.stringify(r.output)],
    );
    return camelRow(rows[0]);
  },
  async insertFailed(r, ex = db()) {
    await ex.query(
      `insert into ai_analyses (feature, subject_user_id, drive_id, scope_key, model, prompt_version, input_hash, status, error)
       values ($1,$2,$3,$4,$5,$6,$7,'failed',$8)`,
      [r.feature, r.userId, r.driveId ?? null, r.scopeKey, r.model, r.promptVersion, r.inputHash, String(r.error).slice(0, 500)],
    );
  },
  /** Latest successful result per scope (e.g. per drive) for one user and feature. */
  async latestForUser({ feature, userId }, ex = db()) {
    const { rows } = await ex.query(
      `select distinct on (scope_key) scope_key, output, created_at from ai_analyses
        where feature = $1 and subject_user_id = $2 and status = 'ok'
        order by scope_key, created_at desc`,
      [feature, userId],
    );
    return new Map(rows.map((x) => [x.scope_key, x]));
  },
  /** Latest successful result per student for a feature+drive (used for ranking without new AI calls). */
  async latestForStudents({ feature, scopeKey, userIds }, ex = db()) {
    if (!userIds.length) return new Map();
    const { rows } = await ex.query(
      `select distinct on (subject_user_id) subject_user_id, output, input_hash, created_at
         from ai_analyses
        where feature = $1 and scope_key = $2 and status = 'ok' and subject_user_id = any($3::uuid[])
        order by subject_user_id, created_at desc`,
      [feature, scopeKey, userIds],
    );
    return new Map(rows.map((r) => [r.subject_user_id, r]));
  },
};
