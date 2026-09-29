'use client';

/**
 * Loads the requirement instances the Command Center summarizes, through the same records
 * client as the Requirements list, so the API's permissions, site scope, and auditing
 * apply unchanged. The Command Center never reads more than the viewer could open.
 */
import { useCallback, useEffect, useState } from 'react';
import { type CalendarDate, systemClock, todayIn } from '@deemed/dates';
import { useRecords, type RecordsErrorCode } from '@deemed/ui';
import { type Instance, toInstance } from '../../../lib/command-center/summary';
import { DEFAULT_TIME_ZONE } from '../records-view';

/** The records API's page size limit. */
const PAGE_SIZE = 200;
/** Pages read before the summary says it is partial (2,000 instances). */
const MAX_PAGES = 10;

export type ReadinessData = {
  items: Instance[];
  /** More instances exist than were read. */
  truncated: boolean;
  /** "Today" in the health center's time zone when the data loaded. */
  today: CalendarDate;
};

export type ReadinessState =
  | { kind: 'loading' }
  | { kind: 'error'; code: RecordsErrorCode }
  | ({ kind: 'ready' } & ReadinessData);

export function useReadiness(enabled: boolean, today?: CalendarDate): [ReadinessState, () => void] {
  const { client } = useRecords();
  const [state, setState] = useState<ReadinessState>({ kind: 'loading' });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!enabled) return;
    let live = true;
    setState({ kind: 'loading' });
    void (async () => {
      const items: Instance[] = [];
      let cursor: string | null = null;
      for (let page = 0; page < MAX_PAGES; page += 1) {
        const res = await client.list('requirement_instance', {
          filters: [],
          sort: [{ field: 'nextDueOn', dir: 'asc' }],
          q: '',
          limit: PAGE_SIZE,
          cursor,
          archived: 'exclude',
        });
        if (!live) return;
        if (!res.ok) {
          setState({ kind: 'error', code: res.code });
          return;
        }
        for (const row of res.data.items) {
          const instance = toInstance(row);
          if (instance) items.push(instance);
        }
        cursor = res.data.nextCursor;
        if (!cursor) break;
      }
      setState({
        kind: 'ready',
        items,
        truncated: cursor !== null,
        today: today ?? todayIn(systemClock, DEFAULT_TIME_ZONE),
      });
    })();
    return () => {
      live = false;
    };
  }, [client, enabled, today, attempt]);

  const reload = useCallback(() => setAttempt((n) => n + 1), []);
  return [state, reload];
}
