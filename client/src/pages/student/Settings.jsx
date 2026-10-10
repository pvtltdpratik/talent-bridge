import { useState } from 'react';
import { Alert, Button, TextField, Typography } from '@mui/material';
import { Stack } from '../../components/layout.jsx';
import { useNavigate } from 'react-router-dom';
import { api } from '../../api/client.js';
import { useAuth } from '../../auth/AuthContext.jsx';
import { useSend } from '../../api/hooks.js';
import { PageHeader, SurfaceCard } from '../../components/cards.jsx';
import { ConfirmDialog } from '../../components/ConfirmDialog.jsx';

export default function StudentSettings() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState('');
  const del = useSend(() => api.delete('/auth/me'), {
    onSuccess: async () => { await logout(); navigate('/login', { replace: true }); },
  });

  return (
    <>
      <PageHeader title="Privacy & account" subtitle={user.email} />
      <Stack spacing={3}>
        <SurfaceCard title="What is processed about you">
          <Typography>
            Your profile and resume are visible to you, the placement cell of your college and platform administrators.
            When you use AI features, resume and profile text (with your name, contact details, links and college name
            removed) is sent to Google's Gemini service. Read the full <a href="/privacy" target="_blank" rel="noopener noreferrer">privacy notice</a>.
          </Typography>
        </SurfaceCard>
        <SurfaceCard title="Delete my account and data">
          <Alert severity="warning" sx={{ mb: 2 }}>
            This permanently removes your profile, resumes, applications, exception requests and notifications. It cannot be undone.
            Audit records that a deletion happened are kept.
          </Alert>
          <Button color="error" variant="outlined" onClick={() => setOpen(true)}>Delete my account</Button>
        </SurfaceCard>
      </Stack>
      <ConfirmDialog
        open={open} title="Delete your account?" confirmLabel="Delete everything" danger loading={del.isPending}
        message="Type DELETE to confirm." onClose={() => { setOpen(false); setTyped(''); }} onConfirm={() => typed === 'DELETE' && del.mutate()}
      >
        <TextField value={typed} onChange={(e) => setTyped(e.target.value)} label="Type DELETE" autoFocus sx={{ mt: 1 }} />
      </ConfirmDialog>
    </>
  );
}
