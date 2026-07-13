/**
 * Account select.
 *
 * Renders the destination account dropdown from `ctx.api.accounts.getAll()`.
 * Pure presentational — receives accounts + selected id + onChange.
 */
import type { ReactElement } from 'react';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@wealthfolio/ui';
import { Landmark } from 'lucide-react';

export interface AccountOption {
  id: string;
  name: string;
  currency: string;
}

export interface AccountSelectProps {
  accounts: AccountOption[];
  accountId: string | null;
  onChange: (accountId: string) => void;
}

export function AccountSelect({ accounts, accountId, onChange }: AccountSelectProps): ReactElement {
  if (accounts.length === 0) {
    return (
      <p className="text-sm text-muted-foreground" data-testid="no-accounts">
        No accounts available. Ensure the addon has the <code>accounts.getAll</code> permission.
      </p>
    );
  }

  return (
    <div className="space-y-2">
      <label className="text-sm font-medium flex items-center gap-1.5">
        <Landmark className="h-4 w-4" />
        Destination account
      </label>
      <Select value={accountId ?? ''} onValueChange={onChange}>
        <SelectTrigger data-testid="account-select-trigger">
          <SelectValue placeholder="Select an account…" />
        </SelectTrigger>
        <SelectContent>
          {accounts.map((a) => (
            <SelectItem key={a.id} value={a.id}>
              {a.name} ({a.currency})
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
