import {
  Plugin,
  WorkspaceLeaf,
  TFile,
  TFolder,
  ViewState,
  MarkdownView,
  Menu,
  Notice,
} from "obsidian";
import { around } from "monkey-around";

import { kanbanIcon, KanbanView, kanbanViewType } from "./KanbanView";
import { DragDropApp } from "./DragDropApp";
import { frontMatterKey } from "./parser";
import { KanbanSettings, KanbanSettingsTab } from "./Settings";
import ReactDOM from "react-dom";

// import { KanbanEmbed } from "./KanbanEmbed";

import "choices.js/public/assets/styles/choices.css";
import "flatpickr/dist/flatpickr.min.css";
import "./main.css";
import { t } from "./lang/helpers";

export default class KanbanPlugin extends Plugin {
  settingsTab: KanbanSettingsTab;
  settings: KanbanSettings = {};
  kanbanFileModes: { [file: string]: string } = {};
  dbTimers: { [id: string]: number } = {};
  hasSet: { [id: string]: boolean } = {};
  appEl: HTMLDivElement;

  async onload() {
    const self = this;

    await this.loadSettings();

    this.settingsTab = new KanbanSettingsTab(
      this.app,
      this,
      {
        onSettingsChange: async (newSettings) => {
          this.settings = newSettings;
          await this.saveSettings();

          // Force a complete re-render when settings change
          this.app.workspace.getLeavesOfType(kanbanViewType).forEach((leaf) => {
            const view = leaf.view as KanbanView;
            view.setViewData(view.data, true);
          });
        },
      },
      this.settings
    );

    this.addSettingTab(this.settingsTab);

    // @ts-ignore
    this.app.workspace.registerHoverLinkSource(frontMatterKey, {
      display: "Kanban",
      defaultMod: true,
    });

    // TODO: embedded kanban:
    // this.registerMarkdownPostProcessor((el, ctx) => {
    //   if (ctx.frontmatter && ctx.frontmatter[frontMatterKey]) {
    //     clearTimeout(this.dbTimers[ctx.docId]);

    //     this.dbTimers[ctx.docId] = window.setTimeout(() => {
    //       delete this.dbTimers[ctx.docId];

    //       if (!el.parentNode) return;

    //       const container = el.closest(".markdown-embed-content");

    //       if (container) {
    //         container.empty();
    //         ctx.addChild(
    //           new KanbanEmbed(ctx.sourcePath, container as HTMLElement)
    //         );
    //       }
    //     }, 50);
    //   }
    // });

    // Monkey patch WorkspaceLeaf to open Kanbans with KanbanView by default
    this.register(
      around(WorkspaceLeaf.prototype, {
        // Kanbans can be viewed as markdown or kanban, and we keep track of the mode
        // while the file is open. When the file closes, we no longer need to keep track of it.
        detach(next) {
          return function () {
            const state = this.view?.getState();

            if (state?.file && self.kanbanFileModes[this.id || state.file]) {
              delete self.kanbanFileModes[this.id || state.file];
            }

            return next.apply(this);
          };
        },

        setViewState(next) {
          return function (state: ViewState, ...rest: any[]) {
            if (
              // If we have a markdown file
              state.type === "markdown" &&
              state.state?.file &&
              // And the current mode of the file is not set to markdown
              self.kanbanFileModes[this.id || state.state.file] !== "markdown"
            ) {
              // Then check for the kanban frontMatterKey
              const cache = self.app.metadataCache.getCache(state.state.file);

              if (cache?.frontmatter && cache.frontmatter[frontMatterKey]) {
                // If we have it, force the view type to kanban
                const newState = {
                  ...state,
                  type: kanbanViewType,
                };

                self.kanbanFileModes[state.state.file] = kanbanViewType;

                return next.apply(this, [newState, ...rest]);
              }
            }

            return next.apply(this, [state, ...rest]);
          };
        },
      })
    );

    // Add a menu item to go back to kanban view
    this.register(
      around(MarkdownView.prototype, {
        onMoreOptionsMenu(next) {
          return function (menu: Menu) {
            const file = this.file;
            const cache = file
              ? self.app.metadataCache.getFileCache(file)
              : null;

            if (
              !file ||
              !cache?.frontmatter ||
              !cache.frontmatter[frontMatterKey]
            ) {
              return next.call(this, menu);
            }

            menu
              .addItem((item) => {
                item
                  .setTitle(t("Open as kanban board"))
                  .setIcon(kanbanIcon)
                  .onClick(() => {
                    self.kanbanFileModes[this.leaf.id || file.path] =
                      kanbanViewType;
                    self.setKanbanView(this.leaf);
                  });
              })
              .addSeparator();

            next.call(this, menu);
          };
        },
      })
    );

    this.registerView(kanbanViewType, (leaf) => new KanbanView(leaf, this));

    this.addCommand({
      id: "create-new-kanban-board",
      name: t("Create new board"),
      callback: () => this.newKanban(),
    });

    this.app.workspace.onLayoutReady(() => {
      this.register(
        around((this.app as any).commands.commands["editor:open-search"], {
          checkCallback(next) {
            return function (isChecking: boolean) {
              if (isChecking) {
                return next.call(this, isChecking);
              }
              const view = self.app.workspace.getActiveViewOfType(KanbanView);

              if (view) {
                view.toggleSearch();
              } else {
                next.call(this, false);
              }
            };
          },
        })
      );
    });

    this.addCommand({
      id: "archive-completed-cards",
      name: t("Archive completed cards in active board"),
      checkCallback: (checking) => {
        const activeView = this.app.workspace.activeLeaf.view;

        if (checking) {
          return activeView && activeView instanceof KanbanView;
        }

        if (activeView instanceof KanbanView) {
          activeView.archiveCompletedCards();
        }
      },
    });

    this.addCommand({
      id: "toggle-kanban-view",
      name: t("Toggle between Kanban and markdown mode"),
      checkCallback: (checking) => {
        const activeFile = this.app.workspace.getActiveFile();

        if (checking) {
          if (!activeFile) {
            return false;
          }

          const fileCache = this.app.metadataCache.getFileCache(activeFile);

          return (
            fileCache.frontmatter && !!fileCache.frontmatter[frontMatterKey]
          );
        }

        const activeLeaf = this.app.workspace.activeLeaf;

        if (activeLeaf.view instanceof KanbanView) {
          this.kanbanFileModes[(activeLeaf as any).id || activeFile.path] =
            "markdown";
          this.setMarkdownView(activeLeaf);
        } else {
          this.kanbanFileModes[(activeLeaf as any).id || activeFile.path] =
            kanbanViewType;
          this.setKanbanView(activeLeaf);
        }
      },
    });

    this.addCommand({
      id: "convert-to-kanban",
      name: t("Convert empty note to Kanban"),
      checkCallback: (checking) => {
        const activeFile = this.app.workspace.getActiveFile();

        if (checking) {
          return activeFile && activeFile.stat.size === 0;
        }

        const activeLeaf = this.app.workspace.activeLeaf;

        if (activeFile && activeFile.stat.size === 0) {
          const frontmatter = [
            "---",
            "",
            `${frontMatterKey}: basic`,
            "",
            "---",
            "",
            "",
          ].join("\n");

          this.app.vault.modify(activeFile, frontmatter).then(() => {
            this.setKanbanView(activeLeaf);
          });
        }
      },
    });

    this.registerEvent(
      this.app.workspace.on("file-menu", (menu, file: TFile, source, leaf) => {
        // Add a menu item to the folder context menu to create a board
        if (file instanceof TFolder) {
          menu.addItem((item) => {
            item
              .setTitle(t("New kanban board"))
              .setIcon(kanbanIcon)
              .onClick(() => this.newKanban(file));
          });
        }
      })
    );

    this.registerEvent(
      this.app.metadataCache.on("changed", (file) => {
        this.app.workspace.getLeavesOfType(kanbanViewType).forEach((leaf) => {
          const view = leaf.view as KanbanView;
          view.onFileMetadataChange(file);
        });
      })
    );
  }

  refreshViews() {
    ReactDOM.render(
      DragDropApp(this.app),
      this.appEl ?? (this.appEl = document.body.createDiv())
    );
  }

  async setMarkdownView(leaf: WorkspaceLeaf) {
    await leaf.setViewState({
      type: "markdown",
      state: leaf.view.getState(),
      popstate: true,
    } as ViewState);
  }

  async setKanbanView(leaf: WorkspaceLeaf) {
    await leaf.setViewState({
      type: kanbanViewType,
      state: leaf.view.getState(),
      popstate: true,
    } as ViewState);
  }

  async newKanban(folder?: TFolder) {
    const targetFolder = folder
      ? folder
      : this.app.fileManager.getNewFileParent(
          this.app.workspace.getActiveFile()?.path || ""
        );

    // Forcing frontmatter for now until more options are available
    const frontmatter = [
      "---",
      "",
      `${frontMatterKey}: basic`,
      "",
      "---",
      "",
      "",
    ].join("\n");

    try {
      // @ts-ignore
      const kanban: TFile = await this.app.fileManager.createNewMarkdownFile(
        targetFolder,
        t("Untitled Kanban")
      );

      await this.app.vault.modify(kanban, frontmatter);

      const view = new KanbanView(this.app.workspace.activeLeaf, this);

      await view.setState({ file: kanban.path }, {});
      await this.app.workspace.activeLeaf.open(view);
    } catch (e) {
      console.error("Error creating kanban board:", e);
    }
  }

  onunload() {
    const kanbanLeaves = this.app.workspace.getLeavesOfType(kanbanViewType);

    kanbanLeaves.forEach((leaf) => {
      this.setMarkdownView(leaf);
    });

    // @ts-ignore
    this.app.workspace.unregisterHoverLinkSource(frontMatterKey);
    if (this.appEl) {
      this.refreshViews();
      ReactDOM.unmountComponentAtNode(this.appEl);
      this.appEl.detach();
    }
  }

  async loadSettings() {
    this.settings = Object.assign({}, await this.loadData());
  }

  async saveSettings() {
    await this.saveData(this.settings);
  }

  getTemplatePlugins() {
    // @ts-ignore
    const templatesPlugin = this.app.internalPlugins.plugins.templates;
    const templatesEnabled = templatesPlugin.enabled;
    // @ts-ignore
    const templaterPlugin = this.app.plugins.plugins["templater-obsidian"];

    const templateFolder = templatesEnabled
      ? templatesPlugin.instance.options.folder
      : templaterPlugin
      ? templaterPlugin.settings.template_folder
      : undefined;

    return {
      templatesPlugin,
      templaterPlugin: templaterPlugin?.templater,
      templatesEnabled,
      templateFolder,
    };
  }
}
