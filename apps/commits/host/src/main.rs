// Release builds are a desktop app, so Windows must not open a console behind
// the window. Debug builds keep the console, which is where their logs go.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod page;
mod settings;

fn main() {
    if let Err(error) = run() {
        eprintln!("fatal: {error}");
        std::process::exit(1);
    }
}

fn run() -> Result<(), Box<dyn std::error::Error>> {
    runner::Engine::new()
        .extensions_dir("extensions")
        .startup_extension("commits")
        .saves_dir("saves")
        .window("commits", 1100, 720)
        .web()
        .module(commits_git::GitModule::default())
        .module(commits_watcher::WatcherModule::default())
        .module(commits_os::OsModule::default())
        .module(page::PageModule::default())
        .module(settings::SettingsModule::default())
        .run()?;
    Ok(())
}
