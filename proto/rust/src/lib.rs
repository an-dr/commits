use std::collections::BTreeMap;

use bones_messages::web::{
    ClosePanel, Command, Navigate, OpenPanel, PageMessage, PanelFailed, PanelSource, SendJson,
};
use bones_messages::EncodeMessage;

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

fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|byte| format!("{byte:02x}")).collect()
}

#[cfg(test)]
mod tests {
    use super::web_fixtures;

    #[test]
    fn checked_in_web_fixtures_match_rust_encoding() {
        let checked_in: serde_json::Value =
            serde_json::from_str(include_str!("../../fixtures/web.json")).unwrap();
        let generated = serde_json::to_value(web_fixtures()).unwrap();
        assert_eq!(checked_in, generated);
    }
}
