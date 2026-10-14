use std::collections::BTreeMap;

use bones_messages::web::{
    ClosePanel, Command, Navigate, OpenPanel, PageMessage, PanelFailed, PanelSource, SendJson,
};
use bones_messages::{desktop, upgrader, EncodeMessage};
use native::{GitResult, GitRun, OsRequest, WatchRequest};

/// Renders a payload as lowercase hex, the form the checked-in fixtures record
/// so a cross-language mismatch reads as a diff rather than two byte arrays.
/// Fixture presentation only -- nothing on the wire depends on it.
fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|byte| format!("{byte:02x}")).collect()
}

pub mod native;

pub fn web_fixtures() -> BTreeMap<&'static str, String> {
    let mut fixtures = BTreeMap::new();
    fixtures.insert(
        "open_html",
        hex(&Command::Open(OpenPanel {
            panel: "main",
            source: PanelSource::Html("<h1>commits</h1>"),
        })
        .encode()),
    );
    fixtures.insert(
        "close",
        hex(&Command::Close(ClosePanel { panel: "main" }).encode()),
    );
    fixtures.insert(
        "navigate",
        hex(&Command::Navigate(Navigate {
            panel: "main",
            url: "https://example.com/commits",
        })
        .encode()),
    );
    fixtures.insert(
        "send_json",
        hex(&Command::SendJson(SendJson {
            panel: "main",
            json: r#"{"command":"coreReady","runtime":"bones"}"#,
        })
        .encode()),
    );
    fixtures.insert(
        "page_message",
        hex(&PageMessage {
            owner: "commits",
            panel: "main",
            json: r#"{"command":"echo","requestId":7,"value":"bones"}"#,
        }
        .encode()),
    );
    fixtures.insert(
        "panel_failed",
        hex(&PanelFailed {
            owner: "commits",
            panel: "main",
            reason: "backend unavailable",
        }
        .encode()),
    );
    fixtures
}

pub fn native_fixtures() -> BTreeMap<&'static str, String> {
    let mut fixtures = BTreeMap::new();
    let startup = native::LaunchContent {
        outcome: native::LaunchOutcome::Repository {
            paths: vec!["C:/repo".into()],
        },
        show: Some("changes".into()),
        branch: None,
        commit: None,
        theme: Some("dark".into()),
        theme_file_name: None,
        theme_file: None,
        theme_file_error: None,
    };
    let handoff = native::LaunchContent {
        outcome: native::LaunchOutcome::Repository {
            paths: vec!["C:/other".into()],
        },
        show: Some("conflicts".into()),
        branch: Some("main".into()),
        commit: Some("abcd".into()),
        theme: None,
        ..startup.clone()
    };
    for (name, sequence, content) in [("launch_startup", 0, startup), ("launch_handoff", 2, handoff)] {
        fixtures.insert(
            name,
            hex(&native::LaunchRequest {
                sequence,
                json: content.to_json(),
            }
            .encode()
            .unwrap()),
        );
    }
    // Bones owns these vocabularies; the fixtures pin the bytes the
    // TypeScript encoders and decoders must agree with.
    for (name, action) in [
        ("upgrader_check", upgrader::Action::Check),
        ("upgrader_stage", upgrader::Action::Stage),
        ("upgrader_install", upgrader::Action::Install),
        ("upgrader_last_applied", upgrader::Action::LastApplied),
    ] {
        fixtures.insert(
            name,
            hex(&upgrader::Request {
                request_id: 70_001,
                action,
            }
            .encode()),
        );
    }
    for (name, action) in [
        ("desktop_register", desktop::Action::Register),
        ("desktop_unregister", desktop::Action::Unregister),
    ] {
        fixtures.insert(
            name,
            hex(&desktop::Request {
                request_id: 70_002,
                action,
            }
            .encode()),
        );
    }
    for (name, outcome) in [
        ("upgrader_available", upgrader::Outcome::Available { version: "1.9.0" }),
        ("upgrader_installed", upgrader::Outcome::Installed { fresh: true }),
        (
            "upgrader_last_applied_result",
            upgrader::Outcome::LastApplied {
                previous: Some("1.8.1"),
                current: "1.9.0",
            },
        ),
        ("upgrader_failed", upgrader::Outcome::Failed { reason: "offline" }),
    ] {
        fixtures.insert(
            name,
            hex(&upgrader::Result {
                request_id: 7,
                outcome,
            }
            .encode()),
        );
    }
    for (name, outcome) in [
        ("desktop_registered", desktop::Outcome::Registered(true)),
        ("desktop_failed", desktop::Outcome::Failed("denied")),
    ] {
        fixtures.insert(
            name,
            hex(&desktop::Result {
                request_id: 9,
                outcome,
            }
            .encode()),
        );
    }
    fixtures.insert(
        "git_run",
        hex(&GitRun {
            request_id: 7,
            cwd: "C:/repo".into(),
            args: vec!["--version".into()],
            env: vec![("LANG".into(), "C".into())],
            timeout_ms: 5_000,
        }
        .encode()
        .unwrap()),
    );
    fixtures.insert(
        "git_result",
        hex(&GitResult {
            request_id: 9,
            status: 0,
            exit_code: 0,
            stdout: b"git version".to_vec(),
            stderr: Vec::new(),
        }
        .encode()
        .unwrap()),
    );
    fixtures.insert(
        "watch_start",
        hex(&WatchRequest {
            request_id: 1,
            action: 0,
            repository: "C:/repo".into(),
        }
        .encode()
        .unwrap()),
    );
    fixtures.insert(
        "os_pick_folder",
        hex(&OsRequest {
            request_id: 2,
            action: 4,
            value: "Choose repository".into(),
        }
        .encode()
        .unwrap()),
    );
    fixtures
}

#[cfg(test)]
mod tests {
    use super::{native_fixtures, web_fixtures};

    #[test]
    fn checked_in_web_fixtures_match_rust_encoding() {
        let checked_in: serde_json::Value =
            serde_json::from_str(include_str!("../../fixtures/web.json")).unwrap();
        let generated = serde_json::to_value(web_fixtures()).unwrap();
        assert_eq!(checked_in, generated);
    }

    #[test]
    fn checked_in_native_fixtures_match_rust_encoding() {
        let checked_in: serde_json::Value =
            serde_json::from_str(include_str!("../../fixtures/native.json")).unwrap();
        let generated = serde_json::to_value(native_fixtures()).unwrap();
        assert_eq!(checked_in, generated);
    }
}
