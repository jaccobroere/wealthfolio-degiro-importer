/**
 * Upload step (T07, step 1/4).
 *
 * Browser `<input type="file">` + `FileReader`. Validates the schema via the
 * pure-core strict detector (`parseAndMap`). Displays row count + date range
 * only — never raw rows, balances, products, or order ids.
 *
 * Uses a browser file input + FileReader only; it does not call the host file
 * picker API. On invalid schema → actionable error, stay on upload.
 */
import { useRef, useState, type ChangeEvent, type ReactElement } from 'react';
import { Button } from '@wealthfolio/ui';
import { AlertCircle, Upload, FileText, CheckCircle2 } from 'lucide-react';

import { parseAndMapWithFingerprints } from '../parser/parse-and-map';
import { DegiroCsvError } from '../parser/parse-csv';
import { computeUploadSummary } from '../state/import-state';
import type { UploadSummary } from '../state/import-state';
import type { PipelineResultWithFingerprints } from '../parser/parse-and-map';

export interface UploadStepProps {
  /** Called when a file parses successfully. */
  onParsed: (pipeline: PipelineResultWithFingerprints, summary: UploadSummary) => void;
  /** Current upload error (from state), or null. */
  uploadError: string | null;
  /** Current upload summary (from state), or null. */
  uploadSummary: UploadSummary | null;
}

export function UploadStep({
  onParsed,
  uploadError,
  uploadSummary,
}: UploadStepProps): ReactElement {
  const inputRef = useRef<HTMLInputElement>(null);
  const [localError, setLocalError] = useState<string | null>(null);
  const [parsing, setParsing] = useState(false);

  const error = localError ?? uploadError;

  async function handleFile(e: ChangeEvent<HTMLInputElement>): Promise<void> {
    const file = e.target.files?.[0];
    if (!file) return;
    setLocalError(null);
    setParsing(true);
    try {
      const text = await readTextFile(file);
      const pipeline = await parseAndMapWithFingerprints(text);
      const summary = computeUploadSummary(pipeline);
      onParsed(pipeline, summary);
    } catch (err) {
      if (err instanceof DegiroCsvError) {
        setLocalError(err.message);
      } else {
        setLocalError(err instanceof Error ? err.message : 'Failed to parse the CSV file');
      }
    } finally {
      setParsing(false);
      // Reset the input so the same file can be re-selected.
      if (inputRef.current) inputRef.current.value = '';
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold">Step 1 — Upload DEGIRO statement</h2>
        <p className="text-sm text-muted-foreground mt-1">
          Select a DEGIRO account-statement CSV export. The file is parsed locally in your browser;
          nothing is uploaded.
        </p>
      </div>

      <div
        className="border-2 border-dashed border-border rounded-lg p-8 text-center cursor-pointer hover:border-primary/50 transition-colors"
        onClick={() => inputRef.current?.click()}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            inputRef.current?.click();
          }
        }}
        role="button"
        tabIndex={0}
      >
        <input
          ref={inputRef}
          type="file"
          accept=".csv,text/csv"
          onChange={handleFile}
          className="hidden"
          data-testid="file-input"
        />
        <Upload className="mx-auto h-10 w-10 text-muted-foreground mb-3" />
        <p className="text-sm font-medium">{parsing ? 'Parsing…' : 'Click to select a CSV file'}</p>
        <p className="text-xs text-muted-foreground mt-1">Dutch or English 12-column export</p>
      </div>

      {error ? (
        <div className="flex items-start gap-2 rounded-md border border-destructive/50 bg-destructive/10 p-3">
          <AlertCircle className="h-5 w-5 text-destructive shrink-0 mt-0.5" />
          <div>
            <p className="text-sm font-medium text-destructive">Could not parse this file</p>
            <p className="text-sm text-muted-foreground mt-0.5">{error}</p>
          </div>
        </div>
      ) : null}

      {uploadSummary && !error ? (
        <div className="flex items-start gap-2 rounded-md border border-success/50 bg-success/10 p-3">
          <CheckCircle2 className="h-5 w-5 text-success shrink-0 mt-0.5" />
          <div className="space-y-1">
            <p className="text-sm font-medium">File parsed successfully</p>
            <div className="flex flex-wrap gap-4 text-sm text-muted-foreground">
              <span className="flex items-center gap-1">
                <FileText className="h-4 w-4" />
                {uploadSummary.rowCount} rows
              </span>
              <span>Header: {uploadSummary.headerVariant}</span>
              {uploadSummary.minDate && uploadSummary.maxDate ? (
                <span>
                  Date range: {formatDate(uploadSummary.minDate)} →{' '}
                  {formatDate(uploadSummary.maxDate)}
                </span>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}

      <div className="flex justify-end">
        <Button
          disabled={!uploadSummary || !!error}
          onClick={() => onParsed(null as never, null as never)}
          data-testid="upload-continue"
          style={{ display: 'none' }}
        >
          Continue
        </Button>
      </div>
    </div>
  );
}

/** Read a File as text via FileReader (no `files` permission needed). */
function readTextFile(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') resolve(reader.result);
      else reject(new Error('FileReader did not return text'));
    };
    reader.onerror = () => reject(reader.error ?? new Error('FileReader error'));
    reader.readAsText(file);
  });
}

/** Format an ISO timestamp as a short date (privacy-safe: date only, no time). */
function formatDate(iso: string): string {
  return iso.slice(0, 10);
}
