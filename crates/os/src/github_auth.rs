//! GitHub OAuth device-flow login, and the OS keychain that remembers it.
//!
//! The device flow is the one OAuth flow that needs no client secret and no
//! callback server: GitHub hands out a short code, the user enters it at
//! `verification_uri` in their own browser, and this polls a token endpoint
//! until they do. That fits a desktop app with nowhere to receive a redirect.
//!
//! Once approved, the token goes in the OS keychain -- `commits-askpass`
//! reads it back directly, with no round trip through this module at all.

use std::time::{Duration, Instant};

/// Registered at github.com/login/device by the app's maintainer; the device
/// flow needs no client secret, so this is safe to embed. Empty until set.
const CLIENT_ID: Option<&str> = option_env!("COMMITS_GITHUB_CLIENT_ID");

const DEVICE_CODE_URL: &str = "https://github.com/login/device/code";
const TOKEN_URL: &str = "https://github.com/login/oauth/access_token";

const KEYRING_SERVICE: &str = "an-dr-commits";
const KEYRING_USER: &str = "github-token";

fn client_id() -> Result<&'static str, String> {
    require_client_id(CLIENT_ID)
}

/// Pure so the "unconfigured" refusal is testable on its own terms: `CLIENT_ID`
/// is baked in at compile time, and a repository that configures a real one
/// would otherwise make that refusal untestable in that build.
fn require_client_id(candidate: Option<&str>) -> Result<&str, String> {
    candidate
        .filter(|id| !id.is_empty())
        .ok_or_else(|| "GitHub sign-in is not configured for this build.".to_string())
}

fn json_string(value: &serde_json::Value, field: &str) -> String {
    value.get(field).and_then(|v| v.as_str()).unwrap_or_default().to_string()
}

/// Starts a device-flow login. Framed as
/// `user_code\nverification_uri\ndevice_code\ninterval\nexpires_in` --
/// everything the caller needs to show the user and then poll with.
pub fn start_device_flow() -> Result<String, String> {
    let client_id = client_id()?;
    let response: serde_json::Value = ureq::post(DEVICE_CODE_URL)
        .set("Accept", "application/json")
        .send_form(&[("client_id", client_id), ("scope", "repo")])
        .map_err(|error| format!("could not reach github.com: {error}"))?
        .into_json()
        .map_err(|error| format!("github.com sent an unreadable response: {error}"))?;
    let user_code = json_string(&response, "user_code");
    let verification_uri = json_string(&response, "verification_uri");
    let device_code = json_string(&response, "device_code");
    let interval = response.get("interval").and_then(|v| v.as_u64()).unwrap_or(5);
    let expires_in = response.get("expires_in").and_then(|v| v.as_u64()).unwrap_or(900);
    if user_code.is_empty() || device_code.is_empty() {
        return Err("github.com did not issue a device code.".into());
    }
    Ok(format!("{user_code}\n{verification_uri}\n{device_code}\n{interval}\n{expires_in}"))
}

/// Polls until the user approves the device code, or it expires or is denied.
///
/// `request` is what [`start_device_flow`] framed after the user code and
/// verification URL: `device_code\ninterval\nexpires_in`.
pub fn poll_for_token(request: &str) -> Result<String, String> {
    let client_id = client_id()?;
    let mut parts = request.splitn(3, '\n');
    let device_code = parts.next().unwrap_or_default().to_string();
    let mut interval = parts.next().and_then(|v| v.parse::<u64>().ok()).unwrap_or(5);
    let expires_in = parts.next().and_then(|v| v.parse::<u64>().ok()).unwrap_or(900);

    let deadline = Instant::now() + Duration::from_secs(expires_in);
    loop {
        std::thread::sleep(Duration::from_secs(interval));
        if Instant::now() >= deadline {
            return Err("The sign-in code expired before it was approved.".into());
        }
        let response: serde_json::Value = ureq::post(TOKEN_URL)
            .set("Accept", "application/json")
            .send_form(&[
                ("client_id", client_id),
                ("device_code", &device_code),
                ("grant_type", "urn:ietf:params:oauth:grant-type:device_code"),
            ])
            .map_err(|error| format!("could not reach github.com: {error}"))?
            .into_json()
            .map_err(|error| format!("github.com sent an unreadable response: {error}"))?;
        let token = json_string(&response, "access_token");
        if !token.is_empty() {
            return Ok(token);
        }
        match json_string(&response, "error").as_str() {
            "authorization_pending" => continue,
            "slow_down" => {
                interval += 5;
                continue;
            }
            "expired_token" => return Err("The sign-in code expired before it was approved.".into()),
            "access_denied" => return Err("Sign-in was cancelled.".into()),
            other => return Err(format!("github.com refused the sign-in: {other}")),
        }
    }
}

/// Stores the token in the OS keychain, so `commits-askpass` answers a
/// future github.com prompt without asking again.
pub fn store_token(token: &str) -> Result<(), String> {
    keyring::Entry::new(KEYRING_SERVICE, KEYRING_USER)
        .and_then(|entry| entry.set_password(token))
        .map_err(|error| error.to_string())
}

/// The stored token, or `None` when there is none -- an absent keychain
/// entry is a normal outcome here, not a failure worth reporting.
pub fn stored_token() -> Option<String> {
    keyring::Entry::new(KEYRING_SERVICE, KEYRING_USER).ok()?.get_password().ok()
}

/// If `prompt` (`commits-askpass`'s own argv, joined back into one line) is
/// asking for a github.com credential and a token is already stored, the
/// exact text to print -- skipping the rendezvous file and the UI entirely.
/// `None` falls through to the normal ask.
pub fn answer_from_keychain(prompt: &str) -> Option<String> {
    answer_given(prompt, stored_token())
}

/// The decision half of [`answer_from_keychain`], taking what the keychain
/// holds as a plain value instead of reading it -- so it is testable without
/// a real keychain, which CI's headless Linux runners have none of, and
/// which a real one would mean a test reading (or worse, clearing) whatever
/// token an actual sign-in on this machine left there.
fn answer_given(prompt: &str, token: Option<String>) -> Option<String> {
    if !prompt.contains("github.com") {
        return None;
    }
    if prompt.starts_with("Username for") {
        return token.map(|_| "x-access-token".to_string());
    }
    if prompt.starts_with("Password for") {
        return token;
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    /// This crate is never built with `COMMITS_GITHUB_CLIENT_ID` set, so both
    /// entry points must refuse before ever reaching the network -- a build
    /// with no client ID configured must not silently hang a git push.
    /// `start_device_flow`/`poll_for_token` both call `client_id()?` as their
    /// first statement, before `ureq` ever runs -- so this is what stands
    /// between an unconfigured build and a network call, independent of
    /// whether this particular build happens to have a real id compiled in.
    #[test]
    fn refuses_before_any_network_call_when_unconfigured() {
        assert_eq!(
            require_client_id(None),
            Err("GitHub sign-in is not configured for this build.".to_string())
        );
        assert_eq!(
            require_client_id(Some("")),
            Err("GitHub sign-in is not configured for this build.".to_string())
        );
        assert_eq!(require_client_id(Some("abc123")), Ok("abc123"));
    }

    /// Exercises `answer_given` directly, not `answer_from_keychain`: the
    /// latter reads the real OS keychain, which CI's headless Linux runners
    /// have no Secret Service for, and which a real one would mean touching
    /// whatever token an actual sign-in on this machine left there.
    #[test]
    fn leaves_a_prompt_for_another_host_untouched() {
        assert_eq!(answer_given("Username for 'https://example.com': ", Some("t".into())), None);
        assert_eq!(answer_given("Password for 'https://example.com': ", Some("t".into())), None);
    }

    #[test]
    fn falls_through_a_github_prompt_with_no_token() {
        assert_eq!(answer_given("Username for 'https://github.com': ", None), None);
        assert_eq!(answer_given("Password for 'https://github.com': ", None), None);
    }

    #[test]
    fn answers_a_github_prompt_once_a_token_is_given() {
        assert_eq!(
            answer_given("Username for 'https://github.com': ", Some("gho_test".into())),
            Some("x-access-token".to_string())
        );
        assert_eq!(
            answer_given("Password for 'https://x-access-token@github.com': ", Some("gho_test".into())),
            Some("gho_test".to_string())
        );
    }
}
