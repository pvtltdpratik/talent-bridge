import { createTheme } from '@mui/material/styles';
import { colors, fonts, radius } from './tokens.js';

export const theme = createTheme({
  palette: {
    mode: 'light',
    primary: { main: colors.indigo, dark: colors.indigoDark, contrastText: '#fff' },
    secondary: { main: colors.lilac, contrastText: colors.midnight },
    success: { main: colors.teal, dark: colors.successText, contrastText: colors.midnight },
    warning: { main: colors.amber, light: colors.amberTint, contrastText: '#fff' },
    error: { main: colors.red, light: colors.redTint, contrastText: '#fff' },
    background: { default: colors.canvas, paper: colors.white },
    text: { primary: colors.text, secondary: colors.textSecondary },
    divider: colors.border,
  },
  shape: { borderRadius: radius.control },
  typography: {
    fontFamily: fonts.body,
    h1: { fontFamily: fonts.heading, fontWeight: 700, letterSpacing: '-0.02em' },
    h2: { fontFamily: fonts.heading, fontWeight: 700, letterSpacing: '-0.02em' },
    h3: { fontFamily: fonts.heading, fontWeight: 700, letterSpacing: '-0.01em' },
    h4: { fontFamily: fonts.heading, fontWeight: 700, letterSpacing: '-0.01em' },
    h5: { fontFamily: fonts.heading, fontWeight: 600 },
    h6: { fontFamily: fonts.heading, fontWeight: 600 },
    button: { textTransform: 'none', fontWeight: 600 },
  },
  components: {
    MuiCssBaseline: { styleOverrides: { body: { backgroundColor: colors.canvas } } },
    MuiButton: {
      defaultProps: { disableElevation: true },
      styleOverrides: { root: { borderRadius: radius.control, paddingInline: 18, minHeight: 40 } },
    },
    MuiCard: {
      defaultProps: { elevation: 0 },
      styleOverrides: {
        root: {
          borderRadius: radius.card,
          border: `1px solid ${colors.border}`,
          boxShadow: '0 1px 2px rgba(16,20,38,0.04), 0 4px 14px rgba(16,20,38,0.04)',
        },
      },
    },
    MuiPaper: { styleOverrides: { rounded: { borderRadius: radius.card } } },
    MuiOutlinedInput: { styleOverrides: { root: { borderRadius: radius.control, backgroundColor: colors.white } } },
    MuiTextField: { defaultProps: { size: 'small', fullWidth: true } },
    MuiChip: { styleOverrides: { root: { fontWeight: 600 } } },
    MuiTableCell: {
      styleOverrides: {
        head: { fontWeight: 600, color: colors.textSecondary, backgroundColor: colors.grey100, whiteSpace: 'nowrap' },
      },
    },
    MuiTooltip: { defaultProps: { arrow: true } },
    MuiLink: { styleOverrides: { root: { fontWeight: 500 } } },
  },
});
