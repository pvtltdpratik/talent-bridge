import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { AiBadge, ApplicationStatusBadge, EligibilityBadge, RuleBadge } from '../components/badges.jsx';
import { ScoreBreakdown, ScoreRing } from '../components/score.jsx';
import { fmtDate, fmtINR, relativeDeadline } from '../lib/format.js';

const result = {
  total: 71.5,
  note: 'Based on 4 of 6 components (missing data was excluded and weights re-normalised)',
  components: [
    { key: 'academics', label: 'Academics', source: 'rule', available: true, score: 80, weight: 25, effectiveWeight: 33.3, evidence: ['CGPA 8/10'], reason: 'Weighted CGPA.' },
    { key: 'resume', label: 'Resume quality', source: 'ai', available: false, score: null, weight: 15, effectiveWeight: 0, evidence: [], reason: 'AI resume analysis has not been run yet.' },
  ],
};

describe('ScoreBreakdown', () => {
  it('explains the total, each component, its weight, evidence and reason', () => {
    render(<ScoreBreakdown result={result} />);
    expect(screen.getByText(/Based on 4 of 6 components/)).toBeInTheDocument();
    expect(screen.getByText('Academics')).toBeInTheDocument();
    expect(screen.getByText(/80\/100 · weight 25 \(counts as 33.3%\)/)).toBeInTheDocument();
    expect(screen.getByText(/Evidence: CGPA 8\/10/)).toBeInTheDocument();
  });

  it('marks unavailable components as not counted and says why, and labels rule vs AI', () => {
    render(<ScoreBreakdown result={result} />);
    expect(screen.getByText('Not counted')).toBeInTheDocument();
    expect(screen.getByText('AI resume analysis has not been run yet.')).toBeInTheDocument();
    expect(screen.getByText('Rule-based')).toBeInTheDocument();
    expect(screen.getByText('AI')).toBeInTheDocument();
  });
});

describe('ScoreRing', () => {
  it('exposes the score as text for assistive technology', () => {
    render(<ScoreRing value={72.4} label="Readiness" />);
    expect(screen.getByRole('img', { name: 'Readiness: 72 out of 100' })).toBeInTheDocument();
  });
  it('says so when there is no score yet instead of showing 0', () => {
    render(<ScoreRing value={null} label="Readiness" />);
    expect(screen.getByRole('img', { name: /not available yet/i })).toBeInTheDocument();
  });
});

describe('badges', () => {
  it('never rely on colour alone: every badge has a text label', () => {
    render(
      <>
        <EligibilityBadge value="ineligible" />
        <EligibilityBadge value="incomplete" />
        <ApplicationStatusBadge value="shortlisted" />
        <AiBadge />
        <RuleBadge />
      </>,
    );
    for (const text of ['Not eligible', 'Profile incomplete', 'Shortlisted', 'AI', 'Rule-based']) {
      expect(screen.getByText(text)).toBeInTheDocument();
    }
  });
});

describe('formatting (India locale)', () => {
  it('formats INR with lakh grouping and IST dates', () => {
    expect(fmtINR(1250000)).toBe('₹12,50,000');
    expect(fmtDate('2026-03-05T20:00:00Z')).toBe('06 Mar 2026'); // 01:30 IST next day
    expect(fmtINR(null)).toBe('—');
  });
  it('describes deadlines', () => {
    expect(relativeDeadline(new Date(Date.now() - 1000).toISOString())).toBe('Closed');
    expect(relativeDeadline(new Date(Date.now() + 5 * 86_400_000).toISOString())).toMatch(/Closes in [45] days/);
  });
});
