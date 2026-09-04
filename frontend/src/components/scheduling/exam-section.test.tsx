import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { ExamSection, type ExamSectionProps } from './exam-section.js';
import { ar } from '../../i18n/ar.js';

/**
 * **The «قريباً» that stopped being true.**
 *
 * `scheduling.exam.onlineSoon` said *«الامتحانات عن بُعد — قريباً. هذه الميزة قيد
 * التخطيط ولم تُبنَ بعد»*, and R124 built it: an online assessment is written,
 * published, answered, marked and returned, and the admission-to-achievement
 * journey proves that whole chain. The screen was telling the Document Owner
 * that a feature she had just finished using did not exist.
 *
 * It also said it **twice** — as the select's `hint` and as the section body,
 * three lines apart in one component (rule AH: one message per kind, in the
 * place that kind belongs).
 *
 * Asserted here rather than in the browser deliberately. Reaching this copy on a
 * real page means driving «نوع العنصر → اختبار → عن بُعد» through two
 * React-controlled `<select>`s, and a run that fails to apply the first reads
 * the *session* delivery selector instead and reports on markup this component
 * never rendered — which is exactly what the first browser attempt did.
 * Rendering the component asks the question at the level that can answer it.
 */
const props = {
  mode: 'online',
  onMode: () => {},
  locked: false,
  hideScope: false,
  scope: {
    value: {},
    set: () => {},
    setMany: () => {},
    options: { branchId: [], levelId: [], subjectId: [], academicYearId: [] },
    loading: {},
    ready: true,
  },
  date: '',
  onDate: () => {},
  startTime: '',
  onStartTime: () => {},
  endTime: '',
  onEndTime: () => {},
  rooms: [],
  roomId: '',
  onRoom: () => {},
  staff: [],
  supervisorId: '',
  onSupervisor: () => {},
  assistantIds: [],
  onAssistants: () => {},
  maxGrade: '20',
  onMaxGrade: () => {},
} as unknown as ExamSectionProps;

const markup = (): string => renderToStaticMarkup(<ExamSection {...props} />);

describe('the online exam mode no longer promises an unbuilt feature', () => {
  it('says nothing is «قريباً» and nothing is unbuilt', () => {
    const html = markup();
    for (const gone of ['قريباً', 'لم تُبنَ بعد', 'قيد التخطيط']) {
      expect(html, gone).not.toContain(gone);
    }
  });

  it('says where an online paper is actually written, exactly once', () => {
    const html = markup();
    // **Once.** It was the `hint` AND the body before, which is how one sentence
    // came to be on screen twice.
    expect(html.split('الاختبارات عن بُعد تُعدّ').length - 1).toBe(1);
    expect(html).toContain('/admin/assessments');
    expect(html).toContain(ar.scheduling.exam.onlineGoToBuilder);
  });

  it('the mode option is named plainly, with no roadmap suffix', () => {
    const html = markup();
    expect(html).toContain(ar.scheduling.exam.online);
    expect(html).not.toContain(`${ar.scheduling.exam.online} —`);
  });

  it('the retired key is gone from the dictionary, not merely unused', () => {
    // A string nothing renders is a string somebody re-renders later.
    expect((ar.scheduling.exam as Record<string, unknown>)['onlineSoon']).toBeUndefined();
  });
});
