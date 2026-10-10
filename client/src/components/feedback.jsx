import { Alert, AlertTitle, Box, Button, Skeleton, Typography } from '@mui/material';
import { Stack } from './layout.jsx';
import InboxOutlinedIcon from '@mui/icons-material/InboxOutlined';
import ReplayIcon from '@mui/icons-material/Replay';

export function LoadingState({ lines = 3, height = 28 }) {
  return (
    <Stack spacing={1.5} aria-busy="true" aria-live="polite" aria-label="Loading">
      {Array.from({ length: lines }, (_, i) => (
        <Skeleton key={i} variant="rounded" height={height} animation="wave" />
      ))}
    </Stack>
  );
}

export function ErrorState({ error, onRetry, title = 'Something went wrong' }) {
  return (
    <Alert
      severity="error"
      variant="outlined"
      action={
        onRetry && (
          <Button color="inherit" size="small" startIcon={<ReplayIcon />} onClick={onRetry}>
            Try again
          </Button>
        )
      }
    >
      <AlertTitle>{title}</AlertTitle>
      {error?.message || 'Please try again.'}
    </Alert>
  );
}

export function EmptyState({ icon, title, description, action }) {
  return (
    <Box sx={{ textAlign: 'center', py: 6, px: 2 }}>
      <Box sx={{ color: 'text.secondary', mb: 1 }} aria-hidden="true">
        {icon ?? <InboxOutlinedIcon sx={{ fontSize: 44 }} />}
      </Box>
      <Typography variant="h6" component="p">
        {title}
      </Typography>
      {description && (
        <Typography color="text.secondary" sx={{ mt: 0.5, maxWidth: 460, mx: 'auto' }}>
          {description}
        </Typography>
      )}
      {action && <Box sx={{ mt: 2 }}>{action}</Box>}
    </Box>
  );
}

/** Renders loading / error / empty / content for a react-query result. */
export function QueryBoundary({ query, children, isEmpty, empty, loadingLines }) {
  if (query.isLoading) return <LoadingState lines={loadingLines} />;
  if (query.isError) return <ErrorState error={query.error} onRetry={() => query.refetch()} />;
  if (isEmpty?.(query.data)) return empty ?? <EmptyState title="Nothing here yet" />;
  return children(query.data);
}
