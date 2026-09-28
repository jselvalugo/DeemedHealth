/**
 * Security review L7: inside a bulk request, a row whose savepoint throws an API error or
 * a constraint violation gets that row's status; only unexpected errors fail the batch.
 */
import { describe, expect, it } from 'vitest';
import { ApiError, DeniedError } from '../errors.js';
import { bulkRowStatusFor } from './handlers.js';

describe('bulk row status', () => {
  it('maps API errors and refusals to the row', () => {
    expect(bulkRowStatusFor(new ApiError('version_conflict', [], 3))).toBe('version_conflict');
    expect(bulkRowStatusFor(new ApiError('not_found'))).toBe('not_found');
    expect(bulkRowStatusFor(new ApiError('conflict', ['blockedBy.active_user_account']))).toBe(
      'blocked',
    );
    expect(bulkRowStatusFor(new ApiError('bad_request', ['name']))).toBe('invalid');
    expect(bulkRowStatusFor(new DeniedError('site_scope', { table: 'site', id: 'x' }, true))).toBe(
      'not_found',
    );
    expect(bulkRowStatusFor(new DeniedError('permission'))).toBe('forbidden');
  });

  it('maps data and constraint SQLSTATEs to an invalid row', () => {
    expect(bulkRowStatusFor(Object.assign(new Error('dup'), { code: '23505' }))).toBe('invalid');
    expect(bulkRowStatusFor(Object.assign(new Error('bad'), { code: '22P02' }))).toBe('invalid');
  });

  it('lets anything unexpected fail the whole request', () => {
    expect(bulkRowStatusFor(new Error('boom'))).toBeNull();
    expect(bulkRowStatusFor(Object.assign(new Error('gone'), { code: '57P01' }))).toBeNull();
    expect(bulkRowStatusFor(new ApiError('internal'))).toBeNull();
    expect(bulkRowStatusFor(undefined)).toBeNull();
  });
});
