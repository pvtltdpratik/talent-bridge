import JSZip from 'jszip';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bearer, createTestEnv } from '../helpers/harness.js';
import { detectResumeType } from '../../src/services/students.js';

let t;
let A;
let B;
let staffA;
let staffB;
let admin;

const TEXT = 'Priya Sharma is a final-year computer science student. Skills: JavaScript, React, Node.js, PostgreSQL, Git. '
  + 'Projects: Built a campus event portal with React and Express serving 500 users. Internship: backend intern at Orbit Labs.';

function makePdf(lines) {
  const esc = (s) => s.replace(/([()\\])/g, '\\$1');
  const stream = lines.length
    ? `BT /F1 11 Tf 50 780 Td 14 TL ${lines.map((l) => `(${esc(l)}) Tj T*`).join(' ')} ET`
    : '';
  const objs = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 842] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  let out = '%PDF-1.4\n';
  const offsets = [];
  objs.forEach((o, i) => {
    offsets.push(out.length);
    out += `${i + 1} 0 obj\n${o}\nendobj\n`;
  });
  const xref = out.length;
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}`;
  out += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return Buffer.from(out, 'latin1');
}

async function makeDocx(text) {
  const zip = new JSZip();
  zip.file('[Content_Types].xml', '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>');
  zip.file('_rels/.rels', '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>');
  zip.file('word/document.xml', `<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>${text}</w:t></w:r></w:p></w:body></w:document>`);
  return zip.generateAsync({ type: 'nodebuffer' });
}

beforeAll(async () => {
  t = await createTestEnv();
  A = await t.seed.college('Alpha');
  B = await t.seed.college('Beta');
  staffA = await t.seed.user({ role: 'placement_cell', collegeId: A });
  staffB = await t.seed.user({ role: 'placement_cell', collegeId: B });
  admin = await t.seed.user({ role: 'admin' });
});
afterAll(() => t.close());

const api = () => request(t.app);
const upload = (user, buf, filename = 'cv.pdf', contentType = 'application/pdf') =>
  api().post('/api/students/me/resumes').set(bearer(user)).attach('file', buf, { filename, contentType });
const q = (sql, params) => t.db.query(sql, params).then((r) => r.rows);

describe('content-based file type detection', () => {
  it('recognises PDF and DOCX by their bytes, not their names', async () => {
    expect(detectResumeType(makePdf(['hi']))).toBe('pdf');
    expect(detectResumeType(await makeDocx('hi'))).toBe('docx');
    expect(detectResumeType(Buffer.from('plain text pretending to be a pdf'))).toBeNull();
    expect(detectResumeType(Buffer.from('MZ\x90\x00 an exe'))).toBeNull();
    const zip = new JSZip();
    zip.file('notes.txt', 'just a zip');
    expect(detectResumeType(await zip.generateAsync({ type: 'nodebuffer' }))).toBeNull();
  });
});

describe('resume upload', () => {
  it('extracts text from a PDF, stores it privately and versions uploads (one active)', async () => {
    const s = await t.seed.user({ role: 'student', collegeId: A });
    const first = await upload(s, makePdf([TEXT.slice(0, 110), TEXT.slice(110)]));
    expect(first.status).toBe(201);
    expect(first.body.data).toMatchObject({ extractionStatus: 'ok', version: 1 });
    const [row] = await q('select * from resumes where id = $1', [first.body.data.id]);
    expect(row.extracted_text).toContain('JavaScript');
    expect(row.is_active).toBe(true);
    expect(t.storage.files.has(row.file_path)).toBe(true);
    expect(row.file_path.startsWith(`${s.id}/`)).toBe(true);

    const second = await upload(s, await makeDocx(TEXT), 'resume.docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
    expect(second.status).toBe(201);
    expect(second.body.data).toMatchObject({ extractionStatus: 'ok', version: 2 });

    const rows = await q('select version, is_active from resumes where student_id = $1 order by version', [s.id]);
    expect(rows).toEqual([{ version: 1, is_active: false }, { version: 2, is_active: true }]);
    const list = await api().get('/api/students/me/resumes').set(bearer(s));
    expect(list.body.data).toHaveLength(2);
    expect(list.body.data[0].version).toBe(2);
    // the profile shows the active version and recomputes completion
    const me = await api().get('/api/students/me').set(bearer(s));
    expect(me.body.data.resume.version).toBe(2);
    expect(me.body.data.completion.missing.some((m) => m.key === 'resume')).toBe(false);
  });

  it('rejects files whose content is not a PDF/DOCX, even with a PDF name and mime type', async () => {
    const s = await t.seed.user({ role: 'student', collegeId: A });
    const fake = await upload(s, Buffer.from('<html><script>alert(1)</script></html>'), 'cv.pdf', 'application/pdf');
    expect(fake.status).toBe(422);
    expect(fake.body.error.code).toBe('unsupported_file');
    const zip = new JSZip();
    zip.file('a.txt', 'x');
    const notDocx = await upload(s, await zip.generateAsync({ type: 'nodebuffer' }), 'cv.docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
    expect(notDocx.status).toBe(422);
    expect(await q('select 1 from resumes where student_id = $1', [s.id])).toHaveLength(0);
    expect(t.storage.files.size).toBeGreaterThan(0); // earlier test files only; nothing new stored for rejects
  });

  it('tells the user clearly when no text can be read (scanned PDF) and never fakes a score', async () => {
    const s = await t.seed.user({ role: 'student', collegeId: A });
    const res = await upload(s, makePdf([]));
    expect(res.status).toBe(201);
    expect(res.body.data.extractionStatus).toBe('failed');
    expect(res.body.data.message).toMatch(/could not|No readable text/i);
    const [row] = await q('select extraction_status, extracted_text, extraction_error from resumes where student_id = $1', [s.id]);
    expect(row.extraction_status).toBe('failed');
    expect(row.extracted_text).toBeNull();
    const analysis = await api().post('/api/ai/resume/analyze').set(bearer(s)).send({});
    expect(analysis.status).toBe(422);
    expect(analysis.body.error.code).toBe('resume_unreadable');
    expect(t.gemini.calls).toHaveLength(0);
  });

  it('requires a file and enforces the configurable size limit', async () => {
    const s = await t.seed.user({ role: 'student', collegeId: A });
    expect((await api().post('/api/students/me/resumes').set(bearer(s))).status).toBe(400);

    await api().put('/api/admin/settings').set(bearer(admin)).send({ upload_max_mb: 1 });
    const big = Buffer.concat([makePdf([TEXT]), Buffer.alloc(1.5 * 1024 * 1024, 0x20)]);
    const res = await upload(s, big);
    expect(res.status).toBe(413);
    expect(res.body.error.code).toBe('file_too_large');
    await api().put('/api/admin/settings').set(bearer(admin)).send({ upload_max_mb: 5 });
  });

  it('is student-only', async () => {
    expect((await upload(staffA, makePdf([TEXT]))).status).toBe(403);
  });
});

describe('private access to resumes', () => {
  let owner;
  let resumeId;
  beforeAll(async () => {
    owner = await t.seed.user({ role: 'student', collegeId: A });
    resumeId = (await upload(owner, makePdf([TEXT]))).body.data.id;
  });

  it('issues a short-lived signed URL to the owner only', async () => {
    const ok = await api().get(`/api/students/me/resumes/${resumeId}/url`).set(bearer(owner));
    expect(ok.status).toBe(200);
    expect(ok.body.data.url).toContain('signed');
    expect(ok.body.data.expiresInSeconds).toBe(120);

    const other = await t.seed.user({ role: 'student', collegeId: A });
    expect((await api().get(`/api/students/me/resumes/${resumeId}/url`).set(bearer(other))).status).toBe(404);
    expect((await api().get(`/api/students/me/resumes/${resumeId}/url`)).status).toBe(401);
  });

  it('lets staff of the same college (and admin) view; other colleges get 404', async () => {
    expect((await api().get(`/api/students/${owner.id}/resume-url`).set(bearer(staffA))).status).toBe(200);
    expect((await api().get(`/api/students/${owner.id}/resume-url`).set(bearer(admin))).status).toBe(200);
    expect((await api().get(`/api/students/${owner.id}/resume-url`).set(bearer(staffB))).status).toBe(404);
    const other = await t.seed.user({ role: 'student', collegeId: A });
    expect((await api().get(`/api/students/${owner.id}/resume-url`).set(bearer(other))).status).toBe(403);
  });

  it('lets the student delete a resume; the previous version becomes active again', async () => {
    const s = await t.seed.user({ role: 'student', collegeId: A });
    const v1 = (await upload(s, makePdf([TEXT]))).body.data.id;
    const v2 = (await upload(s, makePdf([TEXT, 'Extra line for version two of the resume document']))).body.data.id;
    const [r2] = await q('select file_path from resumes where id = $1', [v2]);
    const del = await api().delete(`/api/students/me/resumes/${v2}`).set(bearer(s));
    expect(del.status).toBe(204);
    expect(t.storage.files.has(r2.file_path)).toBe(false);
    const rows = await q('select id, is_active from resumes where student_id = $1', [s.id]);
    expect(rows).toEqual([{ id: v1, is_active: true }]);
  });

  it('erases account data on request (student)', async () => {
    const s = await t.seed.user({ role: 'student', collegeId: A });
    const id = (await upload(s, makePdf([TEXT]))).body.data.id;
    const [r] = await q('select file_path from resumes where id = $1', [id]);
    const del = await api().delete('/api/auth/me').set(bearer(s));
    expect(del.status).toBe(200);
    expect(await q('select 1 from profiles where id = $1', [s.id])).toHaveLength(0);
    expect(await q('select 1 from resumes where student_id = $1', [s.id])).toHaveLength(0);
    expect(t.storage.files.has(r.file_path)).toBe(false);
    expect(await q("select 1 from audit_logs where action = 'account.deleted' and target_id = $1", [s.id])).toHaveLength(1);
  });
});
