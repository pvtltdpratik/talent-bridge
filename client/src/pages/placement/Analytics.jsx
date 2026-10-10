import { Alert, Box, Typography } from '@mui/material';
import { Stack } from '../../components/layout.jsx';
import { api } from '../../api/client.js';
import { useGet, useSend } from '../../api/hooks.js';
import { AiNotice } from '../../components/AiPanel.jsx';
import { AiBadge, RuleBadge } from '../../components/badges.jsx';
import { PageHeader, SurfaceCard } from '../../components/cards.jsx';
import { CHART_COLORS, SimpleBarChart } from '../../components/charts.jsx';
import { DataTable } from '../../components/DataTable.jsx';
import { ErrorState, LoadingState } from '../../components/feedback.jsx';
import { useScope } from '../../layouts/AppShell.jsx';

const CRITERION_LABEL = { cgpa: 'CGPA', backlogs: 'Backlogs', department: 'Department', batch: 'Batch', tenth: '10th %', twelfth: '12th %' };

export default function PlacementAnalytics() {
  const { scopeParams } = useScope();
  const overview = useGet('/analytics/overview', scopeParams);
  const gaps = useGet('/analytics/skill-gaps', scopeParams);
  const dropoff = useGet('/analytics/eligibility-dropoff', scopeParams);
  const exceptions = useGet('/analytics/exceptions', scopeParams);
  const insights = useGet('/ai/insights', scopeParams);
  const run = useSend((force) => api.post('/ai/insights', { ...scopeParams, force }), { invalidate: ['/ai/insights'] });
  const ins = run.data ?? insights.data;

  if (overview.isLoading) return <LoadingState lines={8} />;
  if (overview.isError) return <ErrorState error={overview.error} onRetry={overview.refetch} />;
  const o = overview.data;

  const dropData = dropoff.data
    ? Object.entries(dropoff.data.failedByCriterion).map(([k, n]) => ({ criterion: CRITERION_LABEL[k] ?? k, students: n }))
    : [];
  const excData = exceptions.data ? Object.entries(exceptions.data.byCriterion).map(([k, n]) => ({ criterion: CRITERION_LABEL[k] ?? k, requests: n })) : [];

  return (
    <>
      <PageHeader title="Analytics & insights" subtitle="Every number is computed from your own records. Nothing is estimated." actions={<RuleBadge label="Real data only" />} />
      {!o.hasData && <Alert severity="info" sx={{ mb: 3 }}>There is no student or application data yet, so the charts below are empty.</Alert>}

      <div className="row g-3">
        <div className="col-12">
          <SurfaceCard title="AI insights" subtitle="The model writes the narrative. The figures come from SQL." ai action={<AiBadge />}>
            <Stack spacing={2}>
              {ins?.insufficientData ? (
                <Alert severity="info">{ins.message}</Alert>
              ) : (
                <AiNotice ai={ins?.ai} onRun={() => run.mutate(ins?.ai?.status === 'ok')} running={run.isPending} runLabel="Generate insights" />
              )}
              {run.isError && <ErrorState error={run.error} />}
              {ins?.narrative && (
                <>
                  <Typography variant="h6" component="p">{ins.narrative.headline}</Typography>
                  <Stack spacing={1.5}>
                    {ins.narrative.observations.map((ob, i) => (
                      <Box key={i} sx={{ bgcolor: '#fff', border: '1px solid #ddd2fb', borderRadius: 3, p: 1.5 }}>
                        <Typography fontWeight={600}>{ob.title}</Typography>
                        <Typography variant="body2">{ob.detail}</Typography>
                        {ob.metricRefs.length > 0 && (
                          <Typography variant="caption" color="text.secondary">
                            Based on: {ob.metricRefs.map((k) => `${k.replace(/_/g, ' ')} = ${ins.facts[k]}`).join(' · ')}
                          </Typography>
                        )}
                      </Box>
                    ))}
                  </Stack>
                  {ins.narrative.recommendations.length > 0 && (
                    <Box>
                      <Typography fontWeight={600}>Suggested actions</Typography>
                      <Stack component="ul" sx={{ m: 0, pl: 2.5 }}>{ins.narrative.recommendations.map((r) => <li key={r}><Typography variant="body2">{r}</Typography></li>)}</Stack>
                    </Box>
                  )}
                </>
              )}
            </Stack>
          </SurfaceCard>
        </div>

        <div className="col-12 col-xl-6">
          <SurfaceCard title="Department-wise participation" action={<RuleBadge />}>
            <SimpleBarChart
              data={o.departments} xKey="department" label="Participation by department"
              series={[{ key: 'students', label: 'Students', color: CHART_COLORS.indigo }, { key: 'applicants', label: 'Applied', color: CHART_COLORS.lilac }, { key: 'selected', label: 'Selected', color: CHART_COLORS.teal }]}
            />
          </SurfaceCard>
        </div>
        <div className="col-12 col-xl-6">
          <SurfaceCard title="Why students drop out of eligibility" subtitle="Failures per criterion across open drives (a student can fail several)." action={<RuleBadge />}>
            {dropoff.isLoading ? <LoadingState lines={3} /> : (
              <SimpleBarChart data={dropData} xKey="criterion" label="Eligibility failures by criterion" series={[{ key: 'students', label: 'Failures', color: CHART_COLORS.amber }]} emptyText="No open drives or no failures to show." />
            )}
          </SurfaceCard>
        </div>

        <div className="col-12 col-xl-7">
          <SurfaceCard title="Most common missing skills" subtitle={gaps.data?.note} action={<RuleBadge />}>
            {gaps.isLoading ? <LoadingState lines={3} /> : (
              <DataTable
                dense caption="Missing skills" rows={gaps.data?.skills ?? []} getRowId={(r) => r.skill} emptyTitle="No skill data"
                emptyDescription="Skill gaps appear once open drives list required skills and students add theirs."
                columns={[
                  { key: 'skill', label: 'Skill (must-have)', render: (r) => <strong>{r.skill}</strong> },
                  { key: 'drives', label: 'Open drives', align: 'right' },
                  { key: 'studentsMissing', label: 'Students missing', align: 'right', sortable: true },
                  { key: 'percentMissing', label: '% of students', align: 'right', render: (r) => `${r.percentMissing}%` },
                ]}
              />
            )}
          </SurfaceCard>
        </div>
        <div className="col-12 col-xl-5">
          <SurfaceCard title="Exception request trends" action={<RuleBadge />}>
            {exceptions.data && (
              <Stack spacing={2}>
                <Typography variant="body2">
                  Pending {exceptions.data.byStatus.pending ?? 0} · Approved {exceptions.data.byStatus.approved ?? 0} · Rejected {exceptions.data.byStatus.rejected ?? 0}
                </Typography>
                <SimpleBarChart data={excData} xKey="criterion" label="Exception requests by failed criterion" height={200} series={[{ key: 'requests', label: 'Requests', color: CHART_COLORS.lilac }]} emptyText="No exception requests yet." />
              </Stack>
            )}
          </SurfaceCard>
        </div>
      </div>
    </>
  );
}
