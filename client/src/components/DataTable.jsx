import { useMemo, useState } from 'react';
import {
  Box, Skeleton, Table, TableBody, TableCell, TableContainer, TableHead, TablePagination, TableRow, TableSortLabel,
} from '@mui/material';
import { EmptyState } from './feedback.jsx';

/**
 * Responsive, accessible table.
 * columns: [{ key, label, render?(row), sortable?, align?, width?, value?(row) }]
 * Pagination is server-driven when `total` + `onPageChange` are passed; sorting applies to the visible page.
 */
export function DataTable({
  columns, rows = [], loading = false, getRowId = (r) => r.id, onRowClick,
  page = 1, pageSize = 20, total, onPageChange, onPageSizeChange,
  emptyTitle = 'No records found', emptyDescription, emptyAction, dense = false, caption,
}) {
  const [sort, setSort] = useState({ key: null, dir: 'asc' });

  const sorted = useMemo(() => {
    if (!sort.key) return rows;
    const col = columns.find((c) => c.key === sort.key);
    const get = col?.value ?? ((r) => r[sort.key]);
    const dir = sort.dir === 'asc' ? 1 : -1;
    return [...rows].sort((a, b) => {
      const x = get(a);
      const y = get(b);
      if (x == null && y == null) return 0;
      if (x == null) return 1;
      if (y == null) return -1;
      return (typeof x === 'number' && typeof y === 'number' ? x - y : String(x).localeCompare(String(y), 'en-IN', { numeric: true })) * dir;
    });
  }, [rows, sort, columns]);

  const toggle = (key) => setSort((s) => (s.key === key ? { key, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: 'asc' }));

  return (
    <Box>
      <TableContainer sx={{ border: '1px solid var(--tb-border)', borderRadius: 3, bgcolor: 'background.paper' }}>
        <Table size={dense ? 'small' : 'medium'} aria-label={caption}>
          <TableHead>
            <TableRow>
              {columns.map((c) => (
                <TableCell
                  key={c.key}
                  align={c.align}
                  sx={{ width: c.width }}
                  sortDirection={sort.key === c.key ? sort.dir : false}
                >
                  {c.sortable ? (
                    <TableSortLabel active={sort.key === c.key} direction={sort.key === c.key ? sort.dir : 'asc'} onClick={() => toggle(c.key)}>
                      {c.label}
                    </TableSortLabel>
                  ) : (
                    c.label
                  )}
                </TableCell>
              ))}
            </TableRow>
          </TableHead>
          <TableBody>
            {loading &&
              Array.from({ length: 5 }, (_, i) => (
                <TableRow key={`s${i}`}>
                  {columns.map((c) => (
                    <TableCell key={c.key}>
                      <Skeleton />
                    </TableCell>
                  ))}
                </TableRow>
              ))}
            {!loading &&
              sorted.map((row) => (
                <TableRow
                  key={getRowId(row)}
                  hover={!!onRowClick}
                  tabIndex={onRowClick ? 0 : undefined}
                  onClick={onRowClick ? () => onRowClick(row) : undefined}
                  onKeyDown={onRowClick ? (e) => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), onRowClick(row)) : undefined}
                  sx={{ cursor: onRowClick ? 'pointer' : 'default', '&:last-child td': { borderBottom: 0 } }}
                >
                  {columns.map((c) => (
                    <TableCell key={c.key} align={c.align}>
                      {c.render ? c.render(row) : row[c.key] ?? '—'}
                    </TableCell>
                  ))}
                </TableRow>
              ))}
          </TableBody>
        </Table>
        {!loading && rows.length === 0 && (
          <EmptyState title={emptyTitle} description={emptyDescription} action={emptyAction} />
        )}
      </TableContainer>
      {total != null && onPageChange && total > 0 && (
        <TablePagination
          component="div"
          count={total}
          page={page - 1}
          rowsPerPage={pageSize}
          rowsPerPageOptions={[10, 20, 50]}
          onPageChange={(_, p) => onPageChange(p + 1)}
          onRowsPerPageChange={(e) => onPageSizeChange?.(Number(e.target.value))}
          labelRowsPerPage="Rows"
        />
      )}
    </Box>
  );
}
