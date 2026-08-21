import {
  CORE_SETTING_DEFINITIONS,
  MAX_TOOLS,
  toolPreset,
  TOOLS_KEY,
  VS_CODE_TOOL,
  type CoreSettingDefinition,
  type SettingSection,
  type SettingsDocument,
  type ToolSetting,
} from "@commits/adapter/read/settings";
import { DARK_THEMES, LIGHT_THEMES } from "./themes";

type SettingControl = HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement | HTMLFieldSetElement;

/** Display order for CoreSettingDefinition.section groups; the app-only Appearance fields render before all of these. */
const SECTION_ORDER: readonly SettingSection[] = ["General", "Toolbar", "Commits Table", "Graph", "Status Bar", "Blame", "Branches"];

/** Modal editor generated from the MIT extension compatibility catalog. */
export class SettingsEditor {
  private readonly dialog = document.createElement("dialog");
  private readonly controls = new Map<string, SettingControl>();
  private readonly status = document.createElement("p");
  private readonly saveButton = document.createElement("button");
  private readonly mode = createSelect([["system", "Follow system"], ["light", "Light"], ["dark", "Dark"]]);
  private readonly lightTheme = createSelect(LIGHT_THEMES.map(({ id, name }) => [id, name]));
  private readonly darkTheme = createSelect(DARK_THEMES.map(({ id, name }) => [id, name]));
  private readonly timeFormat = createSelect([
    ["system", "Follow system"],
    ["12h", "12-hour (AM/PM)"],
    ["24h", "24-hour"],
  ]);
  private readonly updateManifestUrl = document.createElement("input");
  /** The External tools section's body, holding one card per tool. */
  private readonly toolList = document.createElement("div");
  private readonly addToolButton = document.createElement("button");
  /** One card's controls, in the order the cards are shown. */
  private readonly toolRows: ToolRow[] = [];
  private settings: SettingsDocument | null = null;

  constructor(
    private readonly save: (settings: SettingsDocument) => void,
    private readonly copyKey: (key: string) => void,
  ) {
    this.dialog.id = "standaloneSettingsDialog";
    this.dialog.setAttribute("aria-labelledby", "standaloneSettingsTitle");
    this.updateManifestUrl.type = "text";
    this.updateManifestUrl.placeholder = "https://example.com/latest.json (leave blank to disable)";
    this.toolList.className = "standaloneToolList";
    this.addToolButton.type = "button";
    this.addToolButton.className = "standaloneToolAdd";
    this.addToolButton.textContent = "Add tool";
    this.addToolButton.addEventListener("click", () => {
      this.addToolRow({ ...VS_CODE_TOOL });
      this.syncToolList();
    });
    this.dialog.append(this.createForm());
    document.body.append(this.dialog);
  }

  open(settings: SettingsDocument, loadError = ""): void {
    this.settings = settings;
    this.populate(settings);
    this.status.textContent = loadError ? `Settings could not be loaded: ${loadError}` : "";
    this.status.className = loadError ? "standaloneSettingsStatus is-error" : "standaloneSettingsStatus";
    this.saveButton.disabled = false;
    this.dialog.showModal();
    this.dialog.querySelector<HTMLElement>("input, select, textarea")?.focus();
  }

  finishSave(settings: SettingsDocument, error: string): void {
    this.saveButton.disabled = false;
    if (error) {
      this.status.textContent = `Could not save settings: ${error}`;
      this.status.className = "standaloneSettingsStatus is-error";
      return;
    }
    this.settings = settings;
    this.populate(settings);
    this.status.textContent = "Saved and applied.";
    this.status.className = "standaloneSettingsStatus is-success";
  }

  private createForm(): HTMLFormElement {
    const form = document.createElement("form");
    form.className = "standaloneSettingsForm";
    form.innerHTML = `<header><div><h1 id="standaloneSettingsTitle">Settings</h1>
      <p>Compatible with <code>an-dr-com-mit-s</code></p></div>
      <button type="button" class="standaloneSettingsClose" aria-label="Close settings">×</button></header>`;
    const fields = document.createElement("div");
    fields.className = "standaloneSettingsFields";
    fields.append(
      createSection("Appearance", [
        createAppearanceField("Mode", this.mode),
        createAppearanceField("Light theme", this.lightTheme),
        createAppearanceField("Dark theme", this.darkTheme),
        createAppearanceField("Commit time format", this.timeFormat),
        createAppearanceField("Update manifest URL", this.updateManifestUrl),
      ]),
      this.createToolsSection(),
    );
    for (const section of SECTION_ORDER) {
      const definitions = CORE_SETTING_DEFINITIONS.filter((definition) => definition.section === section && definition.standalone);
      if (definitions.length === 0) continue;
      fields.append(createSection(section, definitions.map((definition) => this.createField(definition))));
    }
    const footer = document.createElement("footer");
    this.status.className = "standaloneSettingsStatus";
    this.status.setAttribute("aria-live", "polite");
    this.saveButton.type = "submit";
    this.saveButton.textContent = "Save settings";
    footer.append(this.status, this.saveButton);
    form.append(fields, footer);
    form.querySelector(".standaloneSettingsClose")!.addEventListener("click", () => this.dialog.close());
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      const settings = this.collect();
      if (settings === null) return;
      this.saveButton.disabled = true;
      this.status.textContent = "Saving…";
      this.status.className = "standaloneSettingsStatus";
      this.save(settings);
    });
    return form;
  }

  private createField(definition: CoreSettingDefinition): HTMLElement {
    const field = document.createElement("div");
    field.className = "standaloneSettingField";
    const title = document.createElement("label");
    title.className = "standaloneSettingName";
    title.textContent = formatSettingLabel(definition.key);
    // Hover reveals the raw manifest key (title attribute); a click copies it
    // instead of the label's default behaviour of activating `control`.
    title.title = definition.key;
    title.addEventListener("click", (event) => {
      event.preventDefault();
      this.copyKey(definition.key);
      const original = title.textContent;
      title.textContent = "Copied!";
      window.setTimeout(() => { title.textContent = original; }, 900);
    });
    const description = document.createElement("p");
    description.className = "standaloneSettingDescription";
    description.textContent = definition.description;
    const control = this.createControl(definition);
    const id = `standaloneSetting${this.controls.size}`;
    if (control instanceof HTMLFieldSetElement) {
      title.id = `${id}Label`;
      control.setAttribute("aria-labelledby", title.id);
    } else {
      control.id = id;
      title.htmlFor = id;
    }
    this.controls.set(definition.key, control);
    field.append(title, description, control);
    return field;
  }

  private createControl(definition: CoreSettingDefinition): SettingControl {
    if (definition.kind === "boolean") {
      const input = document.createElement("input");
      input.type = "checkbox";
      return input;
    }
    if (definition.kind === "columns") {
      const group = document.createElement("fieldset");
      for (const name of ["Committed", "ID"]) {
        const label = document.createElement("label");
        const input = document.createElement("input");
        input.type = "checkbox";
        input.dataset.column = name;
        label.append(input, name);
        group.append(label);
      }
      return group;
    }
    if (definition.kind === "colours") {
      const textarea = document.createElement("textarea");
      textarea.rows = 4;
      textarea.placeholder = "One CSS colour per line";
      return textarea;
    }
    if (definition.options !== undefined) {
      const select = document.createElement("select");
      for (const option of definition.options) {
        const element = document.createElement("option");
        element.value = String(option);
        element.textContent = String(option);
        select.append(element);
      }
      return select;
    }
    const input = document.createElement("input");
    input.type = definition.kind === "number" ? "number" : "text";
    if (definition.kind === "number") input.step = "any";
    return input;
  }

  private populate(settings: SettingsDocument): void {
    this.mode.value = settings.app.mode;
    this.lightTheme.value = LIGHT_THEMES.some(({ id }) => id === settings.app.lightTheme) ? settings.app.lightTheme : LIGHT_THEMES[0].id;
    this.darkTheme.value = DARK_THEMES.some(({ id }) => id === settings.app.darkTheme) ? settings.app.darkTheme : DARK_THEMES[0].id;
    this.timeFormat.value = settings.app.timeFormat;
    this.updateManifestUrl.value = settings.app.updateManifestUrl;
    this.populateTool(settings.app[TOOLS_KEY]);
    for (const definition of CORE_SETTING_DEFINITIONS) {
      if (!definition.standalone) continue;
      const control = this.controls.get(definition.key)!;
      const value = settings.core[definition.key];
      if (control instanceof HTMLFieldSetElement) {
        const columns = value as Record<string, boolean>;
        control.querySelectorAll<HTMLInputElement>("input").forEach((input) => {
          input.checked = columns[input.dataset.column!] !== false;
        });
      } else if (control instanceof HTMLInputElement && control.type === "checkbox") {
        control.checked = value === true;
      } else if (control instanceof HTMLTextAreaElement) {
        control.value = (value as readonly string[]).join("\n");
      } else {
        control.value = String(value);
      }
    }
  }

  private collect(): SettingsDocument | null {
    if (this.settings === null) return null;
    const core: Record<string, unknown> = { ...this.settings.core };
    for (const definition of CORE_SETTING_DEFINITIONS) {
      if (!definition.standalone) continue;
      const control = this.controls.get(definition.key)!;
      if (control instanceof HTMLFieldSetElement) {
        core[definition.key] = Object.fromEntries(Array.from(control.querySelectorAll<HTMLInputElement>("input"))
          .map((input) => [input.dataset.column!, input.checked]));
      } else if (control instanceof HTMLInputElement && control.type === "checkbox") {
        core[definition.key] = control.checked;
      } else if (control instanceof HTMLTextAreaElement) {
        core[definition.key] = control.value.split(/\r?\n/).map((value) => value.trim()).filter(Boolean);
      } else if (definition.kind === "number") {
        const value = Number(control.value);
        if (!Number.isFinite(value)) {
          control.setCustomValidity("Enter a finite number.");
          control.reportValidity();
          return null;
        }
        control.setCustomValidity("");
        core[definition.key] = value;
      } else {
        core[definition.key] = control.value;
      }
    }
    const tools = this.collectTools();
    if (tools === null) return null;
    return {
      ...this.settings,
      core,
      app: {
        ...this.settings.app,
        mode: this.mode.value as SettingsDocument["app"]["mode"],
        lightTheme: this.lightTheme.value,
        darkTheme: this.darkTheme.value,
        timeFormat: this.timeFormat.value as SettingsDocument["app"]["timeFormat"],
        updateManifestUrl: this.updateManifestUrl.value.trim(),
        [TOOLS_KEY]: tools,
      },
    };
  }

  /**
   * The External tools section: a card per tool, and a way to add another.
   *
   * Tools are their own section rather than one more appearance field because
   * a tool is several fields that only make sense together, and because the
   * order of the cards is itself a setting -- the first is what the button
   * runs, and the first that can diff is what a double-clicked file opens in.
   */
  private createToolsSection(): HTMLElement {
    const description = document.createElement("p");
    description.className = "standaloneSettingDescription";
    description.textContent =
      `The first tool is the one the Open in button runs; the rest are offered under its chevron. ` +
      `Arguments go one to a line. {repo} is the open repository, {left} and {right} the two sides of a diff. ` +
      `Up to ${MAX_TOOLS} tools.`;
    return createSection("External tools", [description, this.toolList, this.addToolButton]);
  }

  /** Builds one card and appends it, without deciding whether it may exist. */
  private addToolRow(tool: ToolSetting): void {
    const card = document.createElement("div");
    card.className = "standaloneToolCard";

    const preset = createSelect([["vscode", "VS Code"], ["custom", "Custom"]]);
    const name = document.createElement("input");
    name.type = "text";
    name.placeholder = "Shown on the button";
    const command = document.createElement("input");
    command.type = "text";
    command.placeholder = "code";
    const openArgs = document.createElement("textarea");
    const diffArgs = document.createElement("textarea");
    for (const field of [openArgs, diffArgs]) {
      field.rows = 3;
      field.spellcheck = false;
    }
    openArgs.placeholder = "{repo}";
    diffArgs.placeholder = "--diff\n{left}\n{right}";
    for (const field of [name, command]) field.spellcheck = false;

    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "standaloneToolRemove";
    remove.textContent = "Remove";
    remove.title = "Remove this tool";

    const header = document.createElement("div");
    header.className = "standaloneToolHeader";
    header.append(labelled("Tool", preset), remove);
    const fields = document.createElement("div");
    fields.className = "standaloneToolFields";
    fields.append(
      labelled("Name", name),
      labelled("Command", command),
      labelled("Open arguments", openArgs),
      labelled("Diff arguments", diffArgs),
    );
    card.append(header, fields);

    const row: ToolRow = { card, preset, name, command, openArgs, diffArgs, fields };
    this.toolRows.push(row);
    this.toolList.append(card);

    showTool(row, tool);
    row.preset.value = toolPreset(tool) === "vscode" ? "vscode" : "custom";
    applyRowPreset(row);
    preset.addEventListener("change", () => {
      if (preset.value === "vscode") showTool(row, VS_CODE_TOOL);
      applyRowPreset(row);
    });
    remove.addEventListener("click", () => {
      this.toolRows.splice(this.toolRows.indexOf(row), 1);
      card.remove();
      this.syncToolList();
    });
  }

  /** Keeps the list's affordances honest about what is still possible. */
  private syncToolList(): void {
    this.addToolButton.disabled = this.toolRows.length >= MAX_TOOLS;
    // With one tool left, removing it is still allowed -- no tools means no
    // button, which is a legitimate choice -- so nothing else is disabled.
    this.toolList.hidden = this.toolRows.length === 0;
  }

  /** Rebuilds the cards from the stored list. */
  private populateTool(tools: readonly ToolSetting[]): void {
    this.toolRows.length = 0;
    this.toolList.replaceChildren();
    for (const tool of tools.slice(0, MAX_TOOLS)) {
      this.addToolRow(tool);
    }
    this.syncToolList();
  }

  /**
   * Reads the cards back.
   *
   * A tool needs the command that runs it, and saying so beats saving one that
   * cannot; everything else is taken as typed, since an argument template is
   * only meaningful to the program that receives it.
   */
  private collectTools(): readonly ToolSetting[] | null {
    const tools: ToolSetting[] = [];
    for (const row of this.toolRows) {
      if (row.preset.value === "vscode") {
        tools.push({ ...VS_CODE_TOOL });
        continue;
      }
      const command = row.command.value.trim();
      if (command === "") {
        row.command.setCustomValidity("A tool needs the command that runs it.");
        row.command.reportValidity();
        return null;
      }
      row.command.setCustomValidity("");
      const name = row.name.value.trim();
      tools.push({
        name: name === "" ? command : name,
        command,
        openArgs: readArgumentLines(row.openArgs.value),
        diffArgs: readArgumentLines(row.diffArgs.value),
      });
    }
    return tools;
  }
}

/** The controls of one tool card. */
interface ToolRow {
  card: HTMLElement;
  preset: HTMLSelectElement;
  name: HTMLInputElement;
  command: HTMLInputElement;
  openArgs: HTMLTextAreaElement;
  diffArgs: HTMLTextAreaElement;
  fields: HTMLElement;
}

function showTool(row: ToolRow, tool: ToolSetting): void {
  row.name.value = tool.name;
  row.command.value = tool.command;
  row.openArgs.value = tool.openArgs.join("\n");
  row.diffArgs.value = tool.diffArgs.join("\n");
}

/**
 * A preset shows what it will run rather than hiding it, and locks it: the
 * user can see exactly what a custom tool would have to spell out.
 */
function applyRowPreset(row: ToolRow): void {
  const locked = row.preset.value === "vscode";
  for (const field of [row.name, row.command, row.openArgs, row.diffArgs]) {
    field.disabled = locked;
  }
  row.command.setCustomValidity("");
}

function labelled(text: string, control: HTMLElement): HTMLElement {
  const field = document.createElement("label");
  field.className = "standaloneToolField";
  const title = document.createElement("span");
  title.textContent = text;
  field.append(title, control);
  return field;
}

/**
 * One argument per line, blank lines dropped.
 *
 * Lines are not trimmed of inner content: an argument is passed to the program
 * exactly as typed, and only the surrounding whitespace a text area collects
 * is removed.
 */
export function readArgumentLines(value: string): string[] {
  return value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line !== "");
}


function createSelect(options: readonly (readonly [string, string])[]): HTMLSelectElement {
  const select = document.createElement("select");
  for (const [value, label] of options) {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = label;
    select.append(option);
  }
  return select;
}

function createSection(heading: string, fields: readonly HTMLElement[]): HTMLElement {
  const section = document.createElement("section");
  section.className = "standaloneSettingsSection";
  const title = document.createElement("h2");
  title.textContent = heading;
  section.append(title, ...fields);
  return section;
}

function createAppearanceField(
  label: string,
  control: HTMLSelectElement | HTMLInputElement | HTMLTextAreaElement,
): HTMLElement {
  const field = document.createElement("label");
  field.className = "standaloneSettingField standaloneAppearanceField";
  const title = document.createElement("span");
  title.textContent = label;
  field.append(title, control);
  return field;
}

/** Converts a dotted manifest key into a compact human-readable label. */
export function formatSettingLabel(key: string): string {
  return key
    .replace(/^an-dr-com-mit-s\./, "")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .split(".")
    .map((part) => `${part[0]?.toUpperCase() ?? ""}${part.slice(1)}`)
    .join(" · ");
}
