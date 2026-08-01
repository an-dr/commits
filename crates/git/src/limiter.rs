use std::sync::{Condvar, Mutex};

pub struct Limiter {
    available: Mutex<usize>,
    changed: Condvar,
}

impl Limiter {
    pub fn new(limit: usize) -> Self {
        Self {
            available: Mutex::new(limit.max(1)),
            changed: Condvar::new(),
        }
    }

    pub fn acquire(&self) -> Permit<'_> {
        let mut available = self.available.lock().unwrap();
        while *available == 0 {
            available = self.changed.wait(available).unwrap();
        }
        *available -= 1;
        Permit { limiter: self }
    }

    fn release(&self) {
        *self.available.lock().unwrap() += 1;
        self.changed.notify_one();
    }
}

pub struct Permit<'a> {
    limiter: &'a Limiter,
}

impl Drop for Permit<'_> {
    fn drop(&mut self) {
        self.limiter.release();
    }
}
