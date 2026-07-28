fn main() {
    write_fixture("web.json", commits_proto::web_fixtures());
    write_fixture("native.json", commits_proto::native_fixtures());
}

fn write_fixture(name: &str, fixtures: std::collections::BTreeMap<&str, String>) {
    let json = serde_json::to_string_pretty(&fixtures).unwrap();
    let output = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../fixtures")
        .join(name);
    std::fs::write(&output, format!("{json}\n")).unwrap();
    println!("wrote {}", output.display());
}
