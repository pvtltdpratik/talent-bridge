import { Box, Card, CardContent, IconButton, Typography } from '@mui/material';
import { Stack } from './layout.jsx';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import { useNavigate } from 'react-router-dom';
import { colors } from '../theme/tokens.js';

export function PageHeader({ title, subtitle, actions, back }) {
  const navigate = useNavigate();
  return (
    <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} justifyContent="space-between" alignItems={{ sm: 'center' }} sx={{ mb: 3 }}>
      <Stack direction="row" spacing={1} alignItems="center" sx={{ minWidth: 0 }}>
        {back && (
          <IconButton aria-label="Go back" onClick={() => navigate(typeof back === 'string' ? back : -1)}>
            <ArrowBackIcon />
          </IconButton>
        )}
        <Box sx={{ minWidth: 0 }}>
          <Typography variant="h4" component="h1" sx={{ fontSize: { xs: 24, md: 30 }, overflowWrap: 'anywhere' }}>
            {title}
          </Typography>
          {subtitle && <Typography color="text.secondary">{subtitle}</Typography>}
        </Box>
      </Stack>
      {actions && <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>{actions}</Stack>}
    </Stack>
  );
}

/** Standard card. `ai` gives it the lilac AI treatment. */
export function SurfaceCard({ title, subtitle, action, children, ai = false, sx, contentSx }) {
  return (
    <Card className={ai ? 'tb-ai' : undefined} sx={sx}>
      <CardContent sx={{ p: { xs: 2, md: 3 }, '&:last-child': { pb: { xs: 2, md: 3 } }, ...contentSx }}>
        {(title || action) && (
          <Stack direction="row" justifyContent="space-between" alignItems="flex-start" spacing={1} sx={{ mb: 2 }}>
            <Box sx={{ minWidth: 0 }}>
              {title && (
                <Typography variant="h6" component="h2">
                  {title}
                </Typography>
              )}
              {subtitle && (
                <Typography variant="body2" color="text.secondary">
                  {subtitle}
                </Typography>
              )}
            </Box>
            {action && <Box sx={{ flexShrink: 0 }}>{action}</Box>}
          </Stack>
        )}
        {children}
      </CardContent>
    </Card>
  );
}

export function StatCard({ label, value, hint, icon, tone = 'indigo' }) {
  const palette = {
    indigo: [colors.indigoTint, colors.indigoDark],
    teal: [colors.tealTint, colors.successText],
    lilac: [colors.lilacTint, colors.aiText],
    amber: [colors.amberTint, colors.amberText],
    red: [colors.redTint, colors.red],
  }[tone];
  return (
    <Card sx={{ height: '100%' }}>
      <CardContent sx={{ p: 2.5, '&:last-child': { pb: 2.5 } }}>
        {/* vertical layout: the label always gets the full card width, so it never truncates */}
        <Stack spacing={1.25}>
          <Stack direction="row" alignItems="center" justifyContent="space-between" spacing={1}>
            {icon && (
              <Box sx={{ width: 40, height: 40, borderRadius: 3, bgcolor: palette[0], color: palette[1], display: 'grid', placeItems: 'center', flexShrink: 0 }} aria-hidden="true">
                {icon}
              </Box>
            )}
            <Typography variant="h4" component="p" sx={{ lineHeight: 1.1, ml: 'auto' }}>
              {value ?? '—'}
            </Typography>
          </Stack>
          <Box>
            <Typography variant="body2" color="text.secondary" sx={{ overflowWrap: 'anywhere' }}>
              {label}
            </Typography>
            {hint && (
              <Typography variant="caption" color="text.secondary">
                {hint}
              </Typography>
            )}
          </Box>
        </Stack>
      </CardContent>
    </Card>
  );
}
