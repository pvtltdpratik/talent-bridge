import { createContext, useContext, useMemo, useState } from 'react';
import { AppBar, Avatar, Box, Divider, Drawer, IconButton, List, ListItemButton, ListItemIcon, ListItemText, ListSubheader, Menu, MenuItem, Select, Toolbar, Tooltip, Typography, useMediaQuery } from '@mui/material';
import { Stack } from '../components/layout.jsx';
import { useTheme } from '@mui/material/styles';
import MenuIcon from '@mui/icons-material/Menu';
import MenuOpenIcon from '@mui/icons-material/MenuOpen';
import LogoutIcon from '@mui/icons-material/Logout';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext.jsx';
import { useGet } from '../api/hooks.js';
import { NotificationBell } from '../components/NotificationBell.jsx';
import { colors } from '../theme/tokens.js';

const EXPANDED = 264;
const COLLAPSED = 76;

// ---- admin college scope (placement pages are shared by placement cell and admin) -----------------
const ScopeContext = createContext({ collegeId: '', scopeParams: {} });
export const useScope = () => useContext(ScopeContext);

function Brand({ collapsed }) {
  return (
    <Stack direction="row" spacing={1.5} alignItems="center" sx={{ px: 2.5, height: 64 }}>
      <Box component="img" src="/favicon.svg" alt="" sx={{ width: 34, height: 34, borderRadius: 2 }} />
      {!collapsed && (
        <Typography variant="h6" component="span" sx={{ color: '#fff', fontWeight: 700 }}>
          TalentBridge <span style={{ color: colors.lilac }}>AI</span>
        </Typography>
      )}
    </Stack>
  );
}

function NavList({ nav, collapsed, onNavigate }) {
  const location = useLocation();
  return (
    <List component="nav" aria-label="Main navigation" sx={{ px: 1.5 }}>
      {nav.map((item, i) =>
        item.heading ? (
          !collapsed && (
            <ListSubheader key={`h${i}`} sx={{ bgcolor: 'transparent', color: 'rgba(255,255,255,.55)', lineHeight: '32px', mt: 1, fontSize: 12, letterSpacing: '.06em', textTransform: 'uppercase' }}>
              {item.heading}
            </ListSubheader>
          )
        ) : (
          <Tooltip key={item.to} title={collapsed ? item.label : ''} placement="right">
            <ListItemButton
              component={NavLink}
              to={item.to}
              end={item.end}
              onClick={onNavigate}
              selected={item.end ? location.pathname === item.to : location.pathname.startsWith(item.to)}
              sx={{
                borderRadius: 3, mb: 0.5, color: 'rgba(255,255,255,.82)', minHeight: 44, justifyContent: collapsed ? 'center' : 'flex-start',
                '&:hover': { bgcolor: 'rgba(255,255,255,.08)' },
                '&.Mui-selected': { bgcolor: colors.indigo, color: '#fff', '&:hover': { bgcolor: colors.indigoDark } },
              }}
              aria-label={item.label}
            >
              <ListItemIcon sx={{ color: 'inherit', minWidth: collapsed ? 0 : 40 }}>{item.icon}</ListItemIcon>
              {!collapsed && <ListItemText primary={item.label} slotProps={{ primary: { fontSize: 14.5, fontWeight: 600 } }} />}
            </ListItemButton>
          </Tooltip>
        ),
      )}
    </List>
  );
}

/**
 * Role layout shell: collapsible sidebar on desktop, drawer on mobile, topbar with notifications + user menu.
 * `notificationsPath` is the role's "view all" page.
 */
export function AppShell({ nav, roleLabel, notificationsPath, adminScope = false }) {
  const theme = useTheme();
  const desktop = useMediaQuery(theme.breakpoints.up('md'));
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [collapsed, setCollapsed] = useState(false);
  const [drawer, setDrawer] = useState(false);
  const [menu, setMenu] = useState(null);
  const [collegeId, setCollegeId] = useState('');

  const colleges = useGet('/admin/colleges', null, { enabled: adminScope });
  const scope = useMemo(() => ({ collegeId, scopeParams: collegeId ? { collegeId } : {} }), [collegeId]);

  const width = desktop ? (collapsed ? COLLAPSED : EXPANDED) : EXPANDED;
  const sidebar = (
    <Box sx={{ bgcolor: colors.midnight, height: '100%', color: '#fff', overflowY: 'auto' }}>
      <Brand collapsed={desktop && collapsed} />
      <Divider sx={{ borderColor: 'rgba(255,255,255,.08)' }} />
      <Box sx={{ py: 1.5 }}>
        <NavList nav={nav} collapsed={desktop && collapsed} onNavigate={() => setDrawer(false)} />
      </Box>
    </Box>
  );

  const initials = (user?.fullName ?? '?').split(/\s+/).map((p) => p[0]).slice(0, 2).join('').toUpperCase();

  return (
    <ScopeContext.Provider value={scope}>
      <a href="#main" className="skip-link">Skip to content</a>
      <Box sx={{ display: 'flex', minHeight: '100vh' }}>
        {desktop ? (
          <Drawer variant="permanent" sx={{ width, flexShrink: 0, '& .MuiDrawer-paper': { width, border: 0, transition: 'width 180ms' } }} open>
            {sidebar}
          </Drawer>
        ) : (
          <Drawer variant="temporary" open={drawer} onClose={() => setDrawer(false)} ModalProps={{ keepMounted: true }} sx={{ '& .MuiDrawer-paper': { width: EXPANDED, border: 0 } }}>
            {sidebar}
          </Drawer>
        )}

        <Box sx={{ flexGrow: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
          <AppBar position="sticky" color="inherit" elevation={0} sx={{ borderBottom: '1px solid var(--tb-border)', bgcolor: 'rgba(246,247,251,.9)', backdropFilter: 'blur(8px)', color: 'text.primary' }}>
            <Toolbar sx={{ gap: 1 }}>
              <IconButton
                edge="start"
                aria-label={desktop ? (collapsed ? 'Expand sidebar' : 'Collapse sidebar') : 'Open navigation'}
                onClick={() => (desktop ? setCollapsed((c) => !c) : setDrawer(true))}
              >
                {desktop && !collapsed ? <MenuOpenIcon /> : <MenuIcon />}
              </IconButton>
              <Typography variant="body2" color="text.secondary" sx={{ display: { xs: 'none', sm: 'block' } }}>
                {roleLabel}
                {user?.collegeName ? ` · ${user.collegeName}` : ''}
              </Typography>
              <Box sx={{ flexGrow: 1 }} />
              {adminScope && (
                <Select
                  size="small"
                  displayEmpty
                  value={collegeId}
                  onChange={(e) => setCollegeId(e.target.value)}
                  inputProps={{ 'aria-label': 'College scope' }}
                  sx={{ minWidth: { xs: 130, sm: 220 }, bgcolor: '#fff' }}
                >
                  <MenuItem value="">All colleges</MenuItem>
                  {(colleges.data ?? []).map((c) => (
                    <MenuItem key={c.id} value={c.id}>
                      {c.name}
                    </MenuItem>
                  ))}
                </Select>
              )}
              <NotificationBell allLink={notificationsPath} />
              <IconButton onClick={(e) => setMenu(e.currentTarget)} aria-label="Account menu" aria-haspopup="menu">
                <Avatar sx={{ width: 34, height: 34, bgcolor: colors.indigo, fontSize: 14 }}>{initials}</Avatar>
              </IconButton>
              <Menu anchorEl={menu} open={!!menu} onClose={() => setMenu(null)}>
                <Box sx={{ px: 2, py: 1 }}>
                  <Typography fontWeight={600}>{user?.fullName}</Typography>
                  <Typography variant="body2" color="text.secondary">
                    {user?.email}
                  </Typography>
                </Box>
                <Divider />
                <MenuItem
                  onClick={async () => {
                    setMenu(null);
                    await logout();
                    navigate('/login');
                  }}
                >
                  <ListItemIcon>
                    <LogoutIcon fontSize="small" />
                  </ListItemIcon>
                  Sign out
                </MenuItem>
              </Menu>
            </Toolbar>
          </AppBar>
          <Box component="main" id="main" tabIndex={-1} className="tb-fade-in" sx={{ p: { xs: 2, md: 4 }, flexGrow: 1, maxWidth: 1400, width: '100%', mx: 'auto' }}>
            <Outlet />
          </Box>
        </Box>
      </Box>
    </ScopeContext.Provider>
  );
}
