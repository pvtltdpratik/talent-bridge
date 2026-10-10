import { Box, CircularProgress } from '@mui/material';
import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { HOME_BY_ROLE, useAuth } from '../auth/AuthContext.jsx';

export function FullPageLoading() {
  return (
    <Box sx={{ minHeight: '60vh', display: 'grid', placeItems: 'center' }} role="status" aria-label="Loading">
      <CircularProgress />
    </Box>
  );
}

/**
 * Client-side routing guard. This is a UX convenience only: every API call is authorised again
 * on the server by role, account status, college and ownership.
 */
export function RequireRole({ roles }) {
  const { user, loading } = useAuth();
  const location = useLocation();
  if (loading) return <FullPageLoading />;
  if (!user) return <Navigate to="/login" state={{ from: location.pathname }} replace />;
  if (user.status !== 'active') return <Navigate to="/account-status" replace />;
  if (!roles.includes(user.role)) return <Navigate to={HOME_BY_ROLE[user.role]} replace />;
  return <Outlet />;
}

/** Public pages (login/register) bounce signed-in users to their home. */
export function PublicOnly() {
  const { user, loading } = useAuth();
  if (loading) return <FullPageLoading />;
  if (user) return <Navigate to={user.status === 'active' ? HOME_BY_ROLE[user.role] : '/account-status'} replace />;
  return <Outlet />;
}

export function HomeRedirect() {
  const { user, loading } = useAuth();
  if (loading) return <FullPageLoading />;
  if (!user) return <Navigate to="/login" replace />;
  return <Navigate to={user.status === 'active' ? HOME_BY_ROLE[user.role] : '/account-status'} replace />;
}
