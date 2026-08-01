use std::path::PathBuf;
use std::time::Duration;

fn main() {
    let prompt = std::env::args().skip(1).collect::<Vec<_>>().join(" ");
    let Ok(directory) = std::env::var("COMMITS_PROMPT_DIR") else {
        std::process::exit(1)
    };
    match commits_os::rendezvous::Prompt::create(&PathBuf::from(directory), "askpass", &prompt)
        .and_then(|request| request.wait(Duration::from_secs(120)))
    {
        Ok(value) => print!("{value}"),
        Err(_) => std::process::exit(1),
    }
}
