#!/usr/bin/env node
/**
 * CLI entry point for create-electron-ipc-app.
 *
 * Usage:
 *   npx create-electron-ipc-app <project-name> [options]
 *   npx create-electron-ipc-app my-app --template full --yes
 */

import { Command } from 'commander';
import pc from 'picocolors';
import { resolve } from 'node:path';
import { scaffold } from './scaffold.js';
import { listTemplates, getTemplate } from './templates.js';
import type { TemplateSlug } from './templates.js';

const VALID_SLUGS = ['minimal', 'full'] as TemplateSlug[];

const program = new Command();

program
  .name('create-electron-ipc-app')
  .description('Scaffold a new Electron app powered by electron-ipc-helper')
  .version('0.1.0')
  .argument('[project-name]', 'Name of the project directory to create')
  .option('-t, --template <slug>', 'Template to use: minimal | full', 'minimal')
  .option('-d, --dir <path>', 'Output directory (defaults to <project-name>)')
  .option('-y, --yes', 'Skip confirmation prompts (non-interactive mode)', false)
  .action(async (projectName: string | undefined, options: {
    template: string;
    dir?: string;
    yes: boolean;
  }) => {
    printBanner();

    // ── Resolve project name ──────────────────────────────────────────────────
    const resolvedName = projectName ?? await promptProjectName(options.yes);
    if (!resolvedName) {
      console.error(pc.red('✖  No project name provided. Aborting.'));
      process.exit(1);
    }

    // ── Validate template ─────────────────────────────────────────────────────
    const templateSlug = options.template as TemplateSlug;
    if (!VALID_SLUGS.includes(templateSlug)) {
      console.error(pc.red(`✖  Unknown template "${templateSlug}". Valid options: ${VALID_SLUGS.join(', ')}`));
      listAvailableTemplates();
      process.exit(1);
    }

    const template = getTemplate(templateSlug)!;

    // ── Resolve output directory ──────────────────────────────────────────────
    const outputDir = resolve(options.dir ?? resolvedName);

    // ── Summary ───────────────────────────────────────────────────────────────
    console.log('');
    console.log(pc.bold('Creating project:'));
    console.log(`  ${pc.cyan('Name')}:      ${resolvedName}`);
    console.log(`  ${pc.cyan('Template')}: ${template.label} — ${template.description}`);
    console.log(`  ${pc.cyan('Output')}:   ${outputDir}`);
    console.log('');

    if (!options.yes) {
      const confirmed = await confirm('Proceed?');
      if (!confirmed) {
        console.log(pc.yellow('Aborted.'));
        process.exit(0);
      }
    }

    // ── Scaffold ──────────────────────────────────────────────────────────────
    try {
      const result = await scaffold({
        outputDir,
        template,
        projectName: resolvedName,
        nonInteractive: options.yes,
      });

      console.log('');
      console.log(pc.green('✔  Project scaffolded successfully!'));
      console.log('');
      console.log(pc.bold('Files created:'));
      for (const f of result.files) {
        console.log(`  ${pc.dim('+')} ${f}`);
      }
      console.log('');
      printNextSteps(resolvedName, outputDir);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(pc.red(`✖  Scaffold failed: ${message}`));
      process.exit(1);
    }
  });

program.parse();

// ─── Helpers ──────────────────────────────────────────────────────────────────

function printBanner(): void {
  console.log('');
  console.log(pc.bold(pc.cyan('create-electron-ipc-app')));
  console.log(pc.dim('Scaffold a typed, zero-boilerplate Electron app'));
  console.log('');
}

function listAvailableTemplates(): void {
  console.log('');
  console.log(pc.bold('Available templates:'));
  for (const tmpl of listTemplates()) {
    console.log(`  ${pc.cyan(tmpl.slug.padEnd(10))} — ${tmpl.description}`);
  }
}

function printNextSteps(name: string, outputDir: string): void {
  console.log(pc.bold('Next steps:'));
  console.log('');
  console.log(`  ${pc.dim('$')} cd ${outputDir}`);
  console.log(`  ${pc.dim('$')} npm install`);
  console.log(`  ${pc.dim('$')} npm run build`);
  console.log(`  ${pc.dim('$')} npm start`);
  console.log('');
  console.log(pc.dim(`Docs: https://github.com/your-org/electron-ipc-helper/docs`));
  console.log('');
  void name;
}

async function promptProjectName(nonInteractive: boolean): Promise<string | null> {
  if (nonInteractive) return null;

  // Simple readline prompt (no external dep)
  const { createInterface } = await import('node:readline');
  return new Promise((resolve) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    rl.question(pc.bold('Project name: '), (answer) => {
      rl.close();
      resolve(answer.trim() || null);
    });
  });
}

async function confirm(message: string): Promise<boolean> {
  const { createInterface } = await import('node:readline');
  return new Promise((resolve) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    rl.question(`${pc.bold(message)} ${pc.dim('(y/N) ')}`, (answer) => {
      rl.close();
      resolve(answer.trim().toLowerCase() === 'y');
    });
  });
}
