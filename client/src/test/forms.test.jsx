import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ConfirmDialog } from '../components/ConfirmDialog.jsx';
import { LoginPage, RegisterPage } from '../pages/public/auth.jsx';

const login = vi.fn();
const navigate = vi.fn();
vi.mock('../auth/AuthContext.jsx', () => ({
  useAuth: () => ({ login, user: null }),
  HOME_BY_ROLE: { student: '/student', placement_cell: '/placement', admin: '/admin' },
}));
vi.mock('react-router-dom', async (orig) => ({ ...(await orig()), useNavigate: () => navigate }));
vi.mock('../api/client.js', async (orig) => {
  const mod = await orig();
  return {
    ...mod,
    api: {
      get: vi.fn(async (path) => (path === '/auth/colleges' ? [{ id: 'c1', name: 'Alpha Institute', city: 'Pune' }] : [])),
      post: vi.fn(),
    },
  };
});

const wrap = (ui) => (
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    <MemoryRouter>{ui}</MemoryRouter>
  </QueryClientProvider>
);

describe('LoginPage', () => {
  beforeEach(() => {
    login.mockReset();
    navigate.mockReset();
  });

  it('validates before calling the API', async () => {
    render(wrap(<LoginPage />));
    await userEvent.click(screen.getByRole('button', { name: /sign in/i }));
    expect(await screen.findByText(/enter your email/i)).toBeInTheDocument();
    expect(login).not.toHaveBeenCalled();
  });

  it('signs in and routes the user to their area', async () => {
    login.mockResolvedValue({ role: 'student', status: 'active' });
    render(wrap(<LoginPage />));
    await userEvent.type(screen.getByLabelText(/email/i), 'riya@example.com');
    await userEvent.type(screen.getByLabelText(/password/i), 'Password123!');
    await userEvent.click(screen.getByRole('button', { name: /sign in/i }));
    await waitFor(() => expect(login).toHaveBeenCalledWith('riya@example.com', 'Password123!'));
    expect(navigate).toHaveBeenCalledWith('/student', { replace: true });
  });

  it('shows the server error without crashing', async () => {
    login.mockRejectedValue(new Error('Incorrect email or password'));
    render(wrap(<LoginPage />));
    await userEvent.type(screen.getByLabelText(/email/i), 'riya@example.com');
    await userEvent.type(screen.getByLabelText(/password/i), 'wrong-password');
    await userEvent.click(screen.getByRole('button', { name: /sign in/i }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/incorrect email or password/i);
  });

  it('sends pending accounts to the status page', async () => {
    login.mockResolvedValue({ role: 'placement_cell', status: 'pending' });
    render(wrap(<LoginPage />));
    await userEvent.type(screen.getByLabelText(/email/i), 'staff@example.com');
    await userEvent.type(screen.getByLabelText(/password/i), 'Password123!');
    await userEvent.click(screen.getByRole('button', { name: /sign in/i }));
    await waitFor(() => expect(navigate).toHaveBeenCalledWith('/account-status', { replace: true }));
  });
});

describe('RegisterPage', () => {
  it('requires the privacy consent and a matching password, and never sends a role', async () => {
    const { api } = await import('../api/client.js');
    render(wrap(<RegisterPage />));
    await screen.findByLabelText(/^college/i);

    await userEvent.type(screen.getByLabelText(/full name/i), 'Riya Sharma');
    await userEvent.type(screen.getByLabelText(/^email/i), 'riya@example.com');
    await userEvent.type(screen.getByLabelText(/^password/i), 'Password123!');
    await userEvent.type(screen.getByLabelText(/confirm password/i), 'Different123!');
    await userEvent.click(screen.getByRole('button', { name: /create account/i }));

    expect(await screen.findByText(/passwords do not match/i)).toBeInTheDocument();
    expect(screen.getByText(/privacy notice to continue/i)).toBeInTheDocument();
    expect(api.post).not.toHaveBeenCalled();
  });
});

describe('ConfirmDialog', () => {
  it('requires a reason when one is mandatory and passes it on', async () => {
    const onConfirm = vi.fn();
    render(<ConfirmDialog open title="Reject?" inputLabel="Reason" inputRequired confirmLabel="Reject" onConfirm={onConfirm} onClose={() => {}} />);
    const confirm = screen.getByRole('button', { name: 'Reject' });
    expect(confirm).toBeDisabled();
    await userEvent.type(screen.getByLabelText(/reason/i), '  Not a staff member  ');
    expect(confirm).toBeEnabled();
    await userEvent.click(confirm);
    expect(onConfirm).toHaveBeenCalledWith('Not a staff member');
  });
});
