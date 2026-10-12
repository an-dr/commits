//! Commits' installation identity and read-only status; update work belongs to Bones.
use bones_kernel::bus::{Envelope, Handler, Module, ModuleContext};
use bones_kernel::upgrade::{AppIdentity, ReleaseSource, UpgradeConfig, UpgradeModule};

pub fn identity() -> AppIdentity {
    AppIdentity {
        install_dir_name: ".commits",
        install_env_var: "COMMITS_INSTALL_DIR",
        launcher_stem: "commits",
        app_stem: "commits-app",
    }
}

pub fn config() -> UpgradeConfig {
    let settings = dirs::home_dir()
        .and_then(|home| std::fs::read(home.join(".commits/settings.json")).ok())
        .and_then(|bytes| serde_json::from_slice::<serde_json::Value>(&bytes).ok());
    UpgradeConfig::new(
        identity(),
        source_from_settings(settings.as_ref()),
        env!("CARGO_PKG_VERSION"),
    )
}

fn source_from_settings(settings: Option<&serde_json::Value>) -> ReleaseSource {
    let override_url = settings
        .and_then(|value| value.get("app")?.get("updateManifestUrl")?.as_str())
        .unwrap_or("");
    ReleaseSource::with_override(
        ReleaseSource::GitHub {
            owner: "an-dr".into(),
            repo: "commits".into(),
            app: "commits".into(),
        },
        override_url,
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn fixes_the_release_source_from_trusted_settings_at_composition() {
        let settings =
            serde_json::json!({"app":{"updateManifestUrl":"https://example.com/manifest.json"}});
        assert_eq!(
            source_from_settings(Some(&settings)),
            ReleaseSource::Url("https://example.com/manifest.json".into())
        );
        let empty = serde_json::json!({"app":{"updateManifestUrl":" "}});
        assert!(
            matches!(source_from_settings(Some(&empty)), ReleaseSource::GitHub { owner, repo, app } if owner == "an-dr" && repo == "commits" && app == "commits")
        );
    }
}

pub struct InstallationModule;
impl Handler for InstallationModule {
    fn handle(&mut self, _: &Envelope) {}
}
impl Module for InstallationModule {
    fn name(&self) -> &str {
        "installation"
    }
    fn init(&mut self, _: &mut ModuleContext) -> Result<(), String> {
        Ok(())
    }
    fn respond(&mut self, sender: &str, _: &[u8]) -> Option<Vec<u8>> {
        if sender != "commits" {
            return None;
        }
        let upgrade = UpgradeModule::new(config());
        let installed = std::env::current_exe()
            .ok()
            .and_then(|path| path.parent().map(std::path::Path::to_path_buf))
            .zip(upgrade.install_dir())
            .is_some_and(|(running, install)| {
                running.parent() == Some(install.as_path())
                    && running
                        .file_name()
                        .and_then(|name| name.to_str())
                        .and_then(bones_versioning::parse_folder_name)
                        .is_some()
            });
        let mut bytes = vec![
            0,
            u8::from(installed),
            0,
            u8::from(crate::desktop::is_registered()),
        ];
        bytes.extend(env!("CARGO_PKG_VERSION").as_bytes());
        Some(bytes)
    }
}
