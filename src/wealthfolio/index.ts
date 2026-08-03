/**
 * Public surface of the DEGIRO Wealthfolio adapter layer.
 *
 * The conversion boundary (`convert-activity.ts`) is the only module that
 * imports `@wealthfolio/addon-sdk` activity types at runtime; the other
 * modules import SDK *types* for signatures only.
 */
export type {
  ActivityMetadataV1,
  ConvertedImport,
  ImportChunkResult,
  ImportFlowResult,
  PreparedDraft,
} from './types';
export { IMPORTER_ID, IMPORTER_VERSION, SOURCE_SCHEMA_VERSION, SOURCE_TYPE } from './types';
export {
  buildMetadata,
  toActivityCreate,
  toActivityImport,
  toSdkActivityType,
} from './convert-activity';
export {
  getAllAccounts,
  getActivities,
  checkImport,
  importCheckedActivities,
  saveCreates,
  getImportMapping,
  saveImportMapping,
  searchTicker,
} from './api';
export type { ActivityCreate } from './api';
export { buildDuplicateIndex, partitionDuplicates } from './duplicate-index';
export type { DuplicateIndex } from './duplicate-index';
export {
  identityToAsset,
  readSavedMappings,
  resolveSymbol,
  resultToIdentity,
  withSavedMapping,
} from './symbol-mappings';
export type { CanonicalIdentity, ResolutionOutcome } from './symbol-mappings';
export { DEFAULT_IMPORT_CHUNK_SIZE, prepareDrafts, runImport } from './import';
export type { RunImportOptions } from './import';
