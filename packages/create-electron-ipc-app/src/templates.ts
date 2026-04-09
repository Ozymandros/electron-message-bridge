/**
 * Template definitions for create-electron-ipc-app.
 *
 * Each template is identified by its slug and carries metadata about:
 * - Which optional modules it includes
 * - Its target audience
 * - The list of source files to generate
 */

export type TemplateSlug = 'minimal' | 'full';

export interface TemplateModule {
  menus: boolean;
  lifecycle: boolean;
  plugins: boolean;
  appkit: boolean;
}

export interface TemplateDefinition {
  slug: TemplateSlug;
  label: string;
  description: string;
  modules: TemplateModule;
}

export const TEMPLATES: Record<TemplateSlug, TemplateDefinition> = {
  minimal: {
    slug: 'minimal',
    label: 'Minimal',
    description: 'Core IPC (main + preload + renderer). No menus, lifecycle, or plugins.',
    modules: {
      menus: false,
      lifecycle: false,
      plugins: false,
      appkit: false,
    },
  },
  full: {
    slug: 'full',
    label: 'Full-featured',
    description: 'All modules: IPC, events, menus, lifecycle, plugins, appkit.',
    modules: {
      menus: true,
      lifecycle: true,
      plugins: true,
      appkit: true,
    },
  },
};

export function getTemplate(slug: string): TemplateDefinition | undefined {
  return TEMPLATES[slug as TemplateSlug];
}

export function listTemplates(): TemplateDefinition[] {
  return Object.values(TEMPLATES);
}
