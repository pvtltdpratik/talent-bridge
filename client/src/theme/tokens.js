// Single source of truth for the visual language. Mirrored as CSS variables in global.css and in the MUI theme.
//
// Contrast notes (WCAG 2.1, computed against the backgrounds they are used on):
//  - white on Indigo #635BFF = 4.7:1  (AA for normal text)
//  - Lilac #A78BFA and Teal #22C7A9 are too light for white text (2.7:1 / 2.1:1), so filled lilac/teal
//    surfaces carry Midnight text (>= 6.7:1) and text-on-white uses the darker `aiText` / `successText`.
export const colors = {
  midnight: '#101426',
  midnight2: '#1A2038', // raised dark surface
  indigo: '#635BFF',
  indigoDark: '#4F46E5',
  indigoTint: '#ECEBFF',
  lilac: '#A78BFA',
  lilacTint: '#F1ECFF',
  aiText: '#5B34C9',
  teal: '#22C7A9',
  tealTint: '#E0F7F2',
  successText: '#0B7A66',
  canvas: '#F6F7FB',
  white: '#FFFFFF',
  border: '#E3E6EF',
  text: '#101426',
  textSecondary: '#4B5168',
  textMuted: '#6B7186',
  amber: '#B45309',
  amberTint: '#FEF3C7',
  amberText: '#92400E',
  red: '#B42318',
  redTint: '#FEE4E2',
  grey100: '#EEF0F6',
  grey300: '#C9CEDC',
};

export const radius = { card: 16, control: 12, chip: 999 };
export const fonts = {
  heading: '"Space Grotesk", "Inter", system-ui, sans-serif',
  body: '"Inter", system-ui, -apple-system, "Segoe UI", sans-serif',
};
