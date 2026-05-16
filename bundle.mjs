import { copyFileSync, createWriteStream } from 'fs';
import { execSync } from 'child_process';

copyFileSync('manifest.json', 'dist/manifest.json');

// Simple zip using PowerShell on Windows
execSync(
  'powershell -Command "Compress-Archive -Path dist\\* -DestinationPath degiro-importer.zip -Force"',
);
console.log('Created degiro-importer.zip');
