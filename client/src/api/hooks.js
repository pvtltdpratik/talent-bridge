import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from './client.js';
import { useToast } from '../components/Toast.jsx';

/** GET with caching. `query` participates in the cache key. */
export function useGet(path, query, options = {}) {
  return useQuery({
    queryKey: [path, query ?? null],
    queryFn: () => api.get(path, query),
    enabled: path != null && options.enabled !== false,
    ...options,
  });
}

/**
 * Mutation helper: `mutationFn(vars)` returns the API promise.
 * `invalidate` is a list of path prefixes whose cached queries are refreshed on success.
 */
export function useSend(mutationFn, { invalidate = [], success, onSuccess, onError } = {}) {
  const qc = useQueryClient();
  const toast = useToast();
  return useMutation({
    mutationFn,
    onSuccess: async (data, vars) => {
      await Promise.all(
        invalidate.map((prefix) => qc.invalidateQueries({ predicate: (q) => String(q.queryKey[0]).startsWith(prefix) })),
      );
      if (success) toast.success(typeof success === 'function' ? success(data, vars) : success);
      onSuccess?.(data, vars);
    },
    onError: (err, vars) => {
      if (onError) onError(err, vars);
      else toast.error(err.message);
    },
  });
}
