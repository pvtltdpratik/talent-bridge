import { useEffect, useMemo, useState } from 'react';
import { zodResolver } from '@hookform/resolvers/zod';
import { Alert, Button, Link, Tab, Tabs, Typography } from '@mui/material';
import { Stack } from '../../components/layout.jsx';
import { useForm } from 'react-hook-form';
import { Link as RouterLink, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { z } from 'zod';
import { api, fieldErrors } from '../../api/client.js';
import { useGet } from '../../api/hooks.js';
import { HOME_BY_ROLE, useAuth } from '../../auth/AuthContext.jsx';
import { CheckboxInput, SelectInput, TextInput } from '../../components/forms.jsx';
import { ErrorState, LoadingState } from '../../components/feedback.jsx';
import { AccountStatusBadge } from '../../components/badges.jsx';

const email = z.string().trim().min(1, 'Enter your email').email('Enter a valid email');
const password = z.string().min(8, 'Use at least 8 characters').max(72);

function Heading({ title, subtitle }) {
  return (
    <>
      <Typography variant="h4" component="h1" sx={{ mb: 0.5 }}>
        {title}
      </Typography>
      {subtitle && (
        <Typography color="text.secondary" sx={{ mb: 3 }}>
          {subtitle}
        </Typography>
      )}
    </>
  );
}

// ---------------------------------------------------------------- login
export function LoginPage() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [error, setError] = useState('');
  const { control, handleSubmit, formState } = useForm({
    resolver: zodResolver(z.object({ email, password: z.string().min(1, 'Enter your password') })),
    defaultValues: { email: '', password: '' },
  });

  const onSubmit = handleSubmit(async (values) => {
    setError('');
    try {
      const user = await login(values.email, values.password);
      if (user.status !== 'active') return navigate('/account-status', { replace: true });
      const from = location.state?.from;
      navigate(from && from.startsWith(HOME_BY_ROLE[user.role]) ? from : HOME_BY_ROLE[user.role], { replace: true });
    } catch (e) {
      setError(e.message);
    }
  });

  return (
    <form onSubmit={onSubmit} noValidate>
      <Heading title="Welcome back" subtitle="Sign in to continue to TalentBridge AI." />
      <Stack spacing={2.5}>
        {error && <Alert severity="error" role="alert">{error}</Alert>}
        <TextInput control={control} name="email" label="Email" type="email" autoComplete="username" autoFocus />
        <TextInput control={control} name="password" label="Password" type="password" autoComplete="current-password" />
        <Button type="submit" variant="contained" size="large" disabled={formState.isSubmitting}>
          {formState.isSubmitting ? 'Signing in…' : 'Sign in'}
        </Button>
        <Stack direction="row" justifyContent="space-between" flexWrap="wrap" useFlexGap spacing={1}>
          <Link component={RouterLink} to="/forgot-password">Forgot password?</Link>
          <Link component={RouterLink} to="/register">Create an account</Link>
        </Stack>
      </Stack>
    </form>
  );
}

// ---------------------------------------------------------------- registration
const registerSchema = z
  .object({
    fullName: z.string().trim().min(2, 'Enter your full name').max(120),
    email,
    phone: z.string().trim().regex(/^$|^[0-9+\-\s()]{7,20}$/, 'Enter a valid phone number').optional(),
    collegeId: z.string().min(1, 'Choose your college'),
    password,
    confirm: z.string(),
    consent: z.boolean().refine((v) => v === true, 'Please accept the privacy notice to continue'),
  })
  .refine((v) => v.password === v.confirm, { path: ['confirm'], message: 'Passwords do not match' });

function RegisterForm({ kind, colleges }) {
  const [done, setDone] = useState(null);
  const [error, setError] = useState('');
  const { control, handleSubmit, setError: setFieldError, formState } = useForm({
    resolver: zodResolver(registerSchema),
    defaultValues: { fullName: '', email: '', phone: '', collegeId: '', password: '', confirm: '', consent: false },
  });

  const onSubmit = handleSubmit(async ({ confirm: _c, ...values }) => {
    setError('');
    try {
      const path = kind === 'student' ? '/auth/register/student' : '/auth/register/placement-cell';
      const data = await api.post(path, { ...values, phone: values.phone || undefined });
      setDone(data.message);
    } catch (e) {
      Object.entries(fieldErrors(e)).forEach(([field, message]) => setFieldError(field, { message }));
      setError(e.message);
    }
  });

  if (done) {
    return (
      <Alert severity="success" role="status">
        <strong>{kind === 'student' ? 'You are registered.' : 'Request received.'}</strong> {done}
        <Typography sx={{ mt: 1.5 }}>
          <Link component={RouterLink} to="/login">Go to sign in</Link>
        </Typography>
      </Alert>
    );
  }

  return (
    <form onSubmit={onSubmit} noValidate>
      <Stack spacing={2.25}>
        {kind === 'placement_cell' && (
          <Alert severity="info">
            Placement cell accounts need approval from an administrator before they can be used. If you were
            invited by email, use your invitation link instead.
          </Alert>
        )}
        {error && <Alert severity="error" role="alert">{error}</Alert>}
        <TextInput control={control} name="fullName" label="Full name" autoComplete="name" required />
        <TextInput control={control} name="email" label="Email" type="email" autoComplete="email" required />
        <TextInput control={control} name="phone" label="Phone (optional)" autoComplete="tel" />
        <SelectInput
          control={control}
          name="collegeId"
          label="College"
          required
          options={colleges.map((c) => ({ value: c.id, label: c.city ? `${c.name} (${c.city})` : c.name }))}
        />
        <TextInput control={control} name="password" label="Password" type="password" autoComplete="new-password" helper="At least 8 characters" required />
        <TextInput control={control} name="confirm" label="Confirm password" type="password" autoComplete="new-password" required />
        <CheckboxInput
          control={control}
          name="consent"
          label={<span>I have read the <Link component={RouterLink} to="/privacy" target="_blank">privacy notice</Link> and agree to my data being processed as described.</span>}
        />
        <Button type="submit" variant="contained" size="large" disabled={formState.isSubmitting}>
          {formState.isSubmitting ? 'Creating account…' : 'Create account'}
        </Button>
      </Stack>
    </form>
  );
}

export function RegisterPage() {
  const [tab, setTab] = useState('student');
  const colleges = useGet('/auth/colleges');
  return (
    <>
      <Heading title="Create your account" subtitle="Students register here. Placement cell staff can request access or use an invitation." />
      <Tabs value={tab} onChange={(_, v) => setTab(v)} sx={{ mb: 3 }} aria-label="Account type">
        <Tab value="student" label="Student" />
        <Tab value="placement_cell" label="Placement cell" />
      </Tabs>
      {colleges.isLoading && <LoadingState lines={5} />}
      {colleges.isError && <ErrorState error={colleges.error} onRetry={colleges.refetch} />}
      {colleges.data && colleges.data.length === 0 && (
        <Alert severity="warning">No colleges have been set up yet. Please ask your administrator to add your college first.</Alert>
      )}
      {colleges.data?.length > 0 && <RegisterForm key={tab} kind={tab} colleges={colleges.data} />}
      <Typography sx={{ mt: 3 }} color="text.secondary">
        Already have an account? <Link component={RouterLink} to="/login">Sign in</Link>
      </Typography>
    </>
  );
}

// ---------------------------------------------------------------- invitation
export function AcceptInvitePage() {
  const [params] = useSearchParams();
  const token = params.get('token') ?? '';
  const navigate = useNavigate();
  const info = useGet(token ? `/auth/invite/${encodeURIComponent(token)}` : null, null, { retry: false });
  const [error, setError] = useState('');
  const schema = useMemo(
    () =>
      z
        .object({
          fullName: z.string().trim().min(2, 'Enter your full name'),
          phone: z.string().trim().optional(),
          password,
          confirm: z.string(),
          consent: z.boolean().refine((v) => v === true, 'Please accept the privacy notice to continue'),
        })
        .refine((v) => v.password === v.confirm, { path: ['confirm'], message: 'Passwords do not match' }),
    [],
  );
  const { control, handleSubmit, formState } = useForm({
    resolver: zodResolver(schema),
    defaultValues: { fullName: '', phone: '', password: '', confirm: '', consent: false },
  });

  if (!token) return <Alert severity="error">This invitation link is incomplete. Please use the link from your email.</Alert>;
  if (info.isLoading) return <LoadingState lines={4} />;
  if (info.isError) {
    return (
      <>
        <Heading title="Invitation unavailable" />
        <Alert severity="error">This invitation is invalid, expired or has already been used. Ask your administrator for a new one.</Alert>
      </>
    );
  }

  const onSubmit = handleSubmit(async ({ confirm: _c, ...v }) => {
    setError('');
    try {
      await api.post('/auth/accept-invite', { token, ...v, phone: v.phone || undefined });
      navigate('/login', { replace: true, state: { invited: true } });
    } catch (e) {
      setError(e.message);
    }
  });

  return (
    <form onSubmit={onSubmit} noValidate>
      <Heading title="Accept your invitation" subtitle={`You were invited as a placement cell member for ${info.data.collegeName}.`} />
      <Stack spacing={2.25}>
        <Alert severity="info">Your account will use <strong>{info.data.email}</strong>.</Alert>
        {error && <Alert severity="error" role="alert">{error}</Alert>}
        <TextInput control={control} name="fullName" label="Full name" required autoComplete="name" />
        <TextInput control={control} name="phone" label="Phone (optional)" autoComplete="tel" />
        <TextInput control={control} name="password" label="Choose a password" type="password" autoComplete="new-password" helper="At least 8 characters" required />
        <TextInput control={control} name="confirm" label="Confirm password" type="password" autoComplete="new-password" required />
        <CheckboxInput control={control} name="consent" label={<span>I agree to the <Link component={RouterLink} to="/privacy" target="_blank">privacy notice</Link>.</span>} />
        <Button type="submit" variant="contained" size="large" disabled={formState.isSubmitting}>
          {formState.isSubmitting ? 'Creating account…' : 'Accept and create account'}
        </Button>
      </Stack>
    </form>
  );
}

// ---------------------------------------------------------------- password reset
export function ForgotPasswordPage() {
  const [message, setMessage] = useState('');
  const { control, handleSubmit, formState } = useForm({ resolver: zodResolver(z.object({ email })), defaultValues: { email: '' } });
  const onSubmit = handleSubmit(async (v) => {
    try {
      const data = await api.post('/auth/forgot-password', v);
      setMessage(data.message);
    } catch (e) {
      setMessage(e.message);
    }
  });
  return (
    <form onSubmit={onSubmit} noValidate>
      <Heading title="Reset your password" subtitle="We will email you a link if the address belongs to an account." />
      <Stack spacing={2.5}>
        {message && <Alert severity="success" role="status">{message}</Alert>}
        <TextInput control={control} name="email" label="Email" type="email" autoFocus />
        <Button type="submit" variant="contained" size="large" disabled={formState.isSubmitting}>Send reset link</Button>
        <Link component={RouterLink} to="/login">Back to sign in</Link>
      </Stack>
    </form>
  );
}

export function ResetPasswordPage() {
  const navigate = useNavigate();
  const [error, setError] = useState('');
  // Supabase puts the recovery token in the URL fragment: #access_token=...&type=recovery
  const [accessToken] = useState(() => {
    const hash = new URLSearchParams(window.location.hash.replace(/^#/, ''));
    const query = new URLSearchParams(window.location.search);
    return hash.get('access_token') || query.get('access_token') || '';
  });
  useEffect(() => {
    if (accessToken) window.history.replaceState(null, '', window.location.pathname); // keep the token out of history
  }, [accessToken]);
  const schema = useMemo(
    () => z.object({ password, confirm: z.string() }).refine((v) => v.password === v.confirm, { path: ['confirm'], message: 'Passwords do not match' }),
    [],
  );
  const { control, handleSubmit, formState } = useForm({ resolver: zodResolver(schema), defaultValues: { password: '', confirm: '' } });

  if (!accessToken) {
    return (
      <>
        <Heading title="Link not valid" />
        <Alert severity="error">This reset link is missing or has expired. <Link component={RouterLink} to="/forgot-password">Request a new one</Link>.</Alert>
      </>
    );
  }
  const onSubmit = handleSubmit(async (v) => {
    setError('');
    try {
      await api.post('/auth/reset-password', { accessToken, password: v.password });
      navigate('/login', { replace: true, state: { reset: true } });
    } catch (e) {
      setError(e.message);
    }
  });
  return (
    <form onSubmit={onSubmit} noValidate>
      <Heading title="Choose a new password" />
      <Stack spacing={2.5}>
        {error && <Alert severity="error" role="alert">{error}</Alert>}
        <TextInput control={control} name="password" label="New password" type="password" autoComplete="new-password" />
        <TextInput control={control} name="confirm" label="Confirm new password" type="password" autoComplete="new-password" />
        <Button type="submit" variant="contained" size="large" disabled={formState.isSubmitting}>Update password</Button>
      </Stack>
    </form>
  );
}

// ---------------------------------------------------------------- account state + privacy
export function AccountStatusPage() {
  const { user, logout, refreshUser } = useAuth();
  const navigate = useNavigate();
  if (!user) return null;
  const copy = {
    pending: 'An administrator needs to approve your placement cell account. You will be notified as soon as it is reviewed.',
    rejected: 'Your registration was not approved.',
    suspended: 'Your account has been suspended.',
    active: 'Your account is active.',
  }[user.status];
  return (
    <>
      <Heading title="Account status" />
      <Stack spacing={2.5}>
        <Stack direction="row" spacing={1} alignItems="center">
          <Typography>{user.email}</Typography>
          <AccountStatusBadge value={user.status} />
        </Stack>
        <Alert severity={user.status === 'pending' ? 'info' : user.status === 'active' ? 'success' : 'warning'}>
          {copy}
          {user.statusReason && <Typography sx={{ mt: 1 }}>Reason: {user.statusReason}</Typography>}
        </Alert>
        <Stack direction="row" spacing={1.5}>
          <Button variant="contained" onClick={async () => { await refreshUser(); if (user.status === 'active') navigate('/'); }}>Check again</Button>
          <Button onClick={async () => { await logout(); navigate('/login'); }}>Sign out</Button>
        </Stack>
      </Stack>
    </>
  );
}

export function PrivacyPage() {
  return (
    <>
      <Heading title="Privacy notice" subtitle="What TalentBridge AI collects and why." />
      <Stack spacing={2} component="article">
        <Typography><strong>What we collect.</strong> Account details, the academic and profile information you enter, resumes you upload, and activity such as applications and exception requests. We collect only what placement workflows need.</Typography>
        <Typography><strong>Who sees it.</strong> You, the placement cell of your own college, and platform administrators. Other colleges never see your data. Resumes are stored privately and opened only through short-lived links.</Typography>
        <Typography><strong>AI processing.</strong> To score resumes and fit, the text of your resume and profile (with your name, contact details, links and college name removed) may be sent to Google's Gemini service. AI output is advice; people make every hiring decision.</Typography>
        <Typography><strong>Your choices.</strong> You can edit your profile, delete any resume, and delete your account and associated data from Privacy &amp; account in the app.</Typography>
        <Typography><strong>Law.</strong> We design for the principles of India's Digital Personal Data Protection Act, 2023: notice, consent, purpose limitation, data minimisation and erasure. Contact your college placement cell for grievances.</Typography>
        <Link component={RouterLink} to="/login">Back</Link>
      </Stack>
    </>
  );
}
