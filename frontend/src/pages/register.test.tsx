import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { BranchSelector } from '../components/ui/branch-selector.js';
import type { PublicBranch } from '../adapters/branches.js';
import { validate } from './register.js';

/**
 * Registration form rules (§4.1, §4.1b step 5, Revision 39).
 *
 * `validate` is exported and tested directly rather than driven through the
 * DOM: it *is* the rule, and a test that clicked its way to the same conclusion
 * would be slower and would fail for reasons unrelated to the rule.
 */

const person = {
  firstNameArabic: 'خديجة',
  lastNameArabic: 'بنعلي',
  firstNameFrench: '',
  lastNameFrench: '',
  nickname: '',
  phone: '',
  notes: '',
  sex: 'female' as const,
};
/** R62 — a child is no longer a `person`: no phone, no notes, and two
 *  decisions of its own. */
const child = {
  firstNameArabic: 'مريم',
  lastNameArabic: 'بنعلي',
  firstNameFrench: '',
  lastNameFrench: '',
  nickname: '',
  sex: 'female' as const,
  schoolingStage: '' as const,
  mediaRelease: '' as const,
  // R67 — the branch and stage are the child's now, not the request's.
  branchId: 'b1',
  categoryId: 'c1',
};
const base = {
  // R49 — the FORM's three options, not the wire's two `kind`s.
  intent: 'adult' as const,
  applicant: person,
  // R62.1 — an array, because one request may carry several children.
  children: [child],
  branchId: 'b1',
  categoryId: 'c1',
  dataProcessing: true,
};

describe('§4.1 Revision 39 — the branch is a required choice', () => {
  it('refuses a submission with no branch chosen', () => {
    // A default would place someone at a branch nobody picked, which is the
    // one outcome worse than making them choose.
    expect(validate({ ...base, branchId: null })).toHaveProperty('branch');
  });

  it('accepts once a branch is chosen', () => {
    expect(validate(base)).toEqual({});
  });
});

describe('§4.1 step 1 / Revision 49 — the educational stage', () => {
  it('refuses a student submission with no stage chosen', () => {
    // Without it §4.1 step 1 cannot preselect "the first Level of the
    // applicant's Category" — the clause that was unimplementable until this
    // field existed.
    expect(validate({ ...base, categoryId: null })).toHaveProperty('category');
  });

  it('does NOT require one from a staff request', () => {
    // A teacher is admitted to no Level, so the question has no answer — and
    // the server refuses a staff request that states one.
    expect(validate({ ...base, intent: 'teacher', categoryId: null })).toEqual({});
  });
});

describe('consent rules (§4.1, BR-1)', () => {
  it('refuses without data-processing consent', () => {
    // Not a warning: there is no lawful basis to create the record at all.
    expect(validate({ ...base, dataProcessing: false })).toHaveProperty('dataProcessing');
  });

  it('requires a media-release DECISION for a minor, and accepts "no"', () => {
    const parentChild = { ...base, intent: 'parent_child' as const };
    // Unanswered is refused…
    expect(validate(parentChild)).toHaveProperty('children.0.mediaRelease');
    // …but declining is a valid, recorded answer. BR-1 reads an absent record
    // as refusal, so "no" and "unanswered" must not collapse into each other.
    expect(validate({ ...parentChild, children: [{ ...child, mediaRelease: 'no' }] })).toEqual({});
    expect(validate({ ...parentChild, children: [{ ...child, mediaRelease: 'yes' }] })).toEqual({});
  });

  it('R62.3b: the decision is PER CHILD — one answered, one not, is still refused', () => {
    // The whole reason the control moved out of the family fieldset: a parent
    // may permit photographs of one child and refuse for another, and a single
    // control could not express it. A form that only checked the first child
    // would send an unanswered release for the second.
    const errors = validate({
      ...base,
      intent: 'parent_child',
      children: [{ ...child, mediaRelease: 'yes' }, child],
    });
    expect(errors).not.toHaveProperty('children.0.mediaRelease');
    expect(errors).toHaveProperty('children.1.mediaRelease');
  });

  it('asks nothing about media release on the adult path', () => {
    expect(Object.keys(validate(base))).toEqual([]);
  });
});

describe('person rules mirror TD-9', () => {
  it('requires BOTH Arabic name parts and a sex for every person created', () => {
    // R40: الاسم الشخصي and الاسم العائلي are separate required fields, so a
    // form that checked only one would send half a name to be refused.
    const blank = { ...person, firstNameArabic: '  ', lastNameArabic: '', sex: '' as const };
    const errors = validate({ ...base, applicant: blank });
    expect(errors).toHaveProperty('applicant.firstNameArabic');
    expect(errors).toHaveProperty('applicant.lastNameArabic');
    expect(errors).toHaveProperty('applicant.sex');
  });

  it('caps each part separately (TD-9), which is what keeps the composed name in range', () => {
    const long = { ...person, lastNameArabic: 'ب'.repeat(61) };
    expect(validate({ ...base, applicant: long })).toHaveProperty('applicant.lastNameArabic');
  });

  it('validates EVERY child, not only the applicant and not only the first', () => {
    // The parent+child path creates several people, and a form that checked
    // only the first would send an invalid child to be rejected by the server —
    // with no indication of which one.
    const errors = validate({
      ...base,
      intent: 'parent_child',
      children: [
        { ...child, mediaRelease: 'no' as const },
        { ...child, mediaRelease: 'no' as const, firstNameArabic: '' },
      ],
    });
    expect(errors).not.toHaveProperty('children.0.firstNameArabic');
    expect(errors).toHaveProperty('children.1.firstNameArabic');
  });

  it('R41: French parts are optional, but as a PAIR — half a name is not a name', () => {
    expect(validate({ ...base, applicant: { ...person } })).toEqual({});
    expect(
      validate({ ...base, applicant: { ...person, firstNameFrench: 'Khadija' } }),
    ).toHaveProperty('applicant.lastNameFrench');
    expect(
      validate({ ...base, applicant: { ...person, lastNameFrench: 'Benali' } }),
    ).toHaveProperty('applicant.firstNameFrench');
    expect(
      validate({
        ...base,
        applicant: { ...person, firstNameFrench: 'Khadija', lastNameFrench: 'Benali' },
      }),
    ).toEqual({});
  });

  it('accepts an empty optional phone but refuses a malformed one', () => {
    expect(validate({ ...base, applicant: { ...person, phone: '' } })).toEqual({});
    expect(validate({ ...base, applicant: { ...person, phone: 'abc' } })).toHaveProperty(
      'applicant.phone',
    );
    expect(validate({ ...base, applicant: { ...person, phone: '+212 600 000 001' } })).toEqual({});
  });
});

describe('BranchSelector — one component, two modes (§14.3)', () => {
  const branches: PublicBranch[] = [
    {
      id: 'b1',
      name: 'مقر أمرشيش',
      address: null,
      phone: null,
    // NEW I — the fixture states it rather than letting the type drift silently.
    phone_secondary: null,
      email: null,
      opening_hours_ar: null,
      google_maps_url: null,
      display_order: 1,
    },
  ];

  it('offers "all branches" when filtering', () => {
    const html = renderToStaticMarkup(
      <BranchSelector branches={branches} value={null} onChange={() => undefined} />,
    );
    expect(html).toContain('كل الفروع');
    expect(html).not.toContain('required');
  });

  it('does NOT offer "all" when a choice is required', () => {
    // Registration must not let someone submit "all branches" as their branch.
    const html = renderToStaticMarkup(
      <BranchSelector
        branches={branches}
        value={null}
        onChange={() => undefined}
        allowAll={false}
        emptyLabel="اختر المقر…"
        required
      />,
    );
    expect(html).not.toContain('كل الفروع');
    expect(html).toContain('required');
  });

  it('generates its id instead of hardcoding one, so two cannot collide', () => {
    // The defect this component shipped with as a calendar widget: a literal
    // id="branch-filter" meant two on a page produced duplicate ids and a label
    // pointing at the wrong control.
    const html = renderToStaticMarkup(
      <>
        <BranchSelector branches={branches} value={null} onChange={() => undefined} />
        <BranchSelector branches={branches} value={null} onChange={() => undefined} />
      </>,
    );
    const ids = [...html.matchAll(/for="([^"]+)"/g)].map((m) => m[1]);
    expect(ids).toHaveLength(2);
    expect(ids[0]).not.toBe(ids[1]);
    expect(html).not.toContain('id="branch-filter"');
  });

  it('renders branch names from the adapter, never a literal list', () => {
    const html = renderToStaticMarkup(
      <BranchSelector branches={branches} value="b1" onChange={() => undefined} />,
    );
    expect(html).toContain('مقر أمرشيش');
  });
});
