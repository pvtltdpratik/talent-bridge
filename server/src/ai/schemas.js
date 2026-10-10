// Zod schemas for every AI feature. They serve two purposes:
//   1. converted to a JSON schema so Gemini returns structured output
//   2. the ONLY gate AI output passes through before it is stored or shown
// Numbers are clamped (not rejected); unknown keys are dropped (zod object default); lists are capped.
import { z } from 'zod';

const score = z.number().finite().transform((n) => Math.min(100, Math.max(0, Math.round(n))));
const text = (max) => z.string().transform((s) => s.trim().slice(0, max));
const list = (item, max) => z.array(item).transform((a) => a.slice(0, max));
const strings = (max, itemMax = 120) => list(text(itemMax), max);

// ---- resume parsing --------------------------------------------------------
export const resumeParseSchema = z.object({
  skills: strings(60, 60),
  education: list(
    z.object({
      degree: text(120),
      field: text(120),
      institution: text(160),
      startYear: z.number().int().nullable(),
      endYear: z.number().int().nullable(),
      score: text(40),
    }),
    6,
  ),
  experience: list(
    z.object({
      organization: text(160),
      role: text(120),
      duration: text(80),
      description: text(800),
    }),
    10,
  ),
  projects: list(
    z.object({
      title: text(160),
      description: text(800),
      technologies: strings(15, 40),
    }),
    10,
  ),
  certifications: strings(15, 160),
});

// ---- resume analysis -------------------------------------------------------
export const RESUME_COMPONENTS = {
  content_clarity: 'Content & clarity',
  skills_presentation: 'Skills presentation',
  project_quality: 'Project quality',
  experience_impact: 'Experience & impact',
  structure_formatting: 'Structure & formatting',
  ats_keywords: 'Keywords & ATS readiness',
};

export const resumeAnalysisSchema = z.object({
  components: list(
    z.object({
      key: z.enum(Object.keys(RESUME_COMPONENTS)),
      score,
      reason: text(400),
    }),
    6,
  ),
  strengths: strings(8, 240),
  weaknesses: strings(8, 240),
  missingSkills: strings(15, 60),
  improvements: list(
    z.object({
      area: text(80),
      suggestion: text(400),
      priority: z.enum(['high', 'medium', 'low']),
    }),
    10,
  ),
  projectRelevance: z.object({ score, reason: text(300) }),
}).refine((o) => new Set(o.components.map((c) => c.key)).size >= 3, 'Too few score components');

// ---- job match (language-based parts only) ----------------------------------
export const matchAiSchema = z.object({
  roleRelevance: z.object({ score, reason: text(400), signals: strings(6, 160) }),
  projectRelevance: z.object({ score, reason: text(400) }),
});

// ---- skill gap learning plan -------------------------------------------------
export const skillGapSchema = z.object({
  items: list(
    z.object({
      skill: text(80),
      priority: z.enum(['high', 'medium', 'low']),
      learningSteps: strings(6, 240),
      resourceTypes: strings(5, 80),
      estimatedWeeks: z.number().finite().transform((n) => Math.min(26, Math.max(1, Math.round(n)))),
    }),
    20,
  ),
});

// ---- interview questions ------------------------------------------------------
export const interviewQuestionsSchema = z.object({
  technical: list(
    z.object({
      question: text(400),
      topic: text(80),
      difficulty: z.enum(['easy', 'medium', 'hard']),
      whatGoodLooksLike: text(400),
    }),
    12,
  ),
  hr: list(z.object({ question: text(300), whyAsked: text(300) }), 8),
});

// ---- roadmap ----------------------------------------------------------------------
export const roadmapSchema = z.object({
  summary: text(600),
  phases: list(
    z.object({
      label: text(60),
      focus: text(200),
      goals: strings(6, 200),
      tasks: strings(8, 240),
    }),
    6,
  ),
});

// ---- insights narrative (numbers are supplied by SQL, never by the model) ---------
export const insightsSchema = z.object({
  headline: text(240),
  observations: list(
    z.object({ title: text(120), detail: text(500), metricRefs: strings(6, 80) }),
    8,
  ),
  recommendations: strings(6, 300),
});
