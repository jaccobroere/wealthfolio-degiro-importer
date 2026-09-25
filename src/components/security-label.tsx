/**
 * How a DEGIRO instrument will appear in Wealthfolio: the reviewed ticker and
 * exchange first, then the statement's product name and ISIN for
 * cross-checking. Falls back to the source identifier while unresolved.
 */
import type { ReactElement } from 'react';

import type { ResolvedSecurity } from '../state/import-state';

export interface SecurityLabelProps {
  /** Source identifier (ISIN or product) from the statement. */
  source: string;
  isin?: string;
  name?: string;
  resolved?: ResolvedSecurity;
}

export function SecurityLabel({ source, isin, name, resolved }: SecurityLabelProps): ReactElement {
  return (
    <span className="inline-flex flex-col min-w-0" data-testid="security-label">
      <span className="font-mono text-xs">
        {resolved ? (
          <>
            <span className="font-semibold">{resolved.symbol}</span>
            {resolved.exchangeMic ? (
              <span className="text-muted-foreground"> · {resolved.exchangeMic}</span>
            ) : null}
          </>
        ) : (
          <span className="text-destructive" title="No Wealthfolio security selected yet">
            {source} (unmapped)
          </span>
        )}
      </span>
      {name || (resolved && isin) ? (
        <span className="text-muted-foreground text-xs truncate max-w-[22rem]">
          {name}
          {resolved && isin ? (
            <span className="font-mono">
              {name ? ' · ' : ''}
              {isin}
            </span>
          ) : null}
        </span>
      ) : null}
    </span>
  );
}
