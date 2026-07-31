import { refInvalid } from "./utils/git";
import { escapeHtml } from "./utils/html";
import { svgIcons } from "./utils/icons";

/** The element a dialog was opened from, highlighted while it is open. */
let sourceElem: HTMLElement | null = null;

/**
 * The elements are looked up per call rather than cached, so this module has
 * no import-order dependency on the panel markup and cannot hold a stale node.
 */
function getDialog(): HTMLElement {
  return document.getElementById("dialog")!;
}

function getBacking(): HTMLElement {
  return document.getElementById("dialogBacking")!;
}

export function showConfirmationDialog(
  message: string,
  confirmed: () => void,
  source: HTMLElement | null
) {
  showDialog(
    message,
    l10n.dialogYes,
    l10n.dialogCancel,
    () => {
      hideDialog();
      confirmed();
    },
    source
  );
}

export function showRefInputDialog(
  message: string,
  defaultValue: string,
  actionName: string,
  actioned: (value: string) => void,
  source: HTMLElement | null
) {
  showFormDialog(
    message,
    [{ type: "text-ref", name: "", default: defaultValue }],
    actionName,
    (values) => actioned(values[0]),
    source
  );
}

export function showCheckboxDialog(
  message: string,
  checkboxLabel: string,
  checkboxValue: boolean,
  actionName: string,
  actioned: (value: boolean) => void,
  source: HTMLElement | null
) {
  showFormDialog(
    message,
    [{ type: "checkbox", name: checkboxLabel, value: checkboxValue }],
    actionName,
    (values) => actioned(values[0] === "checked"),
    source
  );
}

export function showSelectDialog(
  message: string,
  defaultValue: string,
  options: { name: string; value: string }[],
  actionName: string,
  actioned: (value: string) => void,
  source: HTMLElement | null
) {
  showFormDialog(
    message,
    [{ type: "select", name: "", options: options, default: defaultValue }],
    actionName,
    (values) => actioned(values[0]),
    source
  );
}

export function showFormDialog(
  message: string,
  inputs: DialogInput[],
  actionName: string,
  actioned: (values: string[]) => void,
  source: HTMLElement | null
) {
  const dialog = getDialog();
  let textRefInput = -1;
  const multiElementForm = inputs.length > 1;
  let html =
    message + '<br><table class="dialogForm ' + (multiElementForm ? "multi" : "single") + '">';
  for (let i = 0; i < inputs.length; i++) {
    const input = inputs[i];
    html += "<tr>" + (multiElementForm ? "<td>" + input.name + "</td>" : "") + "<td>";
    if (input.type === "select") {
      html += '<select id="dialogInput' + i + '">';
      for (let j = 0; j < input.options.length; j++) {
        html +=
          '<option value="' +
          input.options[j].value +
          '"' +
          (input.options[j].value === input.default ? " selected" : "") +
          ">" +
          escapeHtml(input.options[j].name) +
          "</option>";
      }
      html += "</select>";
    } else if (input.type === "checkbox") {
      html +=
        '<span class="dialogFormCheckbox"><label><input id="dialogInput' +
        i +
        '" type="checkbox"' +
        (input.value ? " checked" : "") +
        "/>" +
        (multiElementForm ? "" : input.name) +
        "</label></span>";
    } else {
      html +=
        '<input id="dialogInput' +
        i +
        '" type="text" value="' +
        escapeHtml(input.default) +
        '"' +
        (input.type === "text" && input.placeholder !== null
          ? ' placeholder="' + escapeHtml(input.placeholder) + '"'
          : "") +
        "/>";
      if (input.type === "text-ref") {
        textRefInput = i;
      }
    }
    html += "</td></tr>";
  }
  html += "</table>";
  showDialog(
    html,
    actionName,
    l10n.dialogCancel,
    () => {
      if (dialog.className === "active noInput" || dialog.className === "active inputInvalid") {
        return;
      }
      const values = [];
      for (let i = 0; i < inputs.length; i++) {
        const input = inputs[i],
          elem = document.getElementById("dialogInput" + i);
        if (input.type === "select") {
          values.push((<HTMLSelectElement>elem).value);
        } else if (input.type === "checkbox") {
          values.push((<HTMLInputElement>elem).checked ? "checked" : "unchecked");
        } else {
          values.push((<HTMLInputElement>elem).value);
        }
      }
      hideDialog();
      actioned(values);
    },
    source
  );

  if (textRefInput > -1) {
    const dialogInput = <HTMLInputElement>document.getElementById("dialogInput" + textRefInput),
      dialogAction = document.getElementById("dialogAction")!;
    if (dialogInput.value === "") {
      dialog.className = "active noInput";
    }
    dialogInput.focus();
    dialogInput.addEventListener("keyup", () => {
      const noInput = dialogInput.value === "",
        invalidInput = dialogInput.value.match(refInvalid) !== null;
      const newClassName = "active" + (noInput ? " noInput" : invalidInput ? " inputInvalid" : "");
      if (dialog.className !== newClassName) {
        dialog.className = newClassName;
        dialogAction.title = invalidInput ? l10n.invalidCharacters.replace("{0}", actionName) : "";
      }
    });
  }
}

export function showErrorDialog(
  message: string,
  reason: string | null,
  source: HTMLElement | null
) {
  showDialog(
    svgIcons.alert +
      message +
      (reason !== null
        ? '<br><span class="errorReason">' + escapeHtml(reason).split("\n").join("<br>") + "</span>"
        : ""),
    null,
    l10n.dialogDismiss,
    null,
    source
  );
}

export function showActionRunningDialog(command: string) {
  showDialog(
    '<span id="actionRunning">' + svgIcons.loading + command + " ...</span>",
    null,
    l10n.dialogDismiss,
    null,
    null
  );
}

export function showDialog(
  html: string,
  actionName: string | null,
  dismissName: string,
  actioned: (() => void) | null,
  source: HTMLElement | null
) {
  const dialog = getDialog();
  getBacking().className = "active";
  dialog.className = "active";
  dialog.innerHTML =
    html +
    "<br>" +
    (actionName !== null
      ? '<div id="dialogAction" class="roundedBtn">' + actionName + "</div>"
      : "") +
    '<div id="dialogDismiss" class="roundedBtn">' +
    dismissName +
    "</div>";
  if (actionName !== null && actioned !== null) {
    document.getElementById("dialogAction")!.addEventListener("click", actioned);
  }
  document.getElementById("dialogDismiss")!.addEventListener("click", hideDialog);

  sourceElem = source;
  if (sourceElem !== null) {
    sourceElem.classList.add("dialogActive");
  }
}

export function hideDialog() {
  const dialog = getDialog();
  getBacking().className = "";
  dialog.className = "";
  dialog.innerHTML = "";
  if (sourceElem !== null) {
    sourceElem.classList.remove("dialogActive");
    sourceElem = null;
  }
}

export function isDialogOpen(): boolean {
  return getDialog().classList.contains("active");
}
