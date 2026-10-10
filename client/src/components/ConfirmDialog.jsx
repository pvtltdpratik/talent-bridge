import { useState } from 'react';
import { Button, Dialog, DialogActions, DialogContent, DialogContentText, DialogTitle, TextField } from '@mui/material';

function Body({
  title, message, confirmLabel, cancelLabel, danger, loading, onConfirm, onClose, inputLabel, inputRequired,
  inputMultiline, minLength, maxLength, children,
}) {
  // mounted only while the dialog is open, so the field always starts empty
  const [value, setValue] = useState('');
  const trimmed = value.trim();
  const invalid = inputLabel && ((inputRequired && !trimmed) || (trimmed && trimmed.length < minLength));

  return (
    <>
      <DialogTitle id="confirm-title">{title}</DialogTitle>
      <DialogContent>
        {message && <DialogContentText sx={{ mb: inputLabel || children ? 2 : 0 }}>{message}</DialogContentText>}
        {children}
        {inputLabel && (
          <TextField
            autoFocus
            label={inputLabel}
            value={value}
            onChange={(e) => setValue(e.target.value.slice(0, maxLength))}
            multiline={inputMultiline}
            minRows={inputMultiline ? 3 : undefined}
            required={inputRequired}
            helperText={`${trimmed.length}/${maxLength}${minLength ? ` · at least ${minLength} characters` : ''}`}
            sx={{ mt: 1 }}
          />
        )}
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2 }}>
        <Button onClick={onClose} disabled={loading} color="inherit">
          {cancelLabel}
        </Button>
        <Button variant="contained" color={danger ? 'error' : 'primary'} disabled={loading || !!invalid} onClick={() => onConfirm(trimmed)}>
          {loading ? 'Please wait…' : confirmLabel}
        </Button>
      </DialogActions>
    </>
  );
}

/** Confirmation, optionally collecting a (required) reason or note. */
export function ConfirmDialog({
  open, title, message, confirmLabel = 'Confirm', cancelLabel = 'Cancel', danger = false, loading = false,
  onConfirm, onClose, inputLabel, inputRequired = false, inputMultiline = true, minLength = 0, maxLength = 1000, children,
}) {
  return (
    <Dialog open={open} onClose={loading ? undefined : onClose} fullWidth maxWidth="sm" aria-labelledby="confirm-title">
      {open && (
        <Body
          {...{ title, message, confirmLabel, cancelLabel, danger, loading, onConfirm, onClose, inputLabel, inputRequired, inputMultiline, minLength, maxLength }}
        >
          {children}
        </Body>
      )}
    </Dialog>
  );
}
