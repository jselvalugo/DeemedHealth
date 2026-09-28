import { describe, expect, it } from 'vitest';
import {
  classifySsnColumnName,
  containsSsnShape,
  detectSsnLikeColumns,
  isSsnShapedValue,
  tokenizeColumnName,
} from './ssn-detector.js';

// SSN-shaped test values are assembled at runtime so no literal ddd-dd-dddd value
// sits in the repository (check-no-ssn, decision D1). Area 000 is never issued.
const shaped = (sep: string) => ['000', '12', '3456'].join(sep);

describe('tokenizeColumnName', () => {
  it('splits separators, camelCase and digits, and joins single letters', () => {
    expect(tokenizeColumnName('Employee SSN')).toEqual(['employee', 'ssn']);
    expect(tokenizeColumnName('socialSecurityNumber')).toEqual(['social', 'security', 'number']);
    expect(tokenizeColumnName('last4SSN')).toEqual(['last', '4', 'ssn']);
    expect(tokenizeColumnName('S.S.N.')).toEqual(['ssn']);
    expect(tokenizeColumnName('Número de Seguro Social')).toEqual([
      'numero',
      'de',
      'seguro',
      'social',
    ]);
  });
});

describe('classifySsnColumnName', () => {
  it.each([
    'SSN',
    'ssn',
    'Employee SSN',
    'employee_ssn',
    'ssn_last4',
    'last4SSN',
    'S.S.N.',
    'SS#',
    'SS No.',
    'SS Number',
    'SSNumber',
    'Social Security Number',
    'social_security_no',
    'SocialSecurity',
    'soc sec',
    'Número de Seguro Social',
    'numero_seguro_social',
    'NSS',
  ])('flags %s as high', (name) => {
    expect(classifySsnColumnName(name)).toBe('high');
  });

  it.each(['TIN', 'Tax ID', 'taxpayer_id', 'ITIN'])('flags %s as possible', (name) => {
    expect(classifySsnColumnName(name)).toBe('possible');
  });

  it.each([
    'given_name',
    'npi',
    'dob_enc',
    'dob_bidx',
    'is_test_record',
    'lessons',
    'assessment_date',
    'session_id',
    'classification',
    'time_zone',
    'postal_code',
    'license_number',
    'DEA Number',
    'Business Unit',
  ])('does not flag %s', (name) => {
    expect(classifySsnColumnName(name)).toBeNull();
  });
});

describe('isSsnShapedValue', () => {
  it('matches the formatted shape only', () => {
    expect(isSsnShapedValue(shaped('-'))).toBe(true);
    expect(isSsnShapedValue(shaped(' '))).toBe(true);
    expect(isSsnShapedValue(shaped(''))).toBe(false);
    expect(isSsnShapedValue('32801-1234')).toBe(false);
    expect(isSsnShapedValue(123)).toBe(false);
  });
});

describe('containsSsnShape', () => {
  it('finds an SSN-shaped run inside free text, as the audit function does', () => {
    expect(containsSsnShape(`Employee ${shaped('-')} left`)).toBe(true);
    expect(containsSsnShape(shaped('-'))).toBe(true);
    expect(containsSsnShape(shaped(' '))).toBe(true);
    expect(containsSsnShape(`(${shaped('-')})`)).toBe(true);
  });

  it('ignores runs glued to other digits or hyphens, and non-strings', () => {
    expect(containsSsnShape(`9${shaped('-')}`)).toBe(false);
    expect(containsSsnShape(`${shaped('-')}7`)).toBe(false);
    expect(containsSsnShape(`-${shaped('-')}`)).toBe(false);
    expect(containsSsnShape('Call 305-555-0100')).toBe(false);
    expect(containsSsnShape(123456789)).toBe(false);
    expect(containsSsnShape(null)).toBe(false);
  });

  it('stays linear on long input', () => {
    const long = '1-'.repeat(100_000);
    const started = performance.now();
    expect(containsSsnShape(long)).toBe(false);
    expect(performance.now() - started).toBeLessThan(1000);
  });
});

describe('detectSsnLikeColumns', () => {
  it('returns nothing for a clean staff roster', () => {
    expect(
      detectSsnLikeColumns([
        { name: 'First name', values: ['Maria', 'Tomás'] },
        { name: 'NPI', values: ['1000000004', '1000000012'] },
        { name: 'ZIP', values: ['32801', '32501'] },
      ]),
    ).toEqual([]);
  });

  it('flags a column by name', () => {
    const [finding] = detectSsnLikeColumns([{ name: 'Employee SSN' }]);
    expect(finding).toMatchObject({
      column: 'Employee SSN',
      confidence: 'high',
      reason: 'column_name',
    });
  });

  it('flags an innocently named column whose values have the SSN shape, without echoing them', () => {
    const findings = detectSsnLikeColumns([
      { name: 'Employee ID', values: ['A-1', shaped('-'), shaped('-')] },
    ]);
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({ confidence: 'high', reason: 'value_pattern' });
    expect(JSON.stringify(findings)).not.toContain(shaped('-'));
  });

  it('treats mostly bare nine-digit values as possible, and ignores small samples', () => {
    const nine = shaped('');
    expect(
      detectSsnLikeColumns([{ name: 'Identifier', values: [nine, nine, nine, nine, 'x'] }]),
    ).toEqual([expect.objectContaining({ confidence: 'possible', reason: 'value_pattern' })]);
    expect(detectSsnLikeColumns([{ name: 'Identifier', values: [nine, nine] }])).toEqual([]);
  });

  it('reports one finding per column, strongest first', () => {
    const findings = detectSsnLikeColumns([{ name: 'SSN', values: [shaped('-')] }]);
    expect(findings).toHaveLength(1);
    expect(findings[0]?.reason).toBe('value_pattern');
  });
});
