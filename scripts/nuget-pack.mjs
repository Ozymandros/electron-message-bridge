/**
 * Builds .nupkg files from packaging/nuget/*.nuspec using the NuGet CLI (nuget.exe).
 * No .NET project files — install NuGet from https://www.nuget.org/downloads
 * or set NUGET_EXE to the full path of nuget.exe.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = join(root, 'artifacts', 'nuget');
const nuspecs = [
  join(root, 'packaging', 'nuget', 'electron-ipc-helper.nuspec'),
  join(root, 'packaging', 'nuget', 'electron-ipc-helper.adapter.assemblyscript.nuspec'),
];

mkdirSync(outDir, { recursive: true });

const wingetNugetPath = join(
  process.env.LOCALAPPDATA || '',
  'Microsoft',
  'WinGet',
  'Packages',
  'Microsoft.NuGet_Microsoft.Winget.Source_8wekyb3d8bbwe',
  'nuget.exe',
);

const nugetExe = process.env.NUGET_EXE?.trim() || (existsSync(wingetNugetPath) ? wingetNugetPath : 'nuget');

function pack(specPath) {
  const args = [
    'pack',
    specPath,
    '-OutputDirectory',
    outDir,
    '-NonInteractive',
  ];
  const result = spawnSync(nugetExe, args, { encoding: 'utf8' });
  if (result.error?.code === 'ENOENT') {
    console.error(
      `NuGet CLI not found (${nugetExe}). Install: https://www.nuget.org/downloads\n` +
        'Or set NUGET_EXE to the full path of nuget.exe.',
    );
    process.exit(1);
  }
  if (result.status !== 0) {
    if (result.stdout) process.stdout.write(result.stdout);
    if (result.stderr) process.stderr.write(result.stderr);
    process.exit(result.status ?? 1);
  }
}

if (process.env.NUGET_EXE && !existsSync(nugetExe)) {
  console.error(`NUGET_EXE does not exist: ${nugetExe}`);
  process.exit(1);
}

for (const spec of nuspecs) {
  if (!existsSync(spec)) {
    console.error(`Missing nuspec: ${spec}`);
    process.exit(1);
  }
  pack(spec);
}

console.log(`\n.nupkg output: ${outDir}`);
