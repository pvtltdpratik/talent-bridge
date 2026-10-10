import { useState } from 'react';
import { Box, Button, Typography } from '@mui/material';
import { Stack } from '../../components/layout.jsx';
import DownloadIcon from '@mui/icons-material/Download';
import { Link as RouterLink, useNavigate, useParams } from 'react-router-dom';
import { api } from '../../api/client.js';
import { useGet } from '../../api/hooks.js';
import { DriveStatusBadge, Pill } from '../../components/badges.jsx';
import { PageHeader, StatCard, SurfaceCard } from '../../components/cards.jsx';
import { DataTable } from '../../components/DataTable.jsx';
import { ErrorState, LoadingState } from '../../components/feedback.jsx';
import { useToast } from '../../components/Toast.jsx';
import { fmtDate } from '../../lib/format.js';
import { CompanyDialog } from './Companies.jsx';

/** "Company workspace": the recruiter view, operated by placement staff on the company's behalf. */
export default function PlacementCompanyWorkspace() {
  const { id } = useParams();
  const navigate = useNavigate();
  const toast = useToast();
  const [edit, setEdit] = useState(false);
  const q = useGet(`/companies/${id}`);

  if (q.isLoading) return <LoadingState lines={6} />;
  if (q.isError) return <ErrorState error={q.error} onRetry={q.refetch} />;
  const { company: c, drives, hiring } = q.data;

  const exportCsv = async () => {
    try {
      await api.download(`/companies/${id}/report.csv`, null, `company-${c.name.replace(/\W+/g, '-').toLowerCase()}.csv`);
    } catch (e) {
      toast.error(e.message);
    }
  };

  return (
    <>
      <PageHeader
        back="/placement/companies" title={c.name} subtitle={[c.industry, c.website].filter(Boolean).join(' · ') || 'Company workspace'}
        actions={
          <>
            <Pill tone={c.status === 'active' ? 'success' : 'neutral'}>{c.status}</Pill>
            <Button startIcon={<DownloadIcon />} onClick={exportCsv}>Hiring report (CSV)</Button>
            <Button onClick={() => setEdit(true)}>Edit</Button>
            <Button variant="contained" component={RouterLink} to={`/placement/drives/new?companyId=${id}`}>Create drive</Button>
          </>
        }
      />
      <div className="row g-3 mb-3">
        <div className="col-6 col-lg-3"><StatCard label="Applicants" value={hiring.applicants} /></div>
        <div className="col-6 col-lg-3"><StatCard label="Shortlisted / interviewing" value={hiring.shortlisted} tone="lilac" /></div>
        <div className="col-6 col-lg-3"><StatCard label="Selected" value={hiring.selected} tone="teal" /></div>
        <div className="col-6 col-lg-3"><StatCard label="Not selected" value={hiring.rejected} tone="amber" /></div>
      </div>
      <div className="row g-3">
        <div className="col-12 col-lg-4">
          <SurfaceCard title="Contact">
            <Stack spacing={1}>
              <Box><Typography variant="caption" color="text.secondary">Person</Typography><Typography>{c.contactPerson || '—'}</Typography></Box>
              <Box><Typography variant="caption" color="text.secondary">Email</Typography><Typography>{c.contactEmail || '—'}</Typography></Box>
              <Box><Typography variant="caption" color="text.secondary">Phone</Typography><Typography>{c.contactPhone || '—'}</Typography></Box>
              {c.notes && <Box><Typography variant="caption" color="text.secondary">Notes</Typography><Typography sx={{ whiteSpace: 'pre-wrap' }}>{c.notes}</Typography></Box>}
            </Stack>
          </SurfaceCard>
        </div>
        <div className="col-12 col-lg-8">
          <SurfaceCard title="Drives for this company">
            <DataTable
              dense caption="Company drives" rows={drives} onRowClick={(r) => navigate(`/placement/drives/${r.id}`)}
              emptyTitle="No drives yet" emptyDescription="Create a drive to start collecting applications for this company."
              columns={[
                { key: 'title', label: 'Drive', render: (r) => <strong>{r.title}</strong> },
                { key: 'status', label: 'Status', render: (r) => <DriveStatusBadge value={r.status} /> },
                { key: 'deadline', label: 'Deadline', render: (r) => fmtDate(r.deadline) },
                { key: 'applicationCount', label: 'Applicants', align: 'right' },
              ]}
            />
          </SurfaceCard>
        </div>
      </div>
      <CompanyDialog open={edit} onClose={() => setEdit(false)} company={c} />
    </>
  );
}
