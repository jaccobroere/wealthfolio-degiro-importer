/**
 * Duplicate detection via activity `metadata` fingerprints.
 *
 * Loads account activities with `activities.getAll(accountId)` and reads only
 * metadata entries whose `importerId` === this add-on's id. Compares
 * `sourceFingerprint` to detect exact duplicates and overlap. Never uses
 * exception-string matching or any destructive protocol.
 */
import type { ActivityDetails } from '@wealthfolio/addon-sdk';

import { IMPORTER_ID } from './types';

/** A set of fingerprints already imported by this add-on for one account. */
export interface DuplicateIndex {
  /** Fingerprints of activities this add-on has already imported. */
  importedFingerprints: Set<string>;
  /** Overlap keys (coarser economic+timestamp) already imported by this
   * add-on, for informational overlap review. */
  importedOverlapKeys: Set<string>;
}

/**
 * Read the metadata of an activity as a record. The host may store metadata
 * as a string or an object; normalize to an object.
 */
function readMetadata(activity: ActivityDetails): Record<string, unknown> | undefined {
  const meta = activity.metadata as unknown;
  if (meta == null) return undefined;
  if (typeof meta === 'string') {
    try {
      const parsed = JSON.parse(meta);
      return typeof parsed === 'object' && parsed !== null
        ? (parsed as Record<string, unknown>)
        : undefined;
    } catch {
      return undefined;
    }
  }
  if (typeof meta === 'object') return meta as Record<string, unknown>;
  return undefined;
}

/** True when a metadata object belongs to this add-on. */
function isOwnedByThisImporter(meta: Record<string, unknown> | undefined): boolean {
  return !!meta && meta.importerId === IMPORTER_ID;
}

/**
 * Build a duplicate index from the activities already on the account.
 *
 * Only activities whose `metadata.importerId` === this add-on's id are
 * considered. Other importers' entries (e.g. `revolut-importer`) are ignored,
 * preserving add-on isolation.
 */
export function buildDuplicateIndex(activities: ActivityDetails[]): DuplicateIndex {
  const importedFingerprints = new Set<string>();
  const importedOverlapKeys = new Set<string>();
  for (const activity of activities) {
    const meta = readMetadata(activity);
    if (!isOwnedByThisImporter(meta)) continue;
    const fp = meta?.sourceFingerprint;
    if (typeof fp === 'string' && fp.length > 0) importedFingerprints.add(fp);
    const overlap = meta?.overlapKey;
    if (typeof overlap === 'string' && overlap.length > 0) importedOverlapKeys.add(overlap);
  }
  return { importedFingerprints, importedOverlapKeys };
}

/**
 * Partition prepared drafts into new rows and exact duplicates.
 *
 * A draft whose fingerprint is already in the index is an exact duplicate and
 * is skipped (zero `saveMany` creates for it on re-import).
 */
export function partitionDuplicates<T extends { fingerprint: string }>(
  drafts: T[],
  index: DuplicateIndex,
): { newDrafts: T[]; duplicateFingerprints: string[] } {
  const newDrafts: T[] = [];
  const duplicateFingerprints: string[] = [];
  for (const d of drafts) {
    if (index.importedFingerprints.has(d.fingerprint)) {
      duplicateFingerprints.push(d.fingerprint);
    } else {
      newDrafts.push(d);
    }
  }
  return { newDrafts, duplicateFingerprints };
}
