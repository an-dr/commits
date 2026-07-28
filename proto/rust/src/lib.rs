use std::collections::BTreeMap;

use bones_messages::web::{
    ClosePanel, Command, Navigate, OpenPanel, PageMessage, PanelFailed, PanelSource, SendJson,
};
use bones_messages::EncodeMessage;
use native::{GitResult, GitRun, OsRequest, WatchRequest};

pub mod native;
pub mod wire;

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

use wire::hex;

pub fn native_fixtures() -> BTreeMap<&'static str, String> {
    let mut fixtures = BTreeMap::new();
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
