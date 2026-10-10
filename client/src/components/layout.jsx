import { forwardRef } from 'react';
import { Stack as MuiStack } from '@mui/material';

/**
 * MUI v9 no longer accepts `alignItems`, `justifyContent` or `flexWrap` as Stack props (they were system
 * props). This thin wrapper keeps the ergonomic API and forwards them through `sx` so they actually apply.
 */
export const Stack = forwardRef(function Stack({ alignItems, justifyContent, flexWrap, sx, ...rest }, ref) {
  const own = {};
  if (alignItems !== undefined) own.alignItems = alignItems;
  if (justifyContent !== undefined) own.justifyContent = justifyContent;
  if (flexWrap !== undefined) own.flexWrap = flexWrap;
  return <MuiStack ref={ref} sx={[own, ...(Array.isArray(sx) ? sx : [sx])]} {...rest} />;
});
