import DashboardIcon from '@mui/icons-material/SpaceDashboardOutlined';
import PersonIcon from '@mui/icons-material/PersonOutlined';
import DescriptionIcon from '@mui/icons-material/DescriptionOutlined';
import WorkIcon from '@mui/icons-material/WorkOutlined';
import SendIcon from '@mui/icons-material/SendOutlined';
import EventIcon from '@mui/icons-material/EventOutlined';
import MapIcon from '@mui/icons-material/RouteOutlined';
import NotificationsIcon from '@mui/icons-material/NotificationsNone';
import SchoolIcon from '@mui/icons-material/SchoolOutlined';
import BusinessIcon from '@mui/icons-material/BusinessOutlined';
import RuleIcon from '@mui/icons-material/GavelOutlined';
import InsightsIcon from '@mui/icons-material/InsightsOutlined';
import PeopleIcon from '@mui/icons-material/PeopleOutlined';
import HowToRegIcon from '@mui/icons-material/HowToRegOutlined';
import AccountBalanceIcon from '@mui/icons-material/AccountBalanceOutlined';
import HistoryIcon from '@mui/icons-material/HistoryOutlined';
import SettingsIcon from '@mui/icons-material/SettingsOutlined';
import AdminIcon from '@mui/icons-material/AdminPanelSettingsOutlined';

export const studentNav = [
  { to: '/student', label: 'Dashboard', icon: <DashboardIcon />, end: true },
  { to: '/student/profile', label: 'My profile', icon: <PersonIcon /> },
  { to: '/student/resume', label: 'Resume & AI review', icon: <DescriptionIcon /> },
  { to: '/student/drives', label: 'Drives', icon: <WorkIcon /> },
  { to: '/student/applications', label: 'Applications', icon: <SendIcon /> },
  { to: '/student/interviews', label: 'Interviews', icon: <EventIcon /> },
  { to: '/student/roadmap', label: 'Career roadmap', icon: <MapIcon /> },
  { to: '/student/notifications', label: 'Notifications', icon: <NotificationsIcon /> },
  { to: '/student/settings', label: 'Privacy & account', icon: <SettingsIcon /> },
];

const placementItems = [
  { to: '/placement/students', label: 'Students', icon: <SchoolIcon /> },
  { to: '/placement/companies', label: 'Companies', icon: <BusinessIcon /> },
  { to: '/placement/drives', label: 'Drives', icon: <WorkIcon /> },
  { to: '/placement/applications', label: 'Applications', icon: <SendIcon /> },
  { to: '/placement/exceptions', label: 'Exception requests', icon: <RuleIcon /> },
  { to: '/placement/interviews', label: 'Interviews', icon: <EventIcon /> },
  { to: '/placement/analytics', label: 'Analytics & insights', icon: <InsightsIcon /> },
];

export const placementNav = [
  { to: '/placement', label: 'Dashboard', icon: <DashboardIcon />, end: true },
  ...placementItems,
  { to: '/placement/notifications', label: 'Notifications', icon: <NotificationsIcon /> },
];

export const placementNavForAdmin = [
  { to: '/admin', label: 'Back to admin', icon: <AdminIcon />, end: true },
  { heading: 'Placement area' },
  { to: '/placement', label: 'Dashboard', icon: <DashboardIcon />, end: true },
  ...placementItems,
];

export const adminNav = [
  { to: '/admin', label: 'Dashboard', icon: <DashboardIcon />, end: true },
  { to: '/admin/users', label: 'Users & roles', icon: <PeopleIcon /> },
  { to: '/admin/approvals', label: 'Approvals & invites', icon: <HowToRegIcon /> },
  { to: '/admin/colleges', label: 'Colleges', icon: <AccountBalanceIcon /> },
  { to: '/admin/audit', label: 'Audit log', icon: <HistoryIcon /> },
  { to: '/admin/settings', label: 'System settings', icon: <SettingsIcon /> },
  { heading: 'Placement area' },
  { to: '/placement', label: 'Placement dashboard', icon: <DashboardIcon />, end: true },
  ...placementItems.slice(0, 4),
  { to: '/placement/exceptions', label: 'Exception requests', icon: <RuleIcon /> },
  { to: '/placement/analytics', label: 'Analytics & insights', icon: <InsightsIcon /> },
];
