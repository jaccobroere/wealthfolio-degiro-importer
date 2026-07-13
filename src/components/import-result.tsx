/**
 * Import result.
 *
 * Shows the outcome of `saveMany({ creates })`: created count, skipped
 * duplicates, blocked rows, and any fatal error. Offers a reset to start
 * over.
 */
import type { ReactElement } from 'react';
import { Button, Badge } from '@wealthfolio/ui';
import { CheckCircle2, AlertCircle, RotateCcw } from 'lucide-react';
import type { ImportResultSummary } from '../state/import-state';

export interface ImportResultProps {
  result: ImportResultSummary;
  onReset: () => void;
}

export function ImportResult({ result, onReset }: ImportResultProps): ReactElement {
  const hasFatal = !!result.fatal;
  const hasFailures = result.failed > 0;

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold">Import complete</h2>
        <p className="text-sm text-muted-foreground mt-1">
          The import flow has finished. Review the summary below.
        </p>
      </div>

      {hasFatal ? (
        <div className="flex items-start gap-2 rounded-md border border-destructive/50 bg-destructive/10 p-3">
          <AlertCircle className="h-5 w-5 text-destructive shrink-0 mt-0.5" />
          <div>
            <p className="text-sm font-medium text-destructive">Fatal error</p>
            <p className="text-sm text-muted-foreground mt-0.5">{result.fatal}</p>
          </div>
        </div>
      ) : (
        <div className="flex items-start gap-2 rounded-md border border-success/50 bg-success/10 p-3">
          <CheckCircle2 className="h-5 w-5 text-success shrink-0 mt-0.5" />
          <p className="text-sm font-medium">
            {result.created} activity(ies) created successfully.
          </p>
        </div>
      )}

      <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-sm">
        <Stat label="Attempted" value={result.attempted} />
        <Stat label="Created" value={result.created} />
        <Stat label="Skipped duplicates" value={result.skippedDuplicates} />
        <Stat label="Blocked" value={result.blocked} />
      </div>

      {hasFailures ? (
        <div className="flex items-center gap-2">
          <Badge variant="warning">{result.failed} failed</Badge>
          <span className="text-sm text-muted-foreground">
            Some activities were not created. See the host for details.
          </span>
        </div>
      ) : null}

      <div className="flex justify-end">
        <Button onClick={onReset} data-testid="reset-button">
          <RotateCcw className="h-4 w-4 mr-1" />
          Start over
        </Button>
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number }): ReactElement {
  return (
    <div className="border border-border rounded px-2 py-1.5">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="font-mono">{value}</p>
    </div>
  );
}
