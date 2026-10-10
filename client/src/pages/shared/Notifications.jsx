import { useState } from 'react';
import { Box, Button, Typography } from '@mui/material';
import { Stack } from '../../components/layout.jsx';
import { useNavigate } from 'react-router-dom';
import { api } from '../../api/client.js';
import { useGet, useSend } from '../../api/hooks.js';
import { PageHeader, SurfaceCard } from '../../components/cards.jsx';
import { EmptyState, ErrorState, LoadingState } from '../../components/feedback.jsx';
import { fmtDateTime } from '../../lib/format.js';

export default function Notifications() {
  const navigate = useNavigate();
  const [page, setPage] = useState(1);
  const q = useGet('/notifications', { page, pageSize: 20 });
  const read = useSend((id) => api.post(`/notifications/${id}/read`), { invalidate: ['/notifications'], onError: () => {} });
  const readAll = useSend(() => api.post('/notifications/read-all'), { invalidate: ['/notifications'], success: 'All marked as read.' });

  return (
    <>
      <PageHeader title="Notifications" actions={<Button onClick={() => readAll.mutate()} disabled={!q.data?.unreadCount}>Mark all as read</Button>} />
      {q.isLoading && <LoadingState lines={5} />}
      {q.isError && <ErrorState error={q.error} onRetry={q.refetch} />}
      {q.data?.items.length === 0 && <EmptyState title="You are all caught up" description="Updates about verification, drives, applications and interviews appear here." />}
      <Stack spacing={1.5}>
        {q.data?.items.map((n) => (
          <SurfaceCard key={n.id} sx={{ borderLeft: n.readAt ? undefined : '4px solid var(--tb-indigo)' }}>
            <Stack direction="row" justifyContent="space-between" spacing={2} alignItems="flex-start">
              <Box>
                <Typography fontWeight={n.readAt ? 500 : 700}>{n.title}</Typography>
                <Typography variant="body2" color="text.secondary">{n.body}</Typography>
                <Typography variant="caption" color="text.secondary">{fmtDateTime(n.createdAt)}</Typography>
              </Box>
              <Stack direction="row" spacing={1}>
                {n.link && <Button size="small" onClick={() => { if (!n.readAt) read.mutate(n.id); navigate(n.link); }}>Open</Button>}
                {!n.readAt && <Button size="small" color="inherit" onClick={() => read.mutate(n.id)}>Mark read</Button>}
              </Stack>
            </Stack>
          </SurfaceCard>
        ))}
      </Stack>
      {q.data && q.data.totalPages > 1 && (
        <Stack direction="row" spacing={1} justifyContent="center" sx={{ mt: 3 }}>
          <Button disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>Previous</Button>
          <Typography sx={{ alignSelf: 'center' }}>Page {page} of {q.data.totalPages}</Typography>
          <Button disabled={page >= q.data.totalPages} onClick={() => setPage((p) => p + 1)}>Next</Button>
        </Stack>
      )}
    </>
  );
}
