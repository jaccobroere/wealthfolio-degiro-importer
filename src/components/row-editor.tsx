/**
 * Per-source-row reviewer controls.
 *
 * Lets a reviewer resolve a problem row without leaving the wizard: exclude it
 * from the import, or correct its values in place and watch the pipeline
 * re-classify it live. Nothing is written back to the user's CSV file.
 *
 * Privacy: this is the one place the importer shows raw source values. It is
 * deliberate and user-initiated — the panel only renders for a row the reviewer
 * expanded, and the values shown are the reviewer's own statement. Raw values
 * still never reach summaries, logs, or host metadata.
 */
import { useDeferredValue, useMemo, useState, type ReactElement } from 'react';
import { Button, Input } from '@wealthfolio/ui';
import { Ban, Pencil, RotateCcw, Check, X } from 'lucide-react';

import type { DegiroRow } from '../domain/degiro-row';
import {
  EDITABLE_FIELDS,
  EDITABLE_FIELD_LABELS,
  applyRowPatch,
  normalizePatch,
  type EditableField,
  type RowOverride,
  type RowPatch,
} from '../domain/row-override';
import type { RowPreview } from '../validation/preview-row';

export interface RowEditorProps {
  /** The pristine parsed source row. */
  row: DegiroRow;
  /** The reviewer's current decision for this row, if any. */
  override: RowOverride | undefined;
  /** Set (or clear, with `null`) the decision for this row. */
  onChange: (rowIndex: number, override: RowOverride | null) => void;
  /**
   * Predict the row's terminal outcome if `candidate` were applied. Runs the
   * real pipeline, so it accounts for the row's order-group siblings.
   */
  predict: (rowIndex: number, candidate: RowOverride | null) => RowPreview;
}

export function RowEditor({ row, override, onChange, predict }: RowEditorProps): ReactElement {
  const [draft, setDraft] = useState<RowPatch | null>(null);

  const editing = draft !== null;
  const patch = override?.kind === 'edit' ? override.patch : {};
  const effectiveRow = applyRowPatch(row, editing ? draft : patch);

  // The prediction re-runs the whole batch, so let typing stay ahead of it and
  // the preview catch up a frame later rather than blocking each keystroke.
  const deferredDraft = useDeferredValue(draft);
  const preview = useMemo(
    () =>
      predict(
        row.rowIndex,
        deferredDraft ? { kind: 'edit', patch: deferredDraft } : (override ?? null),
      ),
    [predict, row.rowIndex, deferredDraft, override],
  );

  function startEditing(): void {
    const initial: RowPatch = {};
    for (const f of EDITABLE_FIELDS) initial[f] = effectiveRow[f];
    setDraft(initial);
  }

  function apply(): void {
    if (!draft) return;
    const normalized = normalizePatch(row, draft);
    onChange(row.rowIndex, normalized ? { kind: 'edit', patch: normalized } : null);
    setDraft(null);
  }

  if (override?.kind === 'ignore') {
    return (
      <div className="flex items-center justify-between gap-3 rounded-md border border-border bg-muted/40 p-3">
        <div className="text-sm">
          <span className="font-medium">Row {row.rowIndex} is excluded from this import.</span>
          <span className="text-muted-foreground ml-1">
            It stays counted as a skip so every source row is still accounted for.
          </span>
        </div>
        <Button
          size="sm"
          variant="outline"
          onClick={() => onChange(row.rowIndex, null)}
          data-testid={`row-restore-${row.rowIndex}`}
        >
          <RotateCcw className="h-3.5 w-3.5 mr-1" />
          Restore
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-3 rounded-md border border-border bg-muted/30 p-3">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 text-sm">
        <span className="font-mono text-xs text-muted-foreground">Row {row.rowIndex}</span>
        <span className="font-medium">{effectiveRow.description || '(no description)'}</span>
        <span className="text-muted-foreground font-mono text-xs">
          {effectiveRow.date} {effectiveRow.time}
          {effectiveRow.changeAmountRaw
            ? ` · ${effectiveRow.changeCurrency} ${effectiveRow.changeAmountRaw}`
            : ''}
        </span>
      </div>

      <p
        className={`text-xs ${
          preview.tone === 'ok'
            ? 'text-success'
            : preview.tone === 'skip'
              ? 'text-muted-foreground'
              : 'text-destructive'
        }`}
        data-testid={`row-preview-${row.rowIndex}`}
      >
        {preview.text}
      </p>

      {editing ? (
        <div className="space-y-3">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {EDITABLE_FIELDS.map((f) => (
              <label key={f} className="text-xs space-y-1">
                <span className="text-muted-foreground">{EDITABLE_FIELD_LABELS[f]}</span>
                <Input
                  value={draft[f] ?? ''}
                  onChange={(e) => setDraft({ ...draft, [f]: e.target.value })}
                  className="h-8 text-sm"
                  data-testid={`row-field-${row.rowIndex}-${f}`}
                />
              </label>
            ))}
          </div>
          <div className="flex items-center gap-2">
            <Button size="sm" onClick={apply} data-testid={`row-apply-${row.rowIndex}`}>
              <Check className="h-3.5 w-3.5 mr-1" />
              Apply
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setDraft(null)}
              data-testid={`row-cancel-${row.rowIndex}`}
            >
              <X className="h-3.5 w-3.5 mr-1" />
              Cancel
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          <Button
            size="sm"
            variant="outline"
            onClick={startEditing}
            data-testid={`row-edit-${row.rowIndex}`}
          >
            <Pencil className="h-3.5 w-3.5 mr-1" />
            Edit values
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => onChange(row.rowIndex, { kind: 'ignore' })}
            data-testid={`row-ignore-${row.rowIndex}`}
          >
            <Ban className="h-3.5 w-3.5 mr-1" />
            Ignore row
          </Button>
          {override?.kind === 'edit' ? (
            <Button
              size="sm"
              variant="ghost"
              onClick={() => onChange(row.rowIndex, null)}
              data-testid={`row-revert-${row.rowIndex}`}
            >
              <RotateCcw className="h-3.5 w-3.5 mr-1" />
              Revert to original
            </Button>
          ) : null}
          {override?.kind === 'edit' ? (
            <span className="text-xs text-warning">
              Edited: {Object.keys(override.patch).map(labelOf).join(', ')}
            </span>
          ) : null}
        </div>
      )}
    </div>
  );
}

function labelOf(field: string): string {
  return EDITABLE_FIELD_LABELS[field as EditableField] ?? field;
}
