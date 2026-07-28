use std::io::Read;
use std::process::{Command, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::thread;
use std::time::{Duration, Instant};

use commits_proto::native::{GitResult, GitRun};

use crate::limiter::Limiter;

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

        Ok(GitResult {
            request_id: request.request_id,
            status: status_tag,
            exit_code: exit,
            stdout: stdout.join().map_err(|_| "stdout reader panicked")?,
            stderr: stderr.join().map_err(|_| "stderr reader panicked")?,
        })
    }
}

fn read_pipe(mut pipe: impl Read + Send + 'static) -> thread::JoinHandle<Vec<u8>> {
    thread::spawn(move || {
        let mut bytes = Vec::new();
        let _ = pipe.read_to_end(&mut bytes);
        bytes
    })
}

impl Default for ProcessRunner {
    fn default() -> Self {
        Self::git(4)
    }
}

pub type Cancellation = Arc<AtomicBool>;
