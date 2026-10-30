import type { DesktopResult, UpdaterResult } from "@commits/ipc/native";
import type { HostPort } from "./host/host-port";
import { PendingRequests } from "./pending-requests";
import { RequestIds } from "./request-ids";

type InstallationHost = Pick<HostPort, "requestUpdate" | "requestDesktop" | "requestLastApplied" | "installStatus" | "log">;

type PendingInstallation =
  | { readonly kind: "check" }
  | { readonly kind: "stage" }
  | { readonly kind: "install" }
  /** A finished install waiting on the desktop registration that completes it. */
  | { readonly kind: "installRegistration"; readonly installed: UpdaterResult }
  | { readonly kind: "registration" };

/**
 * The app's own lifecycle on this machine: checking for and staging updates
 * through bones' upgrade module, installing a run that is not yet installed,
 * and registering the installed app with the desktop. It drives the page's
 * Update, Install, and Register/Unregister menu entries.
 */
export class Installation {
  private readonly requestIds = new RequestIds("update");
  private readonly pending = new PendingRequests<PendingInstallation>();
  /** Set once `check` finds a version newer than this build's own. */
  private updateAvailableVersion: string | null = null;
  /**
   * Drives the Install menu entry: `hidden` (this run is already installed;
   * the default, so the entry stays hidden until `start` proves otherwise
   * rather than flashing on for every boot), `ready` (not installed, nothing
   * staged), `staged` (an existing launcher will apply this on its next
   * start), or `done` (placed directly at the install location -- already
   * fully installed, nothing left to apply).
   */
  private status: "hidden" | "ready" | "staged" | "done" = "hidden";
  /**
   * Drives the Register/Unregister menu entry: `none` until `start` proves
   * this run is the installed one, since only the installed entry point is
   * ever registered.
   */
  private registration: "none" | "registered" | "unregistered" = "none";
  /** This build's own version, shown in the About menu. */
  private appVersion = "";

  constructor(
    private readonly host: InstallationHost,
    private readonly send: (message: Record<string, unknown>) => void,
  ) {}

  /** Runs once at boot: checks for an update and reports the install state. */
  start(): void {
    // An empty URL is not "off": the host then reads the latest GitHub
    // release for its own platform (docs/updating.md).
    this.checkForUpdate();
    const installStatus = this.host.installStatus();
    this.host.requestLastApplied(this.requestIds.next());
    if (installStatus.ok) {
      this.status = installStatus.installed ? "hidden" : "ready";
      if (installStatus.installed) this.registration = installStatus.registered ? "registered" : "unregistered";
      this.appVersion = installStatus.version;
    } else {
      this.host.log("warn", `could not resolve install status: ${installStatus.error}`);
    }
    // Fires once, the first start after an Update or Install actually took
    // effect -- installStatus.justUpdated is already one-shot on the host
    // side, regardless of which of the two produced the new version.
    this.sendInstallStatus(
      installStatus.ok && installStatus.justUpdated ? `Updated to version ${installStatus.version}` : "",
    );
  }

  /** Downloads, verifies, and stages the update `start` found. */
  startUpdate(): void {
    if (this.updateAvailableVersion === null || this.pending.has("stage")) return;
    const requestId = this.requestIds.next();
    this.pending.add(requestId, { kind: "stage" });
    this.sendUpdateStatus("Downloading update…");
    this.host.requestUpdate(requestId, "stage");
  }

  /** Stages this running build for the next launcher run, regardless of
   * whether self-update via a hosted manifest is configured -- unlike
   * `startUpdate`, this needs no network at all. */
  startInstall(): void {
    if (this.status !== "ready" || this.pending.has("install") || this.pending.has("installRegistration")) return;
    const requestId = this.requestIds.next();
    this.pending.add(requestId, { kind: "install" });
    this.sendInstallStatus("Installing…");
    this.host.requestUpdate(requestId, "install");
  }

  /** Registers or unregisters the installed app; only an installed run
   * offers either, and only the one its current state calls for. */
  startRegistration(action: "register" | "unregister"): void {
    const expected = action === "register" ? "unregistered" : "registered";
    if (this.registration !== expected || this.pending.has("registration")) return;
    const requestId = this.requestIds.next();
    this.pending.add(requestId, { kind: "registration" });
    this.sendInstallStatus(action === "register" ? "Registering…" : "Unregistering…");
    this.host.requestDesktop(requestId, action);
  }

  /**
   * Outcomes from bones' upgrade module. A successful install still needs
   * the desktop registration, so it waits for `receiveDesktopResult`.
   */
  receiveUpgradeResult(result: UpdaterResult & { previous?: string | null }): void {
    if ("previous" in result) {
      if (result.previous && result.previous !== result.version) this.sendInstallStatus(`Updated to version ${result.version}`);
      return;
    }
    const pending = this.pending.take(result.requestId);
    if (pending?.kind === "check") {
      if (result.ok && result.available) {
        this.updateAvailableVersion = result.version;
        this.sendUpdateStatus(`Update ${result.version} available`);
      } else if (!result.ok) {
        this.host.log("warn", `update check failed: ${result.error}`);
      }
    } else if (pending?.kind === "stage") {
      if (result.ok) {
        this.sendUpdateStatus(`Update ${result.version} ready — restart to apply`, true);
      } else {
        // The available update is still there to retry; only the attempt failed.
        this.sendUpdateStatus(`Update failed: ${result.error || "unknown error"}`);
      }
    } else if (pending?.kind === "install") {
      if (!result.ok) { this.finishInstall(result); return; }
      this.pending.add(result.requestId, { kind: "installRegistration", installed: result });
      this.host.requestDesktop(result.requestId, "register");
    }
  }

  /**
   * Outcomes from bones' desktop module: either the registration that
   * completes an install, or a Register/Unregister the user asked for.
   */
  receiveDesktopResult(result: DesktopResult): void {
    const pending = this.pending.take(result.requestId);
    if (pending?.kind === "installRegistration") {
      this.finishInstall({ ...pending.installed, error: result.ok ? "" : `registration failed: ${result.error}` });
    } else if (pending?.kind === "registration") {
      const registering = this.registration === "unregistered";
      if (result.ok) {
        this.registration = registering ? "registered" : "unregistered";
        this.sendInstallStatus(registering ? "Registered with the system." : "Unregistered from the system — files kept in ~/.commits/app.");
      } else {
        this.sendInstallStatus(`${registering ? "Register" : "Unregister"} failed: ${result.error || "unknown error"}`);
      }
    }
  }

  private checkForUpdate(): void {
    if (this.pending.has("check")) return;
    const requestId = this.requestIds.next();
    this.pending.add(requestId, { kind: "check" });
    this.host.requestUpdate(requestId, "check");
  }

  /**
   * Reports a finished install. Bones installs the files and the desktop
   * module registers them; `error` set on an ok result means the files were
   * installed but registration failed, which the installed app's own
   * Register retries.
   */
  private finishInstall(result: UpdaterResult): void {
    const registered = result.error ? `, but ${result.error}` : " and registered";
    if (result.ok && result.fresh) {
      this.status = "done";
      this.sendInstallStatus(`Installed to ~/.commits/app${registered} — launch commits.exe to use it.`);
    } else if (result.ok) {
      this.status = "staged";
      this.sendInstallStatus(`Installed${registered} — restart commits.exe to apply.`);
    } else {
      this.status = "ready";
      this.sendInstallStatus(`Install failed: ${result.error || "unknown error"}`);
    }
  }

  private sendUpdateStatus(message: string, ready = false): void {
    this.send({
      command: "standaloneUpdateStatus",
      available: this.updateAvailableVersion !== null,
      version: this.updateAvailableVersion ?? "",
      ready,
      message,
    });
  }

  private sendInstallStatus(message = ""): void {
    this.send({
      command: "standaloneInstallStatus",
      status: this.status,
      registration: this.registration,
      version: this.appVersion,
      message,
    });
  }
}
