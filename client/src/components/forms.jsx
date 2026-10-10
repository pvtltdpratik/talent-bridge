import { Autocomplete, Checkbox, Chip, FormControlLabel, FormHelperText, MenuItem, TextField } from '@mui/material';
import { Controller } from 'react-hook-form';

/** react-hook-form bound inputs with consistent labels, helper text and error wiring. */
export function TextInput({ control, name, label, helper, type = 'text', multiline, rows, required, ...rest }) {
  return (
    <Controller
      control={control}
      name={name}
      render={({ field, fieldState }) => (
        <TextField
          {...field}
          value={field.value ?? ''}
          label={label}
          type={type}
          multiline={multiline}
          minRows={rows}
          required={required}
          error={!!fieldState.error}
          helperText={fieldState.error?.message ?? helper}
          slotProps={{ inputLabel: type === 'date' || type === 'datetime-local' ? { shrink: true } : undefined }}
          {...rest}
        />
      )}
    />
  );
}

export function SelectInput({ control, name, label, options, helper, required, ...rest }) {
  return (
    <Controller
      control={control}
      name={name}
      render={({ field, fieldState }) => (
        <TextField
          {...field}
          value={field.value ?? ''}
          select
          label={label}
          required={required}
          error={!!fieldState.error}
          helperText={fieldState.error?.message ?? helper}
          {...rest}
        >
          {options.map((o) => (
            <MenuItem key={o.value} value={o.value}>
              {o.label}
            </MenuItem>
          ))}
        </TextField>
      )}
    />
  );
}

export function CheckboxInput({ control, name, label, error }) {
  return (
    <Controller
      control={control}
      name={name}
      render={({ field, fieldState }) => (
        <div>
          <FormControlLabel control={<Checkbox checked={!!field.value} onChange={(e) => field.onChange(e.target.checked)} />} label={label} />
          {(fieldState.error?.message || error) && <FormHelperText error>{fieldState.error?.message ?? error}</FormHelperText>}
        </div>
      )}
    />
  );
}

/** Free-text tags (skills, departments, batches...). */
export function TagInput({ control, name, label, helper, options = [], numeric = false }) {
  return (
    <Controller
      control={control}
      name={name}
      render={({ field, fieldState }) => (
        <Autocomplete
          multiple
          freeSolo
          options={options}
          value={field.value ?? []}
          onChange={(_, v) => field.onChange(numeric ? v.map((x) => Number(x)).filter((x) => Number.isFinite(x)) : v.map((x) => String(x).trim()).filter(Boolean))}
          renderTags={(value, getTagProps) =>
            value.map((option, index) => {
              const { key, ...props } = getTagProps({ index });
              return <Chip key={key} size="small" label={option} {...props} />;
            })
          }
          renderInput={(params) => (
            <TextField {...params} label={label} error={!!fieldState.error} helperText={fieldState.error?.message ?? helper ?? 'Type and press Enter to add'} />
          )}
        />
      )}
    />
  );
}

/** '' -> undefined / number conversion helpers used when building API payloads from form values. */
export const num = (v) => (v === '' || v === null || v === undefined ? undefined : Number(v));
export const numOrNull = (v) => (v === '' || v === null || v === undefined ? null : Number(v));
export const str = (v) => (v === '' || v === null || v === undefined ? undefined : String(v).trim());
