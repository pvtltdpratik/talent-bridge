import { createContext, useCallback, useContext, useMemo, useState } from 'react';
import { Alert, Snackbar } from '@mui/material';

const ToastContext = createContext({ success() {}, error() {}, info() {} });

export function ToastProvider({ children }) {
  const [toast, setToast] = useState(null);
  const show = useCallback((severity, message) => setToast({ severity, message, key: Date.now() }), []);
  const api = useMemo(
    () => ({ success: (m) => show('success', m), error: (m) => show('error', m), info: (m) => show('info', m) }),
    [show],
  );
  return (
    <ToastContext.Provider value={api}>
      {children}
      <Snackbar
        key={toast?.key}
        open={!!toast}
        autoHideDuration={5000}
        onClose={(_, reason) => reason !== 'clickaway' && setToast(null)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
      >
        {toast ? (
          <Alert severity={toast.severity} variant="filled" onClose={() => setToast(null)} sx={{ width: '100%' }} role="status">
            {toast.message}
          </Alert>
        ) : undefined}
      </Snackbar>
    </ToastContext.Provider>
  );
}

export const useToast = () => useContext(ToastContext);
