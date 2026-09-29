/**
 * Catalog publish job and catalog reads (ADR-0003 rules 3, 8, 11).
 *
 * The publish job runs as app_platform. It reads this database's channel
 * (catalog.database_profile), picks the matching bundle, checks it (format, channel,
 * content and entry hashes, and, for production, that every entry is verified), and loads
 * it through catalog.publish_release, which checks the same rules again and is backed by
 * the table constraint. A new release fans out one readiness recompute per tenant.
 */
import type { Actor, Database, Tx } from '@deemed/db';
import { listTenants } from '@deemed/db';
import { sendPlatformJob, spreadDelaySeconds } from '@deemed/jobs';
import { CatalogEntrySchema, type CatalogEntry } from '@deemed/requirements-catalog';
import {
  bundleContentHash,
  canonicalJson,
  sha256Hex,
  type BundleChannel,
  type CatalogBundle,
} from '@deemed/requirements-catalog/compiler';
import { sql } from 'drizzle-orm';
import { ReadinessError } from './errors.js';

export const RECOMPUTE_QUEUE = 'readiness.recompute';

/** Checks a bundle before it is published. Throws ReadinessError('bundle_*'). */
export function verifyBundle(bundle: CatalogBundle, channel: BundleChannel): void {
  if (bundle.format !== 1 || !Array.isArray(bundle.entries) || !Array.isArray(bundle.sources)) {
    throw new ReadinessError('bundle_invalid', ['format']);
  }
  if (bundle.channel !== channel) throw new ReadinessError('bundle_channel_mismatch');
  for (const e of bundle.entries) {
    const { entryHash, ...entry } = e;
    const parsed = CatalogEntrySchema.safeParse(entry);
    if (!parsed.success) throw new ReadinessError('bundle_invalid', [String(e.id)]);
    if (sha256Hex(canonicalJson(parsed.data)) !== entryHash) {
      throw new ReadinessError('bundle_invalid', [`${e.id}.entryHash`]);
    }
    if (channel === 'production' && e.status !== 'verified') {
      throw new ReadinessError('bundle_not_verified', [e.id]);
    }
  }
  // The hash covers the whole bundle (version, changeset, sources, exclusions), so nothing
  // in it can be altered between the build and the publish (S13).
  if (bundleContentHash(bundle) !== bundle.contentHash) {
    throw new ReadinessError('bundle_invalid', ['contentHash']);
  }
}

export async function databaseChannel(tx: Tx): Promise<BundleChannel | null> {
  const r = await tx.execute<{ channel: BundleChannel }>(
    sql`SELECT channel FROM catalog.database_profile`,
  );
  return r.rows[0]?.channel ?? null;
}

export interface PublishResult {
  releaseId: string;
  catalogVersion: string;
  channel: BundleChannel;
  /** false when the same release was already loaded (idempotent). */
  created: boolean;
  entryCount: number;
}

/** Loads one bundle (inside withPlatform as app_platform). */
export async function publishCatalogBundle(
  tx: Tx,
  bundle: CatalogBundle,
  publishedBy: string,
): Promise<PublishResult> {
  const channel = await databaseChannel(tx);
  if (channel === null) throw new ReadinessError('bundle_channel_mismatch', ['database_profile']);
  verifyBundle(bundle, channel);
  const before = await tx.execute<{ id: string }>(
    sql`SELECT id::text FROM catalog.catalog_release WHERE catalog_version = ${bundle.catalogVersion}`,
  );
  const r = await tx.execute<{ id: string }>(
    sql`SELECT catalog.publish_release(${JSON.stringify(bundle)}::jsonb, ${publishedBy}::text)::text AS id`,
  );
  const releaseId = r.rows[0]?.id;
  if (!releaseId) throw new Error('catalog.publish_release returned no id');
  return {
    releaseId,
    catalogVersion: bundle.catalogVersion,
    channel,
    created: before.rows.length === 0,
    entryCount: bundle.entries.length,
  };
}

/** A new release spreads its per-tenant recomputes over 5 minutes (S6). */
export const RELEASE_SPREAD_SECONDS = 300;

const PUBLISH_ACTOR: Actor = { type: 'system', label: 'catalog publish job' };

/**
 * The publish job: picks the bundle for this database's channel, publishes it, and
 * enqueues a readiness recompute for every active tenant when the release is new.
 */
export async function runCatalogPublishJob(options: {
  platform: Database;
  bundles: Partial<Record<BundleChannel, CatalogBundle>>;
  publishedBy?: string;
  /** Spread the per-tenant recomputes over this many seconds (default 300, S6). */
  spreadSeconds?: number;
}): Promise<PublishResult & { recomputesEnqueued: number }> {
  const spread = options.spreadSeconds ?? RELEASE_SPREAD_SECONDS;
  return options.platform.withPlatform(PUBLISH_ACTOR, async (tx) => {
    const channel = await databaseChannel(tx);
    if (channel === null) throw new ReadinessError('bundle_channel_mismatch', ['database_profile']);
    const bundle = options.bundles[channel];
    if (!bundle) throw new ReadinessError('bundle_channel_mismatch', [channel]);
    const result = await publishCatalogBundle(
      tx,
      bundle,
      options.publishedBy ?? PUBLISH_ACTOR.label,
    );
    let recomputesEnqueued = 0;
    if (result.created) {
      for (const t of await listTenants(tx)) {
        if (t.status !== 'active') continue;
        await sendPlatformJob(tx, t.organizationId, RECOMPUTE_QUEUE, {
          singletonKey: RECOMPUTE_QUEUE,
          actorLabel: 'readiness recompute (catalog release)',
          payload: { catalogVersion: result.catalogVersion },
          delaySeconds: spreadDelaySeconds(t.organizationId, spread),
        });
        recomputesEnqueued += 1;
      }
    }
    return { ...result, recomputesEnqueued };
  });
}

export interface ActiveCatalog {
  release: { id: string; catalogVersion: string; channel: BundleChannel } | null;
  entries: ReadonlyMap<string, { versionId: string; entry: CatalogEntry }>;
}

/** The latest release and its entries (catalog tables are readable by app_user). */
export async function loadActiveCatalog(tx: Tx): Promise<ActiveCatalog> {
  const rel = await tx.execute<{ id: string; catalog_version: string; channel: BundleChannel }>(sql`
    SELECT id::text, catalog_version, channel FROM catalog.catalog_release
    ORDER BY string_to_array(catalog_version, '.')::int[] DESC LIMIT 1`);
  const row = rel.rows[0];
  if (!row) return { release: null, entries: new Map() };
  const versions = await tx.execute<{ id: string; requirement_id: string; entry: unknown }>(sql`
    SELECT id::text, requirement_id, entry FROM catalog.requirement_version
    WHERE catalog_release_id = ${row.id}::uuid ORDER BY requirement_id`);
  const entries = new Map<string, { versionId: string; entry: CatalogEntry }>();
  for (const v of versions.rows) {
    entries.set(v.requirement_id, { versionId: v.id, entry: CatalogEntrySchema.parse(v.entry) });
  }
  return {
    release: { id: row.id, catalogVersion: row.catalog_version, channel: row.channel },
    entries,
  };
}
