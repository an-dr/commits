fn main() {
    let json = serde_json::to_string_pretty(&commits_proto::web_fixtures()).unwrap();
    let output = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../fixtures/web.json");
    std::fs::write(&output, format!("{json}\n")).unwrap();
    println!("wrote {}", output.display());
}
