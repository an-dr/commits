use std::collections::HashMap;
use std::sync::atomic::AtomicBool;
use std::sync::{Arc, Mutex};
use std::thread;

use bones_engine::bus::{Bus, Envelope, Handler, Module, ModuleContext};
use bones_engine::logging::Logger;
use commits_ipc::native::{GitRequest, GitRun};

mod limiter;
pub mod process_runner;

use process_runner::ProcessRunner;

pub const REQUEST_TOPIC: &str = "git/request";
pub const COMPLETED_TOPIC: &str = "git/completed";

pub struct GitModule {
    bus: Option<Bus>,
    runner: Arc<ProcessRunner>,
    cancellations: Arc<Mutex<HashMap<u32, Arc<AtomicBool>>>>,
    /// Absent in tests, which construct the module directly.
    logger: Option<Logger>,
}

impl GitModule {
    pub fn new(concurrency: usize) -> Self {
        Self {
            bus: None,
            runner: Arc::new(ProcessRunner::git(concurrency)),
            cancellations: Arc::new(Mutex::new(HashMap::new())),
            logger: None,
        }
    }

    /// Records every command this module runs.
    ///
    /// Git is where the app spends its time and where it fails, and until
    /// this existed a command that never ran and a command that failed
    /// looked identical from the outside: the window simply did nothing.
    pub fn with_logger(mut self, logger: Logger) -> Self {
        self.logger = Some(logger);
        self
    }

    fn log(&self, message: &str) {
        if let Some(logger) = &self.logger {
            logger.info("git", message);
        }
    }

    fn start(&self, request: GitRun) {
        self.log(&format!(
            "#{} run: git {} (in {})",
            request.request_id,
            request.args.join(" "),
            request.cwd
        ));
        let Some(bus) = self.bus.clone() else {
            self.log(&format!("#{}: no bus, dropped", request.request_id));
            return;
        };
        let cancellation = Arc::new(AtomicBool::new(false));
        if let Some(previous) = self
            .cancellations
            .lock()
            .unwrap()
            .insert(request.request_id, cancellation.clone())
        {
            previous.store(true, std::sync::atomic::Ordering::Release);
        }
        let cancellations = self.cancellations.clone();
        let runner = self.runner.clone();
        let logger = self.logger.clone();
        thread::spawn(move || {
            let request_id = request.request_id;
            let started = std::time::Instant::now();
            let result = runner.run(&request, &cancellation);
            if let Some(logger) = &logger {
                let elapsed = started.elapsed().as_millis();
                let summary = format!(
                    "#{request_id} done: exit {} in {elapsed}ms ({} bytes out)",
                    result.exit_code,
                    result.stdout.len()
                );
                match result.exit_code == 0 && result.status == 0 {
                    true => logger.info("git", &summary),
                    // A command that fails is the thing worth finding in the
                    // log, so it carries the reason git gave for it.
                    false => logger.error(
                        "git",
                        &format!(
                            "{summary}: {}",
                            String::from_utf8_lossy(&result.stderr)
                                .lines()
                                .next()
                                .unwrap_or("no stderr")
                        ),
                    ),
                }
            }
            let mut active = cancellations.lock().unwrap();
            if active
                .get(&request_id)
                .is_some_and(|current| Arc::ptr_eq(current, &cancellation))
            {
                active.remove(&request_id);
            }
            drop(active);
            if let Ok(payload) = result.encode() {
                bus.publish(Envelope {
                    topic: COMPLETED_TOPIC.into(),
                    sender: "git".into(),
                    correlation: Some(u64::from(request_id)),
                    payload,
                });
            }
        });
    }

    fn cancel(&self, request_id: u32) {
        self.log(&format!("#{request_id}: cancel requested"));
        if let Some(cancellation) = self.cancellations.lock().unwrap().get(&request_id) {
            cancellation.store(true, std::sync::atomic::Ordering::Release);
        }
    }
}

impl Default for GitModule {
    fn default() -> Self {
        Self::new(4)
    }
}

impl Handler for GitModule {
    fn handle(&mut self, envelope: &Envelope) {
        if envelope.topic != REQUEST_TOPIC {
            return;
        }
        match GitRequest::decode(&envelope.payload) {
            Ok(GitRequest::Run(request)) => self.start(request),
            Ok(GitRequest::Cancel(request_id)) => self.cancel(request_id),
            Err(_) => {}
        }
    }
}

impl Module for GitModule {
    fn name(&self) -> &str {
        "git"
    }

    fn init(&mut self, context: &mut ModuleContext) -> Result<(), String> {
        context.subscribe(REQUEST_TOPIC);
        self.bus = context.get_service::<Bus>().cloned();
        self.bus
            .as_ref()
            .map(|_| ())
            .ok_or_else(|| "no Bus service available".into())
    }

    fn respond(&mut self, _sender: &str, payload: &[u8]) -> Option<Vec<u8>> {
        if payload != [0] {
            return None;
        }
        let cwd = std::env::current_dir().ok()?.to_string_lossy().into_owned();
        self.runner
            .run(
                &GitRun {
                    request_id: 0,
                    cwd,
                    args: vec!["--version".into()],
                    env: Vec::new(),
                    timeout_ms: 2_000,
                },
                &AtomicBool::new(false),
            )
            .encode()
            .ok()
    }

    fn shutdown(&mut self) {
        for cancellation in self.cancellations.lock().unwrap().values() {
            cancellation.store(true, std::sync::atomic::Ordering::Release);
        }
    }
}

#[cfg(test)]
mod module_tests;
#[cfg(test)]
mod process_runner_tests;
