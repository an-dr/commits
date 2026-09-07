use std::io::Read;
use std::process::{Command, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc::{channel, Receiver};
use std::sync::Arc;
use std::thread;
use std::time::{Duration, Instant};

use commits_ipc::native::{GitResult, GitRun};

use crate::limiter::Limiter;

/// How long output is still collected after the command itself has ended.
///
/// The pipes are usually closed by then and the readers finish at once. They
/// do not when something Git started still holds them: `commits-askpass`
/// inherits them and keeps them open for as long as it waits for an answer,
/// which killing Git does not shorten. Reading to end of file therefore held
/// the runner's slot for the helper's full wait -- four of those and no Git
/// command ran again. Whatever such a straggler writes is not Git's answer
/// anyway, so it is not worth a slot.
const OUTPUT_GRACE: Duration = Duration::from_secs(2);

pub struct ProcessRunner {
    executable: String,
    limiter: Arc<Limiter>,
}

impl ProcessRunner {
    pub fn git(concurrency: usize) -> Self {
        Self::new("git", concurrency)
    }

    pub fn new(executable: impl Into<String>, concurrency: usize) -> Self {
        Self {
            executable: executable.into(),
            limiter: Arc::new(Limiter::new(concurrency)),
        }
    }

    pub fn run(&self, request: &GitRun, cancelled: &AtomicBool) -> GitResult {
        let _permit = self.limiter.acquire();
        match self.spawn(request, cancelled) {
            Ok(result) => result,
            Err(error) => GitResult {
                request_id: request.request_id,
                status: 2,
                exit_code: -1,
                stdout: Vec::new(),
                stderr: error.into_bytes(),
            },
        }
    }

    fn spawn(&self, request: &GitRun, cancelled: &AtomicBool) -> Result<GitResult, String> {
        let mut command = Command::new(&self.executable);
        command
            .args(&request.args)
            .current_dir(&request.cwd)
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());
        for (name, value) in &request.env {
            command.env(name, value);
        }
        for (name, value) in helper_environment() {
            if !request.env.iter().any(|(existing, _)| existing == &name) {
                command.env(name, value);
            }
        }
        suppress_console(&mut command);
        let mut child = command
            .spawn()
            .map_err(|error| format!("spawning {}: {error}", self.executable))?;
        let stdout = read_pipe(child.stdout.take().unwrap());
        let stderr = read_pipe(child.stderr.take().unwrap());
        let started = Instant::now();
        let timeout =
            (request.timeout_ms > 0).then(|| Duration::from_millis(request.timeout_ms.into()));
        let mut status_tag = 0;

        let exit = loop {
            if cancelled.load(Ordering::Acquire)
                || timeout.is_some_and(|limit| started.elapsed() >= limit)
            {
                status_tag = 1;
                let _ = child.kill();
            }
            match child.try_wait() {
                Ok(Some(status)) => break status.code().unwrap_or(-1),
                Ok(None) => thread::sleep(Duration::from_millis(5)),
                Err(error) => return Err(format!("waiting for git: {error}")),
            }
        };

        let deadline = Instant::now() + OUTPUT_GRACE;
        let (stdout, stderr) = (collect(stdout, deadline), collect(stderr, deadline));

        Ok(GitResult {
            request_id: request.request_id,
            status: status_tag,
            exit_code: exit,
            stdout,
            stderr,
        })
    }
}

fn helper_environment() -> Vec<(String, String)> {
    let Ok(executable) = std::env::current_exe() else {
        return Vec::new();
    };
    let Some(directory) = executable.parent() else {
        return Vec::new();
    };
    let extension = if cfg!(windows) { ".exe" } else { "" };
    let askpass = directory.join(format!("commits-askpass{extension}"));
    let editor = directory.join(format!("commits-editor{extension}"));
    if !askpass.is_file() || !editor.is_file() {
        return Vec::new();
    }
    vec![
        ("GIT_ASKPASS".into(), askpass.to_string_lossy().into_owned()),
        ("GIT_EDITOR".into(), editor.to_string_lossy().into_owned()),
        (
            "COMMITS_PROMPT_DIR".into(),
            directory
                .join("saves/prompts")
                .to_string_lossy()
                .into_owned(),
        ),
    ]
}

/// Streams chunks so a helper retaining the pipe cannot hide already-read output.
fn read_pipe(mut pipe: impl Read + Send + 'static) -> Receiver<Vec<u8>> {
    let (sender, receiver) = channel();
    thread::spawn(move || {
        let mut chunk = [0_u8; 8192];
        loop {
            match pipe.read(&mut chunk) {
                Ok(0) => break,
                Ok(read) => {
                    if sender.send(chunk[..read].to_vec()).is_err() {
                        break;
                    }
                }
                Err(error) if error.kind() == std::io::ErrorKind::Interrupted => continue,
                Err(_) => break,
            }
        }
    });
    receiver
}

/// Collects output until EOF or a shared deadline, retaining every received byte.
fn collect(reader: Receiver<Vec<u8>>, deadline: Instant) -> Vec<u8> {
    let mut bytes = Vec::new();
    while let Ok(chunk) = reader.recv_timeout(deadline.saturating_duration_since(Instant::now())) {
        bytes.extend_from_slice(&chunk);
        if Instant::now() >= deadline {
            // Include chunks queued while the other pipe was being collected.
            for chunk in reader.try_iter() {
                bytes.extend_from_slice(&chunk);
            }
            break;
        }
    }
    bytes
}

impl Default for ProcessRunner {
    fn default() -> Self {
        Self::git(4)
    }
}

pub type Cancellation = Arc<AtomicBool>;

/// Keeps spawned Git processes from creating a console.
///
/// A windowed host has no console to inherit, so without this Windows gives
/// every Git command its own window, which flashes on screen for each one.
#[cfg(windows)]
fn suppress_console(command: &mut Command) {
    use std::os::windows::process::CommandExt;

    /// `CREATE_NO_WINDOW` from the Win32 process creation flags.
    const CREATE_NO_WINDOW: u32 = 0x0800_0000;

    command.creation_flags(CREATE_NO_WINDOW);
}

#[cfg(not(windows))]
fn suppress_console(_command: &mut Command) {}
