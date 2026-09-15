/**
 * Single-row outcome preview for the review-step editor.
 *
 * Pure core: no React, no `Wealthfolio addon SDK`.
 *
 * Answers "what will the pipeline do with this row?" by running the real
 * pipeline and reading the row's actual outcome — never by re-deriving the
 * routing rules. A row's fate depends on its siblings (a fee merges into its
 * order group, but is skipped as an orphan when no trade shares its order id; a
 * group whose fills sum to zero quantity skips every row in it), so anything
 * that inspects the row alone will confidently mispredict those cases, and a
 * reviewer who trusts it edits until the preview looks right and imports
 * nothing.
 */

import { buildBatch } from './validate-batch';
import type { DegiroRow } from '../domain/degiro-row';
import type { RowOutcome } from '../domain/import-outcome';
import type { ActivityDraft } from '../domain/activity-draft';
import type { RowOverride, RowOverrides } from '../domain/row-override';

export interface RowPreview {
  tone: 'ok' | 'skip' | 'bad';
  text: string;
}

/**
 * Predict what the pipeline will do with one row if `candidate` were applied.
 *
 * `candidate` is the decision being previewed (`null` = no decision for this
 * row); every other active override is kept, so the preview reflects the batch
 * the reviewer would actually get.
 */
export function previewRowOutcome(
  rows: readonly DegiroRow[],
  overrides: RowOverrides,
  rowIndex: number,
  candidate: RowOverride | null,
): RowPreview {
  const merged: Record<number, RowOverride> = { ...overrides };
  if (candidate) merged[rowIndex] = candidate;
  else delete merged[rowIndex];

  const batch = buildBatch([...rows], merged);
  const outcome = batch.outcomes.find((o) => o.rowIndex === rowIndex);
  const activity =
    outcome && (outcome.kind === 'activity' || outcome.kind === 'group-member')
      ? batch.activities[outcome.activityIndex]
      : undefined;
  return describeOutcome(outcome, activity);
}

/** Render a terminal outcome as one line for the reviewer. */
export function describeOutcome(
  outcome: RowOutcome | undefined,
  activity: ActivityDraft | undefined,
): RowPreview {
  if (!outcome) {
    return { tone: 'bad', text: 'No outcome for this row' };
  }
  switch (outcome.kind) {
    case 'invalid':
      return { tone: 'bad', text: `Invalid — ${outcome.reason}` };
    case 'unsupported':
      return { tone: 'bad', text: 'Not recognized — this row still blocks the import' };
    case 'known-skip':
      return {
        tone: 'skip',
        text:
          outcome.reason === 'user-ignored'
            ? 'Excluded by you — will not be imported'
            : `Skipped — ${outcome.reason} (will not be imported)`,
      };
    case 'activity':
      return {
        tone: 'ok',
        text: `Recognized as ${activity?.activityType ?? 'an activity'} — will be imported`,
      };
    case 'group-member':
      return {
        tone: 'ok',
        text: `Recognized as ${outcome.role} — merged into ${
          activity ? `a ${activity.activityType}` : 'its order group'
        }`,
      };
  }
}
