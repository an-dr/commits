fn main() {
    if let Err(error) = run() {
        eprintln!("fatal: {error}");
        std::process::exit(1);
    }
}

fn run() -> Result<(), Box<dyn std::error::Error>> {
    runner::Engine::new()
        .extensions_dir("extensions")
        .saves_dir("saves")
        .window("commits", 1100, 720)
        .web()
        .module(commits_git::GitModule::default())
        .module(commits_watcher::WatcherModule)
        .module(commits_os::OsModule)
        .run()?;
    Ok(())
}
