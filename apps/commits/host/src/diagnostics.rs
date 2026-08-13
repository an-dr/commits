//! A log file beside the executable, plus a signal for a fatal extension load.
//!
//! Release builds are `windows_subsystem = "windows"`, so the default stdout
//! sink reaches nobody. That matters because the engine treats a startup
//! extension that fails to attach as non-fatal: it logs the error and keeps
//! ticking, leaving a window that never navigates. Without a file the only
//! symptom is a blank window and no way to find out why.
//!
//! Lines are stamped with milliseconds since process start rather than a wall
//! clock date, because the failure this exists to explain is a timing one --
//! `instantiate` + `init` overrunning the engine's one second load budget.

use std::fs::{rename, File};
use std::io::Write;
use std::path::PathBuf;
use std::sync::mpsc::{channel, Receiver, Sender};
use std::sync::Mutex;
use std::time::{Instant, SystemTime, UNIX_EPOCH};

use bones_engine::logging::{Level, LogSink, Logger};

/// Category the engine logs its own extension bookkeeping under.
const ENGINE: &str = "engine";
/// Start of the engine's message when a catalogued extension cannot attach.
const LOAD_FAILURE: &str = "failed to load";
const LOG_FILE: &str = "commits.log";
const PREVIOUS_LOG_FILE: &str = "commits.prev.log";

/// Resolves the log the same way `saves_dir`/`extensions_dir` do (see
/// `commits_upgrader::shared_or_exe_relative`): beside the running
/// executable for a dev build, so a copied `dist/app` keeps its diagnostics
/// with it, or at the shared install-wide location when running from an
/// installed version folder, so `commits.log` survives across updates
/// instead of starting over in each new version folder.
pub fn log_path() -> Option<PathBuf> {
    commits_upgrader::shared_or_exe_relative(LOG_FILE)
}

/// Installs the file logger, returning it alongside the channel that carries
/// the first fatal extension load failure.
///
/// The previous run is kept as `commits.prev.log`: the failure appears at
/// startup, so relaunching -- the first thing anyone tries -- would otherwise
/// overwrite the only evidence.
pub fn install() -> (Logger, Receiver<String>) {
    let file = log_path().and_then(|path| {
        let previous = path.with_file_name(PREVIOUS_LOG_FILE);
        let _ = rename(&path, previous);
        File::create(&path).ok()
    });
    let writer: Box<dyn Write + Send> = match file {
        Some(file) => Box::new(file),
        None => Box::new(std::io::sink()),
    };
    let (sink, failures) = Sink::new(writer, cfg!(debug_assertions));
    (Logger::new(std::sync::Arc::new(sink)), failures)
}

struct Sink {
    writer: Mutex<Box<dyn Write + Send>>,
    started: Instant,
    /// Taken when the first load failure is reported, so a repeatedly failing
    /// extension raises one report rather than one per attempt.
    failures: Mutex<Option<Sender<String>>>,
    /// Debug builds keep their console, and the tick stream with it.
    echo: bool,
}

impl Sink {
    fn new(writer: Box<dyn Write + Send>, echo: bool) -> (Self, Receiver<String>) {
        let (sender, receiver) = channel();
        let sink = Self {
            writer: Mutex::new(writer),
            started: Instant::now(),
            failures: Mutex::new(Some(sender)),
            echo,
        };
        let epoch = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|since| since.as_secs())
            .unwrap_or_default();
        sink.write_line(&format!("--- commits started at unix {epoch} ---"));
        (sink, receiver)
    }

    fn write_line(&self, line: &str) {
        if let Ok(mut writer) = self.writer.lock() {
            let _ = writeln!(writer, "{line}");
            let _ = writer.flush();
        }
    }

    fn report_failure(&self, message: &str) {
        let Ok(mut failures) = self.failures.lock() else {
            return;
        };
        if let Some(sender) = failures.take() {
            let _ = sender.send(message.to_string());
        }
    }
}

impl LogSink for Sink {
    fn log(&self, level: Level, category: &str, message: &str) {
        if self.echo {
            println!("[{}] {category}: {message}", level_name(level));
        }
        // Ticks log at debug 60 times a second; keeping them would bury the
        // startup sequence this file exists to preserve.
        if level != Level::Debug {
            let elapsed = self.started.elapsed().as_millis();
            self.write_line(&format!(
                "[+{elapsed:>7}ms] [{}] {category}: {message}",
                level_name(level)
            ));
        }
        if level == Level::Error && category == ENGINE && message.starts_with(LOAD_FAILURE) {
            self.report_failure(message);
        }
    }
}

fn level_name(level: Level) -> &'static str {
    match level {
        Level::Debug => "DEBUG",
        Level::Info => "INFO",
        Level::Warn => "WARN",
        Level::Error => "ERROR",
    }
}

#[cfg(test)]
mod tests {
    use std::sync::mpsc::TryRecvError;
    use std::sync::{Arc, Mutex};

    use super::{Level, LogSink, Sink};

    #[derive(Clone)]
    struct Buffer(Arc<Mutex<Vec<u8>>>);

    impl std::io::Write for Buffer {
        fn write(&mut self, buf: &[u8]) -> std::io::Result<usize> {
            self.0.lock().unwrap().extend_from_slice(buf);
            Ok(buf.len())
        }

        fn flush(&mut self) -> std::io::Result<()> {
            Ok(())
        }
    }

    fn sink() -> (Sink, std::sync::mpsc::Receiver<String>, Buffer) {
        let buffer = Buffer(Arc::new(Mutex::new(Vec::new())));
        let (sink, failures) = Sink::new(Box::new(buffer.clone()), false);
        (sink, failures, buffer)
    }

    fn written(buffer: &Buffer) -> String {
        String::from_utf8(buffer.0.lock().unwrap().clone()).unwrap()
    }

    #[test]
    fn records_info_and_above_but_drops_the_tick_stream() {
        let (sink, _failures, buffer) = sink();

        sink.log(Level::Debug, "runner", "tick dt=0.016");
        sink.log(Level::Info, "engine", "loaded 'commits'");
        sink.log(Level::Warn, "commits", "ignored invalid topic");

        let text = written(&buffer);
        assert!(text.contains("commits started at unix"));
        assert!(!text.contains("tick dt"));
        assert!(text.contains("[INFO] engine: loaded 'commits'"));
        assert!(text.contains("[WARN] commits: ignored invalid topic"));
    }

    #[test]
    fn reports_an_extension_load_failure_exactly_once() {
        let (sink, failures, _buffer) = sink();

        sink.log(Level::Error, "engine", "failed to load components/commits.wasm: trap");
        sink.log(Level::Error, "engine", "failed to load components/other.wasm: trap");

        assert!(failures.recv().unwrap().starts_with("failed to load"));
        // The sender is dropped with the first report, so a second failing
        // extension cannot raise a second dialog.
        assert_eq!(failures.try_recv().unwrap_err(), TryRecvError::Disconnected);
    }

    #[test]
    fn leaves_unrelated_errors_to_the_log_alone() {
        let (sink, failures, buffer) = sink();

        sink.log(Level::Error, "commits", "failed to load the repository");
        sink.log(Level::Error, "engine", "skipping duplicate extension name");

        assert_eq!(failures.try_recv().unwrap_err(), TryRecvError::Empty);
        assert!(written(&buffer).contains("failed to load the repository"));
    }
}
