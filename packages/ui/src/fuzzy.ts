/**
 * Small fuzzy matcher for the launcher. Case- and accent-insensitive (so "modulo"
 * finds "Módulo"), returns character ranges in the ORIGINAL text for highlighting.
 */
import type { MessageKey } from '@deemed/i18n';
import type { ModuleEntry, PageEntry } from './module-registry.js';

export type Range = readonly [start: number, end: number]; // end is exclusive
export type Match = { score: number; ranges: Range[] };

type Folded = { text: string; map: number[] };

/** Lowercase and strip diacritics, keeping a map from folded index to original index. */
export function fold(input: string): Folded {
  let text = '';
  const map: number[] = [];
  for (let i = 0; i < input.length; i++) {
    const f = input.charAt(i).normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
    for (const ch of f) {
      text += ch;
      map.push(i);
    }
  }
  return { text, map };
}

const isBoundary = (text: string, i: number) => i === 0 || /[\s\-&/(),.]/.test(text.charAt(i - 1));

function toRanges(indices: number[], map: number[]): Range[] {
  const ranges: [number, number][] = [];
  for (const fi of indices) {
    const oi = map[fi] ?? 0;
    const last = ranges[ranges.length - 1];
    if (last && last[1] === oi) last[1] = oi + 1;
    else if (!last || last[1] <= oi) ranges.push([oi, oi + 1]);
  }
  return ranges;
}

export function fuzzyMatch(query: string, target: string): Match | null {
  const q = fold(query.trim()).text.replace(/\s+/g, ' ');
  if (!q) return { score: 0, ranges: [] };
  const { text, map } = fold(target);

  // 1. Substring: best, and better still at the start of a word.
  const at = text.indexOf(q);
  if (at >= 0) {
    let wordAt = at;
    // Prefer an occurrence that starts a word.
    for (let i = at; i >= 0; i = text.indexOf(q, i + 1)) {
      if (isBoundary(text, i)) {
        wordAt = i;
        break;
      }
    }
    const score = 1000 + (wordAt === 0 ? 300 : isBoundary(text, wordAt) ? 150 : 0) - wordAt;
    return {
      score,
      ranges: toRanges(
        Array.from({ length: q.length }, (_, k) => wordAt + k),
        map,
      ),
    };
  }

  // 2. Subsequence (spaces in the query are ignored), rewarding word starts and runs.
  const chars = q.replace(/ /g, '');
  const a = subsequence(chars, text, false);
  const b = subsequence(chars, text, true);
  const best = a && b ? (b.score > a.score ? b : a) : (a ?? b);
  // Reject scattered matches that are mostly noise.
  if (!best || best.score < chars.length * 3) return null;
  return { score: best.score, ranges: toRanges(best.indices, map) };
}

function subsequence(
  chars: string,
  text: string,
  preferWordStarts: boolean,
): { score: number; indices: number[] } | null {
  const indices: number[] = [];
  let score = 0;
  let from = 0;
  let prev = -2;
  for (const ch of chars) {
    let idx = text.indexOf(ch, from);
    if (idx < 0) return null;
    if (preferWordStarts && idx !== prev + 1) {
      for (let j = idx; j >= 0; j = text.indexOf(ch, j + 1)) {
        if (isBoundary(text, j)) {
          idx = j;
          break;
        }
      }
    }
    score += idx === prev + 1 ? 15 : isBoundary(text, idx) ? 10 : 1;
    score -= Math.min(idx - from, 10) * 0.5;
    indices.push(idx);
    prev = idx;
    from = idx + 1;
  }
  return { score, indices };
}

export type PageResult = { page: PageEntry; match: Match | null };
export type ModuleResult = {
  module: ModuleEntry;
  match: Match | null;
  pages: PageResult[];
  score: number;
};

/**
 * Filter modules and pages together. A module whose name matches keeps all its
 * pages; otherwise only its matching pages are shown. Best matches first.
 */
export function searchModules(
  modules: readonly ModuleEntry[],
  query: string,
  label: (key: MessageKey) => string,
): ModuleResult[] {
  if (!query.trim()) {
    return modules.map((module) => ({
      module,
      match: null,
      pages: module.pages.map((page) => ({ page, match: null })),
      score: 0,
    }));
  }
  const results: ModuleResult[] = [];
  modules.forEach((module) => {
    const match = fuzzyMatch(query, label(module.name));
    const pages = module.pages.map((page) => ({
      page,
      match: fuzzyMatch(query, label(page.name)),
    }));
    const matchedPages = pages.filter((p) => p.match);
    if (!match && matchedPages.length === 0) return;
    const best = Math.max(
      match?.score ?? -Infinity,
      ...matchedPages.map((p) => p.match?.score ?? -Infinity),
    );
    results.push({ module, match, pages: match ? pages : matchedPages, score: best });
  });
  // Array.prototype.sort is stable, so ties keep registry order.
  return results.sort((a, b) => b.score - a.score);
}
