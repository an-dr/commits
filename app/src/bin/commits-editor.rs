use std::path::PathBuf;
use std::time::Duration;

fn main() {
    let Some(path) = std::env::args().nth(1) else {
        std::process::exit(1)
    };
    let Ok(directory) = std::env::var("COMMITS_PROMPT_DIR") else {
        std::process::exit(1)
    };
    let original = std::fs::read_to_string(&path).unwrap_or_default();
    match commits_os::rendezvous::Prompt::create(&PathBuf::from(directory), "editor", &original)
        .and_then(|request| request.wait(Duration::from_secs(120)))
    {
        Ok(value) => {
            if std::fs::write(path, value).is_err() {
                std::process::exit(1)
            }
        }
        Err(_) => std::process::exit(1),
    }
}
