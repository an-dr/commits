import {
  CORE_SETTING_DEFINITIONS,
  type CoreSettingDefinition,
  type SettingsDocument,
} from "@commits/adapter/read/settings";
import { DARK_THEMES, LIGHT_THEMES } from "./themes";

type SettingControl = HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement | HTMLFieldSetElement;

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
  private settings: SettingsDocument | null = null;

  constructor(private readonly save: (settings: SettingsDocument) => void) {
    this.dialog.id = "standaloneSettingsDialog";
    this.dialog.setAttribute("aria-labelledby", "standaloneSettingsTitle");
    this.updateManifestUrl.type = "text";
    this.updateManifestUrl.placeholder = "https://example.com/latest.json (leave blank to disable)";
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
    this.status.textContent = "Saved. Appearance is active; graph settings apply when the window is reopened.";
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
      createAppearanceField("Mode", this.mode),
      createAppearanceField("Light theme", this.lightTheme),
      createAppearanceField("Dark theme", this.darkTheme),
      createAppearanceField("Commit time format", this.timeFormat),
      createAppearanceField("Update manifest URL", this.updateManifestUrl),
    );
    for (const definition of CORE_SETTING_DEFINITIONS) fields.append(this.createField(definition));
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
    title.textContent = formatSettingLabel(definition.key);
    const key = document.createElement("code");
    key.textContent = definition.key;
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
    field.append(title, key, control);
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
    for (const definition of CORE_SETTING_DEFINITIONS) {
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
      },
    };
  }
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

function createAppearanceField(label: string, control: HTMLSelectElement | HTMLInputElement): HTMLElement {
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
