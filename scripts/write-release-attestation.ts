import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';

const packageJson = JSON.parse(readFileSync('package.json', 'utf8')) as {
  name: string;
  version: string;
};
const commit = process.env.RELEASE_COMMIT;
if (!commit || !/^[0-9a-f]{40}$/.test(commit))
  throw new Error('RELEASE_COMMIT must be a full commit SHA.');
if (process.env.LOCAL_ACCEPTANCE_PASSED !== 'true' || process.env.DISPOSABLE_HOST_PASSED !== 'true')
  throw new Error('Both release gates must be explicitly marked true.');
const zip = `artifacts/${packageJson.name}-${packageJson.version}.zip`;
const sha256 = createHash('sha256').update(readFileSync(zip)).digest('hex');
mkdirSync('release', { recursive: true });
writeFileSync(
  'release/attestation.json',
  `${JSON.stringify(
    {
      repository: packageJson.name,
      version: packageJson.version,
      releaseCommit: commit,
      zipFilename: zip.slice('artifacts/'.length),
      zipSha256: sha256,
      localAcceptancePassed: true,
      disposableHostTestsPassed: true,
    },
    null,
    2,
  )}\n`,
);
