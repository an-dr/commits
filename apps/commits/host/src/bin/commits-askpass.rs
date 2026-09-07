use std::path::PathBuf;
use std::time::Duration;

/// Long enough to cover a GitHub device-flow sign-in approved from the
/// prompt this answers, not just a typed answer -- GitHub's own codes
/// typically allow 900s, so this leaves room either way.
const PROMPT_TIMEOUT: Duration = Duration::from_secs(1200);

fn main() {
    let prompt = std::env::args().skip(1).collect::<Vec<_>>().join(" ");
    if let Some(answer) = commits_os::github_auth::answer_from_keychain(&prompt) {
        print!("{answer}");
        return;
    }
    let Ok(directory) = std::env::var("COMMITS_PROMPT_DIR") else {
        std::process::exit(1)
    };
    match commits_os::rendezvous::Prompt::create(&PathBuf::from(directory), "askpass", &prompt)
        .and_then(|request| request.wait(PROMPT_TIMEOUT))
    {
        Ok(value) => print!("{value}"),
        Err(_) => std::process::exit(1),
    }
}
