//! A log file beside the executable.
//!
//! Release builds are `windows_subsystem = "windows"`, so the default stdout
//! sink reaches nobody. The startup dialog says what failed; this file keeps
//! the sequence that led there.
//!
//! Lines are stamped with milliseconds since process start rather than a wall
//! clock date, because the failure this exists to explain is a timing one --
//! `instantiate` + `init` overrunning the engine's one second load budget.

use std::fs::{rename, File};
use std::io::Write;
use std::path::PathBuf;
use std::sync::Mutex;
use std::time::{Instant, SystemTime, UNIX_EPOCH};

use bones_kernel::logging::{Level, LogSink, Logger};

const LOG_FILE: &str = "commits.log";
const PREVIOUS_LOG_FILE: &str = "commits.prev.log";

/// Resolves the log the same way `saves_dir`/`extensions_dir` do (see
/// `UpgradeModule::shared_path`): beside the running
/// executable for a dev build, so a copied `dist/app` keeps its diagnostics
/// with it, or at the shared install-wide location when running from an
/// installed version folder, so `commits.log` survives across updates
/// instead of starting over in each new version folder.
pub fn log_path() -> Option<PathBuf> {
    bones_kernel::upgrade::UpgradeModule::new(crate::installation::config()).shared_path(LOG_FILE)
}

/// Installs the file logger.
///
/// The previous run is kept as `commits.prev.log`: the failure appears at
/// startup, so relaunching -- the first thing anyone tries -- would otherwise
/// overwrite the only evidence.
pub fn install() -> Logger {
    let file = log_path().and_then(|path| {
        let previous = path.with_file_name(PREVIOUS_LOG_FILE);
        let _ = rename(&path, previous);
        File::create(&path).ok()
    });
    let writer: Box<dyn Write + Send> = match file {
        Some(file) => Box::new(file),
        None => Box::new(std::io::sink()),
    };
    let sink = Sink::new(writer, cfg!(debug_assertions));
    Logger::new(std::sync::Arc::new(sink))
}

struct Sink {
    writer: Mutex<Box<dyn Write + Send>>,
    started: Instant,
    /// Debug builds keep their console, and the tick stream with it.
    echo: bool,
}

impl Sink {
    fn new(writer: Box<dyn Write + Send>, echo: bool) -> Self {
        let sink = Self {
            writer: Mutex::new(writer),
            started: Instant::now(),
            echo,
        };
        let epoch = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|since| since.as_secs())
            .unwrap_or_default();
        sink.write_line(&format!("--- commits started at unix {epoch} ---"));
        sink
    }

    fn write_line(&self, line: &str) {
        if let Ok(mut writer) = self.writer.lock() {
            let _ = writeln!(writer, "{line}");
            let _ = writer.flush();
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

    fn sink() -> (Sink, Buffer) {
        let buffer = Buffer(Arc::new(Mutex::new(Vec::new())));
        let sink = Sink::new(Box::new(buffer.clone()), false);
        (sink, buffer)
    }

    fn written(buffer: &Buffer) -> String {
        String::from_utf8(buffer.0.lock().unwrap().clone()).unwrap()
    }

    #[test]
    fn records_info_and_above_but_drops_the_tick_stream() {
        let (sink, buffer) = sink();

        sink.log(Level::Debug, "runner", "tick dt=0.016");
        sink.log(Level::Info, "engine", "loaded 'commits'");
        sink.log(Level::Warn, "commits", "ignored invalid topic");

        let text = written(&buffer);
        assert!(text.contains("commits started at unix"));
        assert!(!text.contains("tick dt"));
        assert!(text.contains("[INFO] engine: loaded 'commits'"));
        assert!(text.contains("[WARN] commits: ignored invalid topic"));
    }
}
