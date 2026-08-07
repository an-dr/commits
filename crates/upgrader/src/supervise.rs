/// Polls for a health signal up to `timeout`, sleeping between checks via the
/// injected `sleep` rather than a hard-coded real one, so a test can run this
/// to completion without any real time passing. Returns whether the marker
/// appeared before the timeout.
pub fn wait_for_marker(
    mut marker_exists: impl FnMut() -> bool,
    mut elapsed: impl FnMut() -> std::time::Duration,
    mut sleep: impl FnMut(),
    timeout: std::time::Duration,
) -> bool {
    loop {
        if marker_exists() {
            return true;
        }
        if elapsed() >= timeout {
            return false;
        }
        sleep();
    }
}

#[cfg(test)]
mod tests {
    use super::wait_for_marker;
    use std::time::Duration;

    #[test]
    fn returns_true_once_the_marker_appears_before_the_timeout() {
        let mut checks = 0;
        let found = wait_for_marker(
            || {
                checks += 1;
                checks >= 3
            },
            || Duration::from_millis(0),
            || {},
            Duration::from_secs(5),
        );
        assert!(found);
        assert_eq!(checks, 3);
    }

    #[test]
    fn returns_false_once_elapsed_time_reaches_the_timeout_without_a_marker() {
        let mut fake_elapsed = Duration::from_millis(0);
        let found = wait_for_marker(
            || false,
            || {
                fake_elapsed += Duration::from_millis(200);
                fake_elapsed
            },
            || {},
            Duration::from_millis(500),
        );
        assert!(!found);
    }

    #[test]
    fn checks_the_marker_at_least_once_even_with_a_zero_timeout() {
        // A marker that is already present when supervision starts should
        // still count as healthy, not be skipped because the timeout is
        // already technically expired.
        let found = wait_for_marker(|| true, || Duration::from_secs(999), || {}, Duration::ZERO);
        assert!(found);
    }
}
