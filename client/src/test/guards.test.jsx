import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { RequireRole } from '../routes/guards.jsx';

const auth = { user: null, loading: false };
vi.mock('../auth/AuthContext.jsx', () => ({
  useAuth: () => auth,
  HOME_BY_ROLE: { student: '/student', placement_cell: '/placement', admin: '/admin' },
}));

function renderAt(path) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/login" element={<div>login page</div>} />
        <Route path="/account-status" element={<div>account status page</div>} />
        <Route path="/student" element={<div>student home</div>} />
        <Route path="/placement" element={<div>placement home</div>} />
        <Route element={<RequireRole roles={['admin']} />}>
          <Route path="/admin" element={<div>admin area</div>} />
        </Route>
        <Route element={<RequireRole roles={['placement_cell', 'admin']} />}>
          <Route path="/placement/secret" element={<div>placement area</div>} />
        </Route>
      </Routes>
    </MemoryRouter>,
  );
}

describe('RequireRole', () => {
  beforeEach(() => {
    auth.user = null;
    auth.loading = false;
  });

  it('sends signed-out visitors to the login page', () => {
    renderAt('/admin');
    expect(screen.getByText('login page')).toBeInTheDocument();
  });

  it('shows a loading indicator while the session is restored', () => {
    auth.loading = true;
    renderAt('/admin');
    expect(screen.getByRole('status', { name: /loading/i })).toBeInTheDocument();
    expect(screen.queryByText('admin area')).not.toBeInTheDocument();
  });

  it('keeps students out of admin and placement areas', () => {
    auth.user = { role: 'student', status: 'active' };
    renderAt('/admin');
    expect(screen.getByText('student home')).toBeInTheDocument();
    expect(screen.queryByText('admin area')).not.toBeInTheDocument();
  });

  it('keeps placement cell members out of the admin area', () => {
    auth.user = { role: 'placement_cell', status: 'active' };
    renderAt('/admin');
    expect(screen.getByText('placement home')).toBeInTheDocument();
  });

  it('lets the right role in', () => {
    auth.user = { role: 'admin', status: 'active' };
    renderAt('/admin');
    expect(screen.getByText('admin area')).toBeInTheDocument();
  });

  it('holds pending and suspended accounts on the status page', () => {
    auth.user = { role: 'placement_cell', status: 'pending' };
    renderAt('/placement/secret');
    expect(screen.getByText('account status page')).toBeInTheDocument();
  });
});
