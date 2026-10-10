import { createClient } from '@supabase/supabase-js';
import { AppError } from '../utils/errors.js';

/** Private Supabase Storage bucket for resumes. Access is only ever via short-lived signed URLs. */
export function createSupabaseStorage({ url, serviceKey, bucket }) {
  const client = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const store = () => client.storage.from(bucket);

  return {
    async upload(path, buffer, contentType) {
      const { error } = await store().upload(path, buffer, { contentType, upsert: false });
      if (error) throw new AppError(502, 'storage_error', 'Could not store the file. Please try again.');
    },
    async signedUrl(path, expiresInSeconds = 120) {
      const { data, error } = await store().createSignedUrl(path, expiresInSeconds);
      if (error || !data?.signedUrl) throw new AppError(502, 'storage_error', 'Could not create a download link.');
      return data.signedUrl;
    },
    async remove(paths) {
      const list = Array.isArray(paths) ? paths : [paths];
      if (!list.length) return;
      await store().remove(list);
    },
  };
}
