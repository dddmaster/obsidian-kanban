import { App, TFile, TFolder, Vault } from 'obsidian';
import {
  getDailyNoteSettings,
  getDateFromFile,
} from 'obsidian-daily-notes-interface';
import { KanbanSettings } from './Settings';

export function gotoNextDailyNote(app: App, file: TFile) {
  const date = getDateFromFile(file, 'day');

  if (!date || !date.isValid()) {
    return;
  }

  const dailyNotePlugin = (app as any).internalPlugins.plugins['daily-notes']
    .instance;

  dailyNotePlugin.gotoNextExisting(date);
}

export function gotoPrevDailyNote(app: App, file: TFile) {
  const date = getDateFromFile(file, 'day');

  if (!date || !date.isValid()) {
    return;
  }

  const dailyNotePlugin = (app as any).internalPlugins.plugins['daily-notes']
    .instance;

  dailyNotePlugin.gotoPreviousExisting(date);
}

export function buildLinkToDailyNote(app: App, dateStr: string) {
  const dailyNoteSettings = getDailyNoteSettings();
  const shouldUseMarkdownLinks = !!(app.vault as any).getConfig(
    'useMarkdownLinks'
  );

  if (shouldUseMarkdownLinks) {
    return `[${dateStr}](${
      dailyNoteSettings.folder
        ? `${encodeURIComponent(dailyNoteSettings.folder)}/`
        : ''
    }${encodeURIComponent(dateStr)}.md)`;
  }

  return `[[${dateStr}]]`;
}

export function hasFrontmatterKeyRaw(data: string) {
  if (!data) return false;

  const match = data.match(/---\s+([\w\W]+?)\s+---/);

  if (!match) {
    return false;
  }

  if (!match[1].contains('kanban-plugin')) {
    return false;
  }

  return true;
}

export function hasFrontmatterKey(file: TFile) {
  if (!file) return false;

  const cache = app.metadataCache.getFileCache(file);

  return !!cache?.frontmatter && !!cache?.frontmatter['kanban-plugin'];
}

export function laneTitleWithMaxItems(title: string, maxItems?: number) {
  if (!maxItems) return title;
  return `${title} (${maxItems})`;
}

/**
 * Sets visibility of element identified by path.
 *
 * @param path
 * @param visibility
 * @returns
 */
export function setPathVisibility(path: string, visibility: boolean): void {
  const elem = document
    .querySelector(`[data-path="${path}"]`)
    ?.closest('.nav-folder');

  if (!elem) {
    return;
  }

  if (elem.classList.contains('kanban-plugin__hide-folder') == visibility) {
    elem.classList.toggle('kanban-plugin__hide-folder');
  }
}

/**
 * Updates visibility of all kanban notes folder according to current settings.
 *
 * @param {App} app
 */
export function updatePathVisibility(
  app: App,
  settings: KanbanSettings,
  overwrite: boolean | null = null
): void {
  const folder = app.vault.getRoot();
  Vault.recurseChildren(folder as TFolder, (f) => {
    if (
      f instanceof TFolder &&
      f.name == settings['kanban-notes-folder-name']
    ) {
      setPathVisibility(
        f.path,
        overwrite != null ? !overwrite : !settings['hide-kanban-notes-folder']
      );
    }
  });
}
