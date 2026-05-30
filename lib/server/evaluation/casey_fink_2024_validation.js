// Structural validation module for the Casey-Fink Readiness for Practice Survey 2024.
// Contains only structural item codes and integer scale ranges.
// No copyrighted item prose, response-anchor wording, or formatted student-facing content.

const s1Items = [
  'S1_Q01','S1_Q02','S1_Q03','S1_Q04','S1_Q05','S1_Q06',
  'S1_Q07','S1_Q08','S1_Q09','S1_Q10','S1_Q11',
  'S1_Q12','S1_Q13','S1_Q14','S1_Q15',
];

const s2Items = ['S2_Q01','S2_Q02','S2_Q03','S2_Q04'];

const s3Items = [
  'S3_Q01','S3_Q02','S3_Q03','S3_Q04','S3_Q05','S3_Q06','S3_Q07','S3_Q08','S3_Q09',
  'S3_Q10','S3_Q11','S3_Q12','S3_Q13','S3_Q14','S3_Q15','S3_Q16','S3_Q17','S3_Q18',
  'S3_Q19','S3_Q20','S3_Q21','S3_Q22','S3_Q23','S3_Q24','S3_Q25','S3_Q26','S3_Q27',
  'S3_Q28','S3_Q29','S3_Q30','S3_Q31',
];

const s4Items = [
  'S4_Q01','S4_Q02','S4_Q03','S4_Q04','S4_Q05',
  'S4_Q06','S4_Q07','S4_Q08','S4_Q09','S4_Q10',
];

const requiredItemCodes = Object.freeze([
  ...s1Items,
  ...s2Items,
  ...s3Items,
  ...s4Items,
]);

const optionalItemCodes = Object.freeze(['S4_COMMENT']);

export const SCHEMA = Object.freeze({
  slug: 'casey_fink_readiness_2024',
  version: '2024-revised',
  sections: Object.freeze({
    s1: Object.freeze({ itemCount: 15, scaleMin: 1, scaleMax: 4 }),
    s2: Object.freeze({ itemCount: 4,  scaleMin: 1, scaleMax: 5 }),
    s3: Object.freeze({ itemCount: 31, scaleMin: 1, scaleMax: 3 }),
    s4: Object.freeze({ itemCount: 10, valueType: 'demographic' }),
  }),
  requiredItemCodes,
  optionalItemCodes,
  s1Subscales: Object.freeze({
    clinical_problem_solving: Object.freeze(['S1_Q01','S1_Q02','S1_Q03','S1_Q04','S1_Q05','S1_Q06']),
    learning_activities:      Object.freeze(['S1_Q07','S1_Q08','S1_Q09','S1_Q10','S1_Q11']),
    practice_readiness:       Object.freeze(['S1_Q12','S1_Q13','S1_Q14','S1_Q15']),
  }),
});

export function validateResponses(responses) {
  const errors = [];

  if (
    responses === null ||
    responses === undefined ||
    typeof responses !== 'object' ||
    Array.isArray(responses)
  ) {
    return { valid: false, errors: ['responses must be a plain object'] };
  }

  for (const code of SCHEMA.requiredItemCodes) {
    if (!(code in responses)) {
      errors.push(`missing required item ${code}`);
      continue;
    }
    const value = responses[code];
    if (code.startsWith('S1_')) {
      if (!Number.isInteger(value) || value < 1 || value > 4) {
        errors.push(`${code} must be an integer between 1 and 4`);
      }
    } else if (code.startsWith('S2_')) {
      if (!Number.isInteger(value) || value < 1 || value > 5) {
        errors.push(`${code} must be an integer between 1 and 5`);
      }
    } else if (code.startsWith('S3_')) {
      if (!Number.isInteger(value) || value < 1 || value > 3) {
        errors.push(`${code} must be an integer between 1 and 3`);
      }
    } else if (code.startsWith('S4_')) {
      if (typeof value !== 'number' && !(typeof value === 'string' && value !== null)) {
        errors.push(`${code} must be a number or string`);
      }
    }
  }

  if ('S4_COMMENT' in responses) {
    const comment = responses['S4_COMMENT'];
    if (typeof comment !== 'string' || comment.trim().length > 2000) {
      errors.push('S4_COMMENT must be a string of at most 2000 characters (trimmed)');
    }
  }

  const allowedKeys = new Set([...SCHEMA.requiredItemCodes, ...SCHEMA.optionalItemCodes]);
  for (const key of Object.keys(responses)) {
    if (!allowedKeys.has(key)) {
      errors.push(`unexpected response key ${key}`);
    }
  }

  return { valid: errors.length === 0, errors };
}
