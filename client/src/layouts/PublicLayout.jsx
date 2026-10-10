import { Box, Typography } from '@mui/material';
import { Stack } from '../components/layout.jsx';
import AutoAwesomeIcon from '@mui/icons-material/AutoAwesome';
import RuleIcon from '@mui/icons-material/Rule';
import InsightsIcon from '@mui/icons-material/Insights';
import { Link as RouterLink, Outlet } from 'react-router-dom';
import { colors } from '../theme/tokens.js';

const POINTS = [
  { icon: <AutoAwesomeIcon />, title: 'Explainable AI scoring', text: 'See exactly why a resume or match scored the way it did.' },
  { icon: <RuleIcon />, title: 'Rules decide eligibility', text: 'Deterministic checks with a reason for every criterion.' },
  { icon: <InsightsIcon />, title: 'Real placement analytics', text: 'Live numbers from your own drives, never made-up statistics.' },
];

/** Split layout for sign-in / registration screens. */
export function PublicLayout() {
  return (
    <Box sx={{ minHeight: '100vh', display: 'grid', gridTemplateColumns: { xs: '1fr', md: '5fr 6fr' } }}>
      <Box
        sx={{
          display: { xs: 'none', md: 'flex' }, flexDirection: 'column', justifyContent: 'space-between', p: 6, color: '#fff',
          background: `radial-gradient(1200px 500px at 0% 0%, ${colors.indigo}55, transparent 60%), radial-gradient(900px 500px at 100% 100%, ${colors.lilac}33, transparent 60%), ${colors.midnight}`,
        }}
      >
        <Stack direction="row" spacing={1.5} alignItems="center" component={RouterLink} to="/login" sx={{ color: 'inherit', textDecoration: 'none' }}>
          <Box component="img" src="/favicon.svg" alt="" sx={{ width: 40, height: 40 }} />
          <Typography variant="h5" component="span">TalentBridge <span style={{ color: colors.lilac }}>AI</span></Typography>
        </Stack>
        <Box>
          <Typography variant="h3" component="p" sx={{ mb: 2, maxWidth: 520 }}>
            From profile to placement, with feedback at every step.
          </Typography>
          <Typography sx={{ color: 'rgba(255,255,255,.8)', maxWidth: 480, mb: 4 }}>
            One platform for students, placement cells and recruiters: resume review, readiness scoring, skill-gap
            guidance and transparent shortlists.
          </Typography>
          <Stack spacing={2.5}>
            {POINTS.map((p) => (
              <Stack key={p.title} direction="row" spacing={2}>
                <Box sx={{ width: 40, height: 40, borderRadius: 3, bgcolor: 'rgba(255,255,255,.08)', display: 'grid', placeItems: 'center', color: colors.lilac, flexShrink: 0 }} aria-hidden="true">
                  {p.icon}
                </Box>
                <Box>
                  <Typography fontWeight={600}>{p.title}</Typography>
                  <Typography variant="body2" sx={{ color: 'rgba(255,255,255,.75)' }}>{p.text}</Typography>
                </Box>
              </Stack>
            ))}
          </Stack>
        </Box>
        <Typography variant="caption" sx={{ color: 'rgba(255,255,255,.6)' }}>
          AI supports decisions; people make them.
        </Typography>
      </Box>
      <Box component="main" sx={{ display: 'grid', placeItems: 'center', p: { xs: 2.5, md: 6 } }}>
        <Box sx={{ width: '100%', maxWidth: 480 }}>
          <Stack direction="row" spacing={1.25} alignItems="center" sx={{ display: { xs: 'flex', md: 'none' }, mb: 3 }}>
            <Box component="img" src="/favicon.svg" alt="" sx={{ width: 34, height: 34 }} />
            <Typography variant="h6" component="span">TalentBridge AI</Typography>
          </Stack>
          <Outlet />
        </Box>
      </Box>
    </Box>
  );
}
