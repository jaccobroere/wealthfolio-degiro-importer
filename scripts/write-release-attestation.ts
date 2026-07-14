import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';

const packageJson = JSON.parse(readFileSync('package.json', 'utf8')) as {
  name: string;
  version: string;
};
if (process.env.LOCAL_ACCEPTANCE_PASSED !== 'true' || process.env.DISPOSABLE_HOST_PASSED !== 'true')
  throw new Error('Both release gates must be explicitly marked true.');
const zipFilename = `${packageJson.name}-${packageJson.version}.zip`;
mkdirSync('release', { recursive: true });
writeFileSync(
  'release/attestation.json',
  `${JSON.stringify(
    {
      repository: packageJson.name,
      version: packageJson.version,
      zipFilename,
      localAcceptancePassed: true,
      disposableHostTestsPassed: true,
    },
    null,
    2,
  )}\n`,
);