import { useState } from 'react';
import { Box, Chip, Typography } from '@mui/material';
import { Stack } from '../../components/layout.jsx';
import EventIcon from '@mui/icons-material/Event';
import { useGet } from '../../api/hooks.js';
import { PageHeader, SurfaceCard } from '../../components/cards.jsx';
import { EmptyState, ErrorState, LoadingState } from '../../components/feedback.jsx';
import { fmtDateTime, titleCase } from '../../lib/format.js';

const isLink = (v) => /^https?:\/\//i.test(v ?? '');

function InterviewCard({ i }) {
  return (
    <SurfaceCard>
      <Stack direction={{ xs: 'column', sm: 'row' }} justifyContent="space-between" spacing={1}>
        <Box>
          <Typography variant="h6" component="h3">{i.companyName} · {i.roundName}</Typography>
          <Typography color="text.secondary">{i.driveTitle}</Typography>
        </Box>
        <Stack direction="row" spacing={1} alignItems="flex-start">
          <Chip size="small" label={titleCase(i.mode)} />
          <Chip size="small" label={titleCase(i.status)} color={i.status === 'cancelled' ? 'default' : 'primary'} />
        </Stack>
      </Stack>
      <Typography sx={{ mt: 1.5 }}><strong>{fmtDateTime(i.scheduledAt)}</strong> (IST)</Typography>
      {i.venueOrLink && (
        <Typography variant="body2" sx={{ mt: 0.5 }}>
          {i.mode === 'online' ? 'Link: ' : 'Venue: '}
          {isLink(i.venueOrLink) ? <a href={i.venueOrLink} target="_blank" rel="noopener noreferrer">{i.venueOrLink}</a> : i.venueOrLink}
        </Typography>
      )}
      {i.notes && <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>{i.notes}</Typography>}
    </SurfaceCard>
  );
}

export default function StudentInterviews() {
  const q = useGet('/interviews/mine');
  const [now] = useState(() => Date.now());
  if (q.isLoading) return <LoadingState lines={4} height={90} />;
  if (q.isError) return <ErrorState error={q.error} onRetry={q.refetch} />;
  const upcoming = q.data.filter((i) => i.status === 'scheduled' && new Date(i.scheduledAt).getTime() >= now);
  const past = q.data.filter((i) => !upcoming.includes(i));

  return (
    <>
      <PageHeader title="Interviews" subtitle="Scheduled by your placement cell." />
      {q.data.length === 0 && <EmptyState icon={<EventIcon sx={{ fontSize: 44 }} />} title="No interviews yet" description="When you are shortlisted and an interview is scheduled, it will show up here and in your notifications." />}
      {upcoming.length > 0 && (
        <>
          <Typography variant="h6" component="h2" sx={{ mb: 1.5 }}>Upcoming</Typography>
          <Stack spacing={2} sx={{ mb: 4 }}>{upcoming.map((i) => <InterviewCard key={i.id} i={i} />)}</Stack>
        </>
      )}
      {past.length > 0 && (
        <>
          <Typography variant="h6" component="h2" sx={{ mb: 1.5 }}>Past & cancelled</Typography>
          <Stack spacing={2}>{past.map((i) => <InterviewCard key={i.id} i={i} />)}</Stack>
        </>
      )}
    </>
  );
}
