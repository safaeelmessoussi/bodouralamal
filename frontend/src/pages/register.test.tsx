import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { BranchSelector } from '../components/ui/branch-selector.js';
import type { PublicBranch } from '../adapters/branches.js';
import type { RoleChoice } from '../adapters/registrations.js';
import { buildPayload, explainFailure, validate } from './register.js';
import { ApiError } from '../lib/api.js';
import { ar } from '../i18n/ar.js';
import PAGE from './register.tsx?raw';

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
  phone: '+212 600000000',
  sex: 'female' as const,
  // R130 — the adult arm's applicant IS the beneficiary, so she carries one.
  birthDate: '1995-04-12',
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
  // R130 — every child on a request is a beneficiary and carries her own.
  birthDate: '2015-06-02',
  schoolingStage: '' as const,
  mediaRelease: '' as const,
  // R67 — the branch and stage are the child's now, not the request's.
  branchId: 'b1',
  categoryId: 'c1',
};
const base = {
  // R168 §1 — everything she asks for, any combination. One role here, so the
  // older single-purpose cases below read exactly as they did.
  selfManaged: false,
  roles: ['student'] as RoleChoice[],
  firstTime: 'no' as '' | 'yes' | 'no',
  circlePreferences: [] as string[],
  circlesOffered: 0,
  administrationBranchId: null as string | null,
  applicant: person,
  // R62.1 — an array, because one request may carry several children.
  children: [child],
  branchId: 'b1',
  categoryId: 'c1',
  framingMode: '' as const,
  allFramingBranches: false,
  framingBranchIds: [] as string[],
  dataProcessing: true,
  // R132 — empty on every arm but `self_managed`, which validates it alone.
  selfManagedCode: '',
  // Owner 2026-09-04 — the returning beneficiary's arm. Empty on every state
  // this file builds, which is the point: those arms must be unaffected by it.
  returnCode: '',
  returnFirstName: '',
  returnLastName: '',
  /* R119 — the id of the wording the form displayed; the payload carries it so
     the server can refuse a version that went out of force meanwhile. */
  consentTextId: 'ct-1',
};

describe('R132 — the self-managed claim validates its code and nothing else', () => {
  /**
   * **The defect this pins was a silent dead end.** The arm's early return sat
   * *after* the applicant was validated, so a form whose name fields are not
   * even rendered was permanently invalid, `valid` stayed false and the submit
   * button did nothing at all — no error, no request, no explanation. A browser
   * run found it; nothing in the source could.
   */
  const claim = (code: string) => ({ ...base, selfManaged: true, selfManagedCode: code });

  it('accepts a well-formed reference code with every other field empty', () => {
    // The applicant, children, branch, category and consent are all untouched
    // defaults here — exactly what the rendered form sends on this arm.
    expect(validate(claim('BA-7K4M2'))).toEqual({});
  });

  it('is case- and space-insensitive, because the code is copied off paper', () => {
    expect(validate(claim('  ba-7k4m2 '))).toEqual({});
  });

  it('refuses a malformed code, and names that field alone', () => {
    for (const bad of ['', '7K4M2', 'BA_7K4M2', 'XX-7K4M2', 'BA-']) {
      const errors = validate(claim(bad));
      expect(Object.keys(errors), bad).toEqual(['selfManagedCode']);
    }
  });

  it('does NOT ask for the branch, category or consent this arm never renders', () => {
    const errors = validate(claim('BA-7K4M2'));
    for (const key of ['branch', 'category', 'dataProcessing', 'applicant.firstNameArabic']) {
      expect(errors, key).not.toHaveProperty(key);
    }
  });
});

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
    expect(
      validate({
        ...base,
        roles: ['teaching'],
        categoryId: null,
        branchId: null,
        framingMode: 'online',
      }),
    ).toEqual({});
  });
});

describe('هيئة التأطير framing preference', () => {
  const teacher = {
    ...base,
    roles: ['teaching'] as RoleChoice[],
    branchId: null,
    categoryId: null,
  };

  it('requires a general mode for a staff request', () => {
    expect(validate(teacher)).toHaveProperty('framingMode');
  });

  it.each(['in_person', 'both'] as const)(
    'requires physical branch willingness for %s',
    (framingMode) => {
      expect(validate({ ...teacher, framingMode })).toHaveProperty('framingBranches');
      expect(
        validate({ ...teacher, framingMode, framingBranchIds: ['b1', 'b2'] }),
      ).toEqual({});
      expect(validate({ ...teacher, framingMode, allFramingBranches: true })).toEqual({});
    },
  );

  it('requires no physical branch for online framing', () => {
    expect(validate({ ...teacher, framingMode: 'online' })).toEqual({});
  });

  it('omits hidden branch data from an online payload', () => {
    expect(
      buildPayload({
        ...teacher,
        framingMode: 'online',
        allFramingBranches: true,
        framingBranchIds: ['b1'],
      }),
    ).toEqual({
      kind: 'roles',
      roles: ['teaching'],
      applicant: {
        first_name_arabic: 'خديجة',
        last_name_arabic: 'بنعلي',
        phone: '+212 600000000',
        sex: 'female',
      },
      teaching: { framing: { mode: 'online' } },
      // R119 — the payload names the wording that was on screen, so the server
      // can refuse one that went out of force while the form was open.
      consents: { data_processing: true, consent_text_id: 'ct-1' },
    });
  });

  it('represents one, multiple, and future-inclusive all branches without a fake id', () => {
    expect(
      buildPayload({ ...teacher, framingMode: 'in_person', framingBranchIds: ['b1'] }),
    ).toMatchObject({
      teaching: {
        framing: { mode: 'in_person', willingness: { all_branches: false, branch_ids: ['b1'] } },
      },
    });
    expect(
      buildPayload({ ...teacher, framingMode: 'both', framingBranchIds: ['b1', 'b2'] }),
    ).toMatchObject({
      teaching: {
        framing: { mode: 'both', willingness: { all_branches: false, branch_ids: ['b1', 'b2'] } },
      },
    });
    expect(
      buildPayload({ ...teacher, framingMode: 'both', allFramingBranches: true }),
    ).toMatchObject({
      teaching: { framing: { mode: 'both', willingness: { all_branches: true } } },
    });
  });

  it('keeps framing fields irrelevant to ordinary registrations', () => {
    expect(
      buildPayload({
        ...base,
        framingMode: 'both',
        allFramingBranches: true,
        framingBranchIds: ['b1'],
      }),
    ).not.toHaveProperty('teaching');
  });
});

describe('consent rules (§4.1, BR-1)', () => {
  it('refuses without data-processing consent', () => {
    // Not a warning: there is no lawful basis to create the record at all.
    expect(validate({ ...base, dataProcessing: false })).toHaveProperty('dataProcessing');
  });

  it('requires a media-release DECISION for a minor, and accepts "no"', () => {
    const parentChild = { ...base, roles: ['guardian'] as RoleChoice[] };
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
      roles: ['guardian'],
      children: [{ ...child, mediaRelease: 'yes' }, child],
    });
    expect(errors).not.toHaveProperty('children.0.mediaRelease');
    expect(errors).toHaveProperty('children.1.mediaRelease');
  });

  it('asks nothing about media release on the adult path', () => {
    expect(Object.keys(validate(base))).toEqual([]);
  });

  it.each([1, 2, 3])(
    'sends one request consent and a media decision for each of %i children',
    (childCount) => {
      const children = Array.from({ length: childCount }, (_, index) => ({
        ...child,
        firstNameArabic: `طفلة ${index + 1}`,
        mediaRelease: index % 2 === 0 ? ('yes' as const) : ('no' as const),
      }));
      const payload = buildPayload({ ...base, roles: ['guardian'], children });

      expect(payload.consents).toEqual({ data_processing: true, consent_text_id: 'ct-1' });
      expect(payload).not.toHaveProperty('consents.media_release');
      expect(payload.kind).toBe('roles');
      if (payload.kind === 'roles') {
        expect(payload.children?.map((entry) => entry.consent_media_release)).toEqual(
          children.map((entry) => entry.mediaRelease === 'yes'),
        );
      }
    },
  );
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
      roles: ['guardian'],
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

  it('requires a phone prospectively and refuses a malformed one', () => {
    expect(validate({ ...base, applicant: { ...person, phone: '' } })).toHaveProperty(
      'applicant.phone',
    );
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


/**
 * **A taken address and a spent token are different dead ends.**
 *
 * They shared one message: an address that already belongs to an account came
 * back as *«ابدئي تسجيل الدخول من جديد»* — advice that cannot work, because
 * signing in again reaches the same taken address. The applicant was told to
 * repeat the one step guaranteed to fail.
 */
describe('registration says WHY it refused (2026-08-28)', () => {
  const duplicate = (reason?: string): ApiError =>
    new ApiError(409, {
      code: 'DUPLICATE',
      message_key: 'errors.duplicate',
      message: '',
      details: reason === undefined ? {} : { reason },
      request_id: 'r',
    });

  it('names the taken email rather than blaming the token', () => {
    expect(explainFailure(duplicate('EMAIL_ALREADY_CLAIMED'))).toBe(ar.register.emailTaken);
    expect(ar.register.emailTaken).toContain('مستخدم بالفعل');
  });

  it('still says «start again» for a replayed identity, which IS the token', () => {
    // The other `DUPLICATE`: the same Google identity registering twice. Its
    // remedy really is to begin the sign-in again, so the distinction must not
    // collapse in the other direction either.
    expect(explainFailure(duplicate())).toBe(ar.register.tokenSpent);
  });
});

describe('the self-managed claim option is HIDDEN from the dropdown, not removed (Owner request, 2026-09-16)', () => {
  // Source-pinned, like `dashboard/library.test.tsx`'s own deep-link guard:
  // `Register` needs router/session context this file does not set up, and
  // the underlying state machine is already covered directly above by
  // `validate`/`buildPayload` against `selfManaged: true`.
  const source = PAGE.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '');

  it('no longer offers it as a choice in the dropdown', () => {
    expect(source).not.toContain("t('register.kindSelfManaged')");
  });

  it('keeps the whole flow reachable by state — validation, submission and the review queue are untouched', () => {
    expect(source).toContain('if (selfManaged) {');
    expect(source).toContain("get('mode') === 'self-managed'");
    expect(source).toContain('requestSelfManagedClaim');
  });
});

describe('SRS Revision 168 §1 — one form, several roles', () => {
  const everything = {
    ...base,
    roles: ['student', 'guardian', 'teaching', 'administration'] as RoleChoice[],
    children: [{ ...child, mediaRelease: 'no' as const }],
    framingMode: 'online' as const,
    administrationBranchId: 'b2',
  };

  it('asks for at least one role — and says so on the choices, not on a field nobody ticked', () => {
    expect(validate({ ...base, roles: [] })).toHaveProperty('roles');
  });

  it('validates the UNION of what the ticked roles need, and nothing of what they do not', () => {
    expect(validate(everything)).toEqual({});
    // Administration alone: no branch, no Category, no date of birth, no framing.
    expect(
      validate({
        ...base,
        roles: ['administration'],
        branchId: null,
        categoryId: null,
        firstTime: '',
        applicant: { ...person, birthDate: '' },
      }),
    ).toEqual({});
    // The same blanks are refused the moment «مستفيدة» is ticked beside it.
    const errors = validate({
      ...base,
      roles: ['administration', 'student'],
      branchId: null,
      categoryId: null,
      firstTime: '',
      applicant: { ...person, birthDate: '' },
    });
    expect(Object.keys(errors).sort()).toEqual(['applicant.birthDate', 'branch', 'category', 'firstTime']);
  });

  it('sends ONE applicant, the sections of the ticked roles and no others — in a stable order', () => {
    const payload = buildPayload({ ...everything, roles: ['teaching', 'student', 'administration', 'guardian'] });
    expect(payload).toMatchObject({
      kind: 'roles',
      roles: ['student', 'guardian', 'teaching', 'administration'],
      student: { branch_id: 'b1', category_id: 'c1', first_time: false },
      teaching: { framing: { mode: 'online' } },
      administration: { branch_id: 'b2' },
    });
    expect(payload).not.toHaveProperty('parent');
    if (payload.kind === 'roles') expect(payload.children).toHaveLength(1);

    // Unticked means ABSENT, whatever a hidden field still holds.
    const onlyAdmin = buildPayload({ ...everything, roles: ['administration'] });
    expect(Object.keys(onlyAdmin).sort()).toEqual(['administration', 'applicant', 'consents', 'kind', 'roles']);
    // …and a date of birth travels with a beneficiary only (R130).
    expect(onlyAdmin).not.toHaveProperty('applicant.birth_date');
    expect(payload).toHaveProperty('applicant.birth_date');
  });

  it('never lets her say WHICH administrative role — there is no such control, and no such key', () => {
    const source = PAGE.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '');
    expect(JSON.stringify(buildPayload({ ...everything, roles: ['administration'] }))).not.toContain('super_admin');
    expect(source).not.toContain("'super_admin'");
  });

  it('«بيانات وليّ الأمر» heads her data ONLY when registering children is all she asked for', () => {
    expect(PAGE).toContain("{roles.length === 1 && asks('guardian') ? t('register.parent') : t('register.you')}");
  });

  it('a first-timer orders at least one circle WHERE there is a choice, in her own order — a returning one is asked nothing', () => {
    const first = { ...base, firstTime: 'yes' as const, circlesOffered: 3 };
    expect(validate(first)).toHaveProperty('circles');
    expect(validate({ ...first, circlePreferences: ['g2'] })).toEqual({});
    // Fewer than two circles is not a choice: nothing is owed.
    expect(validate({ ...first, circlesOffered: 1 })).toEqual({});
    expect(validate({ ...base, firstTime: 'no', circlesOffered: 3 })).toEqual({});

    expect(buildPayload({ ...first, circlePreferences: ['g2', 'g1'] })).toMatchObject({
      student: { first_time: true, circle_preferences: ['g2', 'g1'] },
    });
    // A returning مستفيدة sends none, even if the state still holds some.
    expect(buildPayload({ ...base, firstTime: 'no', circlePreferences: ['g1'] })).not.toHaveProperty(
      'student.circle_preferences',
    );
  });
});

/**
 * **SRS Revision 170 §2 — «ماذا تريدين؟» is one CLOSED control, and «أسجّل نفسي
 * كمستفيدة» is chosen for her** (the Owner, 2026-09-21 — reversing R168's
 * «nothing preselected»). Source-pinned for the same reason as the block above:
 * `Register` needs an onboarding token and a session this file does not set up,
 * and the behaviour — open, tick several, the sections follow — is watched in a
 * real browser by `verify-role-requests` and `verify-registration`.
 */
describe('SRS Revision 170 §2 — the role chooser is a closed dropdown with a default', () => {
  const source = PAGE.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '');

  it('starts with «أسجّل نفسي كمستفيدة» chosen — a default, never a lock', () => {
    expect(source).toContain("useState<RoleChoice[]>(['student'])");
    // Unticking it is still allowed, and still refused only when NOTHING is left.
    expect(validate({ ...base, roles: [] })).toHaveProperty('roles');
  });

  it('is the platform’s own multi-select — closed until opened, several answers — not a checkbox list', () => {
    expect(source).toContain('<MultiSelectField');
    expect(source).toContain("options={ROLE_CHOICES.map((role) => ({ value: role, label: t(`register.role.${role}`) }))}");
    expect(source).not.toContain('<CheckboxField');
  });

  it('unticking a role still ERASES what its section held, whichever roles were dropped together', () => {
    expect(source).toContain("const dropped = roles.filter((role) => !next.includes(role));");
    for (const role of ['student', 'guardian', 'teaching', 'administration']) {
      expect(source).toContain(`dropped.includes('${role}')`);
    }
  });

  it('says what will happen before she starts — three steps, the last of which is not hers', () => {
    expect(source).toContain('data-register-steps');
    expect(ar.register.stepReview).toBe('تراجع الإدارة طلبك');
  });
});
