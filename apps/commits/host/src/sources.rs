//! Read-only repository source files, with a last-good cache per file.
use bones_kernel::bus::{Envelope, Handler, Module, ModuleContext};
use serde_json::{json, Value};
use std::collections::{BTreeMap, HashSet};
use std::path::{Path, PathBuf};

pub struct SourcesModule {
    directory: Option<PathBuf>,
    cache: BTreeMap<PathBuf, Value>,
}
impl Default for SourcesModule {
    fn default() -> Self {
        Self {
            directory: std::env::var_os("COMMITS_SOURCES_DIR")
                .map(PathBuf::from)
                .or_else(|| dirs::home_dir().map(|home| home.join(".commits/sources"))),
            cache: BTreeMap::new(),
        }
    }
}
impl SourcesModule {
    fn read(&mut self) -> Vec<Value> {
        let files: Vec<PathBuf> = self
            .directory
            .as_ref()
            .and_then(|directory| std::fs::read_dir(directory).ok())
            .into_iter()
            .flatten()
            .filter_map(|entry| entry.ok().map(|entry| entry.path()))
            .filter(|path| {
                path.extension().is_some_and(|ext| ext == "json")
                    && path
                        .file_stem()
                        .and_then(|stem| stem.to_str())
                        .is_some_and(|stem| {
                            !stem.is_empty()
                                && stem.bytes().all(|byte| {
                                    byte.is_ascii_lowercase()
                                        || byte.is_ascii_digit()
                                        || byte == b'-'
                                })
                        })
            })
            .collect();
        let present: HashSet<_> = files.iter().cloned().collect();
        self.cache.retain(|path, _| present.contains(path));
        for path in files {
            let value = std::fs::read(&path)
                .ok()
                .and_then(|bytes| serde_json::from_slice::<Value>(&bytes).ok());
            if value
                .as_ref()
                .and_then(|value| value["version"].as_u64())
                .is_some_and(|version| version > 1)
            {
                self.cache.remove(&path);
            } else if let Some(source) = value.as_ref().and_then(parse_source) {
                self.cache.insert(path, source);
            }
        }
        self.cache
            .values()
            .map(|source| {
                let mut source = source.clone();
                if let Some(repositories) = source["repositories"].as_array_mut() {
                    for repository in repositories {
                        repository["available"] = json!(repository["path"]
                            .as_str()
                            .is_some_and(|path| Path::new(path).is_dir()));
                    }
                }
                source
            })
            .collect()
    }
}

fn parse_source(value: &Value) -> Option<Value> {
    if value["version"].as_u64()? != 1 {
        return None;
    }
    let name = value["name"].as_str()?;
    let mut repositories = Vec::new();
    for entry in value["repositories"].as_array()? {
        let path = entry["path"].as_str()?;
        if !Path::new(path).is_absolute() {
            return None;
        }
        let group = match entry.get("group") {
            Some(group) => Some(group.as_str()?),
            None => None,
        };
        let favorite = match entry.get("favorite") {
            Some(favorite) => favorite.as_bool()?,
            None => false,
        };
        repositories.push(json!({ "name": entry["name"].as_str()?, "path": path, "group": group, "favorite": favorite }));
    }
    Some(json!({ "name": name, "repositories": repositories }))
}
impl Handler for SourcesModule {
    fn handle(&mut self, _: &Envelope) {}
}
impl Module for SourcesModule {
    fn name(&self) -> &str {
        "sources"
    }
    fn init(&mut self, _: &mut ModuleContext) -> Result<(), String> {
        Ok(())
    }
    fn respond(&mut self, sender: &str, _: &[u8]) -> Option<Vec<u8>> {
        (sender == "commits").then(|| serde_json::to_vec(&self.read()).unwrap())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn caches_malformed_files_but_removes_deleted_and_future_versions() {
        let directory = tempfile::tempdir().unwrap();
        let file = directory.path().join("workspace.json");
        let fixture = json!({"version":1,"name":"Workspace","extra":true,"repositories":[{"name":"repo","path":directory.path(),"favorite":true,"group":"engine","ignored":0}]});
        std::fs::write(&file, fixture.to_string()).unwrap();
        let mut module = SourcesModule {
            directory: Some(directory.path().into()),
            cache: BTreeMap::new(),
        };
        assert_eq!(module.read()[0]["repositories"][0]["available"], true);
        std::fs::write(&file, "{").unwrap();
        assert_eq!(module.read()[0]["name"], "Workspace");
        std::fs::write(&file, "{\"version\":2}").unwrap();
        assert!(module.read().is_empty());
        std::fs::write(&file, fixture.to_string()).unwrap();
        assert_eq!(module.read().len(), 1);
        std::fs::remove_file(file).unwrap();
        assert!(module.read().is_empty());
    }
}
