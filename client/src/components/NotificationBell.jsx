import { useState } from 'react';
import { Badge, Box, Button, IconButton, List, ListItemButton, ListItemText, Popover, Tooltip, Typography } from '@mui/material';
import { Stack } from './layout.jsx';
import NotificationsNoneIcon from '@mui/icons-material/NotificationsNone';
import { useNavigate } from 'react-router-dom';
import { useGet, useSend } from '../api/hooks.js';
import { api } from '../api/client.js';
import { fmtDateTime } from '../lib/format.js';

export function NotificationBell({ allLink }) {
  const navigate = useNavigate();
  const [anchor, setAnchor] = useState(null);
  const count = useGet('/notifications/unread-count', null, { refetchInterval: 60_000, refetchOnWindowFocus: true });
  const list = useGet('/notifications', { pageSize: 8 }, { enabled: !!anchor });
  const markAll = useSend(() => api.post('/notifications/read-all'), { invalidate: ['/notifications'] });
  const markOne = useSend((id) => api.post(`/notifications/${id}/read`), { invalidate: ['/notifications'], onError: () => {} });

  const unread = count.data?.unreadCount ?? 0;

  return (
    <>
      <Tooltip title="Notifications">
        <IconButton onClick={(e) => setAnchor(e.currentTarget)} aria-label={`Notifications, ${unread} unread`} color="inherit">
          <Badge badgeContent={unread} color="error" max={99}>
            <NotificationsNoneIcon />
          </Badge>
        </IconButton>
      </Tooltip>
      <Popover
        open={!!anchor}
        anchorEl={anchor}
        onClose={() => setAnchor(null)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
        transformOrigin={{ vertical: 'top', horizontal: 'right' }}
        slotProps={{ paper: { sx: { width: { xs: 'calc(100vw - 32px)', sm: 380 }, maxHeight: 480 } } }}
      >
        <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ px: 2, py: 1.25, borderBottom: '1px solid var(--tb-border)' }}>
          <Typography fontWeight={600}>Notifications</Typography>
          <Button size="small" disabled={!unread || markAll.isPending} onClick={() => markAll.mutate()}>
            Mark all read
          </Button>
        </Stack>
        <List disablePadding>
          {list.isLoading && <Box sx={{ p: 2 }}><Typography color="text.secondary">Loading…</Typography></Box>}
          {list.data?.items?.length === 0 && <Box sx={{ p: 3 }}><Typography color="text.secondary" align="center">You are all caught up.</Typography></Box>}
          {list.data?.items?.map((n) => (
            <ListItemButton
              key={n.id}
              onClick={() => {
                if (!n.readAt) markOne.mutate(n.id);
                setAnchor(null);
                if (n.link) navigate(n.link);
              }}
              sx={{ alignItems: 'flex-start', bgcolor: n.readAt ? undefined : 'var(--tb-indigo-tint)' }}
            >
              <ListItemText
                primary={n.title}
                secondary={
                  <>
                    {n.body}
                    <Typography component="span" variant="caption" display="block" color="text.secondary">
                      {fmtDateTime(n.createdAt)}
                    </Typography>
                  </>
                }
                slotProps={{ primary: { fontWeight: n.readAt ? 500 : 700, fontSize: 14 }, secondary: { component: 'div', fontSize: 13 } }}
              />
            </ListItemButton>
          ))}
        </List>
        {allLink && (
          <Box sx={{ p: 1, borderTop: '1px solid var(--tb-border)', textAlign: 'center' }}>
            <Button size="small" onClick={() => { setAnchor(null); navigate(allLink); }}>
              View all
            </Button>
          </Box>
        )}
      </Popover>
    </>
  );
}
