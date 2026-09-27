/**
 * Serialize read-modify-write operations on Wealthfolio's account mapping
 * document. The host saves the entire document, so concurrent writers can
 * otherwise restore mappings that a later action removed.
 */
import type { HostAPI, ImportMappingData } from '@wealthfolio/addon-sdk';

export class MappingPersistence {
  private tail: Promise<void> = Promise.resolve();

  constructor(
    private readonly api: HostAPI,
    private readonly contextKind: string,
  ) {}

  update(
    accountId: string,
    change: (mapping: ImportMappingData) => ImportMappingData,
  ): Promise<ImportMappingData> {
    return this.enqueue(async () => {
      const current = await this.api.activities.getImportMapping(accountId, this.contextKind);
      const updated = change(current);
      return this.api.activities.saveImportMapping(updated);
    });
  }

  updateAndRead(
    accountId: string,
    change: (mapping: ImportMappingData) => ImportMappingData,
  ): Promise<ImportMappingData> {
    return this.enqueue(async () => {
      const current = await this.api.activities.getImportMapping(accountId, this.contextKind);
      const updated = change(current);
      await this.api.activities.saveImportMapping(updated);
      return this.api.activities.getImportMapping(accountId, this.contextKind);
    });
  }

  private enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.tail.then(operation);
    this.tail = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }
}
