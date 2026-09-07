use bones_messages::codec::{DecodeError, EncodeError, Reader, Writer};

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum GitRequest {
    Run(GitRun),
    Cancel(u32),
}

impl GitRequest {
    pub fn decode(bytes: &[u8]) -> Result<Self, DecodeError> {
        let mut reader = Reader::new(bytes);
        match reader.read_u8()? {
            0 => {
                let run = GitRun::decode_body(&mut reader)?;
                reader.finish()?;
                Ok(Self::Run(run))
            }
            1 => {
                let request_id = reader.read_u32()?;
                reader.finish()?;
                Ok(Self::Cancel(request_id))
            }
            tag => Err(DecodeError::InvalidTag {
                message: "git request",
                tag,
            }),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct GitRun {
    pub request_id: u32,
    pub cwd: String,
    pub args: Vec<String>,
    pub env: Vec<(String, String)>,
    pub timeout_ms: u32,
}

impl GitRun {
    pub fn encode(&self) -> Result<Vec<u8>, EncodeError> {
        let args = u16::try_from(self.args.len()).map_err(|_| EncodeError::StringTooLong)?;
        let env = u16::try_from(self.env.len()).map_err(|_| EncodeError::StringTooLong)?;
        let mut writer = Writer::new()
            .u8(0)
            .u32(self.request_id)
            .try_str(&self.cwd)?
            .u16(args);
        for arg in &self.args {
            writer = writer.try_str(arg)?;
        }
        writer = writer.u16(env);
        for (name, value) in &self.env {
            writer = writer.try_str(name)?.try_str(value)?;
        }
        Ok(writer.u32(self.timeout_ms).finish())
    }

    pub fn decode(bytes: &[u8]) -> Result<Self, DecodeError> {
        let mut reader = Reader::new(bytes);
        let tag = reader.read_u8()?;
        if tag != 0 {
            return Err(DecodeError::InvalidTag {
                message: "git run",
                tag,
            });
        }
        let run = Self::decode_body(&mut reader)?;
        reader.finish()?;
        Ok(run)
    }

    fn decode_body(reader: &mut Reader<'_>) -> Result<Self, DecodeError> {
        let request_id = reader.read_u32()?;
        let cwd = reader.read_str()?.to_string();
        let args = read_strings(reader)?;
        let env_count = reader.read_u16()?;
        let mut env = Vec::with_capacity(env_count as usize);
        for _ in 0..env_count {
            env.push((
                reader.read_str()?.to_string(),
                reader.read_str()?.to_string(),
            ));
        }
        let timeout_ms = reader.read_u32()?;
        Ok(Self {
            request_id,
            cwd,
            args,
            env,
            timeout_ms,
        })
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct GitResult {
    pub request_id: u32,
    pub status: u8,
    pub exit_code: i32,
    pub stdout: Vec<u8>,
    pub stderr: Vec<u8>,
}

impl GitResult {
    pub fn encode(&self) -> Result<Vec<u8>, EncodeError> {
        Ok(Writer::new()
            .u32(self.request_id)
            .u8(self.status)
            .i32(self.exit_code)
            .try_blob(&self.stdout)?
            .try_blob(&self.stderr)?
            .finish())
    }

    pub fn decode(bytes: &[u8]) -> Result<Self, DecodeError> {
        let mut reader = Reader::new(bytes);
        let result = Self {
            request_id: reader.read_u32()?,
            status: reader.read_u8()?,
            exit_code: reader.read_i32()?,
            stdout: reader.read_blob()?.to_vec(),
            stderr: reader.read_blob()?.to_vec(),
        };
        if result.status > 2 {
            return Err(DecodeError::InvalidTag {
                message: "git result status",
                tag: result.status,
            });
        }
        reader.finish()?;
        Ok(result)
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct WatchRequest {
    pub request_id: u32,
    pub action: u8,
    pub repository: String,
}

impl WatchRequest {
    pub fn encode(&self) -> Result<Vec<u8>, EncodeError> {
        Ok(Writer::new()
            .u32(self.request_id)
            .u8(self.action)
            .try_str(&self.repository)?
            .finish())
    }

    pub fn decode(bytes: &[u8]) -> Result<Self, DecodeError> {
        let mut reader = Reader::new(bytes);
        let request = Self {
            request_id: reader.read_u32()?,
            action: reader.read_u8()?,
            repository: reader.read_str()?.to_string(),
        };
        if request.action > 1 {
            return Err(DecodeError::InvalidTag {
                message: "watch action",
                tag: request.action,
            });
        }
        reader.finish()?;
        Ok(request)
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct WatchEvent {
    pub request_id: u32,
    pub kind: u8,
    pub repository: String,
    pub path: String,
}

impl WatchEvent {
    pub fn encode(&self) -> Result<Vec<u8>, EncodeError> {
        Ok(Writer::new()
            .u32(self.request_id)
            .u8(self.kind)
            .try_str(&self.repository)?
            .try_str(&self.path)?
            .finish())
    }
}

/// A request to one of the two OS endpoints.
///
/// Both carry the same shape -- a correlation id, an action tag and one string
/// -- and differ only in which actions they accept. `os` is the engine's
/// generic desktop surface; `repo-os` is this application's git-aware one,
/// whose actions need a repository to mean anything. They number their actions
/// independently, so neither has to leave gaps for the other.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct OsRequest {
    pub request_id: u32,
    pub action: u8,
    pub value: String,
}

/// Highest action tag the generic `os` endpoint defines.
pub const MAX_OS_ACTION: u8 = 6;
/// Highest action tag the git-aware `repo-os` endpoint defines.
pub const MAX_REPO_OS_ACTION: u8 = 5;

impl OsRequest {
    pub fn encode(&self) -> Result<Vec<u8>, EncodeError> {
        Ok(Writer::new()
            .u32(self.request_id)
            .u8(self.action)
            .try_str(&self.value)?
            .finish())
    }

    /// Decodes a request for the generic `os` endpoint.
    pub fn decode(bytes: &[u8]) -> Result<Self, DecodeError> {
        Self::decode_within(bytes, MAX_OS_ACTION, "os action")
    }

    /// Decodes a request for the git-aware `repo-os` endpoint.
    pub fn decode_repo(bytes: &[u8]) -> Result<Self, DecodeError> {
        Self::decode_within(bytes, MAX_REPO_OS_ACTION, "repo-os action")
    }

    fn decode_within(bytes: &[u8], max: u8, message: &'static str) -> Result<Self, DecodeError> {
        let mut reader = Reader::new(bytes);
        let request = Self {
            request_id: reader.read_u32()?,
            action: reader.read_u8()?,
            value: reader.read_str()?.to_string(),
        };
        if request.action > max {
            return Err(DecodeError::InvalidTag {
                message,
                tag: request.action,
            });
        }
        reader.finish()?;
        Ok(request)
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct NativeResult {
    pub request_id: u32,
    pub accepted: bool,
    pub value: String,
    pub error: String,
}

impl NativeResult {
    pub fn encode(&self) -> Result<Vec<u8>, EncodeError> {
        Ok(Writer::new()
            .u32(self.request_id)
            .u8(u8::from(self.accepted))
            .try_str(&self.value)?
            .try_str(&self.error)?
            .finish())
    }

    pub fn decode(bytes: &[u8]) -> Result<Self, DecodeError> {
        let mut reader = Reader::new(bytes);
        let request_id = reader.read_u32()?;
        let accepted = match reader.read_u8()? {
            0 => false,
            1 => true,
            tag => {
                return Err(DecodeError::InvalidTag {
                    message: "native result boolean",
                    tag,
                })
            }
        };
        let result = Self {
            request_id,
            accepted,
            value: reader.read_str()?.to_string(),
            error: reader.read_str()?.to_string(),
        };
        reader.finish()?;
        Ok(result)
    }
}

/// A request to check for, stage, or install an application update. `Check`
/// and `Stage` need only a manifest URL: `Stage` re-fetches the manifest
/// itself rather than requiring the caller to have kept `Check`'s result
/// around. `Install` (stages the running build itself, for a not-yet-
/// installed run) ignores `manifest_url`.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct UpdaterRequest {
    pub request_id: u32,
    pub action: u8,
    pub manifest_url: String,
}

impl UpdaterRequest {
    pub fn encode(&self) -> Result<Vec<u8>, EncodeError> {
        Ok(Writer::new()
            .u32(self.request_id)
            .u8(self.action)
            .try_str(&self.manifest_url)?
            .finish())
    }

    pub fn decode(bytes: &[u8]) -> Result<Self, DecodeError> {
        let mut reader = Reader::new(bytes);
        let request = Self {
            request_id: reader.read_u32()?,
            action: reader.read_u8()?,
            manifest_url: reader.read_str()?.to_string(),
        };
        if request.action > 2 {
            return Err(DecodeError::InvalidTag {
                message: "updater action",
                tag: request.action,
            });
        }
        reader.finish()?;
        Ok(request)
    }
}

/// Outcome of an [`UpdaterRequest`]. `available` and `version` describe the
/// manifest's own version regardless of `action`, so a `Stage` result also
/// tells the caller what it just staged. `fresh` matters only for `Install`:
/// whether the files landed directly at the install location (nothing was
/// installed yet, so there is nothing left to do) rather than staged for an
/// existing launcher to apply on its next start.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct UpdaterResult {
    pub request_id: u32,
    pub ok: bool,
    pub available: bool,
    pub fresh: bool,
    pub version: String,
    pub error: String,
}

impl UpdaterResult {
    pub fn encode(&self) -> Result<Vec<u8>, EncodeError> {
        Ok(Writer::new()
            .u32(self.request_id)
            .u8(u8::from(self.ok))
            .u8(u8::from(self.available))
            .u8(u8::from(self.fresh))
            .try_str(&self.version)?
            .try_str(&self.error)?
            .finish())
    }

    pub fn decode(bytes: &[u8]) -> Result<Self, DecodeError> {
        let mut reader = Reader::new(bytes);
        let request_id = reader.read_u32()?;
        let ok = decode_bool(reader.read_u8()?)?;
        let available = decode_bool(reader.read_u8()?)?;
        let fresh = decode_bool(reader.read_u8()?)?;
        let result = Self {
            request_id,
            ok,
            available,
            fresh,
            version: reader.read_str()?.to_string(),
            error: reader.read_str()?.to_string(),
        };
        reader.finish()?;
        Ok(result)
    }
}

fn decode_bool(byte: u8) -> Result<bool, DecodeError> {
    match byte {
        0 => Ok(false),
        1 => Ok(true),
        tag => Err(DecodeError::InvalidTag {
            message: "boolean",
            tag,
        }),
    }
}

fn read_strings(reader: &mut Reader<'_>) -> Result<Vec<String>, DecodeError> {
    let count = reader.read_u16()?;
    (0..count)
        .map(|_| reader.read_str().map(str::to_string))
        .collect()
}

#[cfg(test)]
mod tests {
    use super::{
        GitRequest, GitResult, GitRun, OsRequest, UpdaterRequest, UpdaterResult, WatchRequest,
    };
    use bones_messages::codec::DecodeError;

    /// The generic `os` endpoint is the engine's now, so its bytes are
    /// defined by `bones_messages::os`, not here. This asserts the two agree:
    /// a drift would leave the guest talking to a module that mis-parses it,
    /// with no compiler anywhere to catch it.
    #[test]
    fn os_requests_match_what_the_engine_module_decodes() {
        use bones_messages::os::{Action, Request};
        use bones_messages::DecodeMessage;

        for (action, tag) in [
            (Action::ReadClipboard, 0u8),
            (Action::WriteClipboard, 1),
            (Action::OpenUrl, 2),
            (Action::PickFile, 3),
            (Action::PickFolder, 4),
            (Action::OpenDirectory, 5),
            (Action::FetchUrl, 6),
        ] {
            let ours = OsRequest {
                request_id: 42,
                action: tag,
                value: String::from("value"),
            }
            .encode()
            .unwrap();
            let theirs = Request::decode(&ours).unwrap();
            assert_eq!(theirs.request_id, 42);
            assert_eq!(theirs.action, action);
            assert_eq!(theirs.value, "value");
        }
    }

    /// The codec swap moved `finish` from `decode_body` to its callers, since
    /// bones' reader consumes itself. Trailing bytes must still be refused.
    #[test]
    fn git_request_run_refuses_trailing_bytes() {
        let mut bytes = GitRun {
            request_id: 1,
            cwd: String::from("."),
            args: Vec::new(),
            env: Vec::new(),
            timeout_ms: 0,
        }
        .encode()
        .unwrap();
        bytes.push(0);
        assert_eq!(GitRequest::decode(&bytes), Err(DecodeError::TrailingBytes));
    }

    #[test]
    fn requests_and_results_round_trip() {
        let run = GitRun {
            request_id: 4,
            cwd: "C:/žluťoučký".into(),
            args: vec!["status".into(), "--short".into()],
            env: vec![("LANG".into(), "C".into())],
            timeout_ms: 1_000,
        };
        assert_eq!(
            GitRequest::decode(&run.encode().unwrap()).unwrap(),
            GitRequest::Run(run)
        );

        let result = GitResult {
            request_id: 4,
            status: 0,
            exit_code: 0,
            stdout: vec![0, 255],
            stderr: Vec::new(),
        };
        assert_eq!(
            GitResult::decode(&result.encode().unwrap()).unwrap(),
            result
        );

        let fetch = OsRequest {
            request_id: 9,
            action: 6,
            value: "https://www.gravatar.com/avatar/deadbeef?s=80&d=404".into(),
        };
        assert_eq!(OsRequest::decode(&fetch.encode().unwrap()).unwrap(), fetch);

        // The two endpoints number independently, so the same byte means a
        // different action on each, and neither accepts the other's range.
        let read = OsRequest {
            request_id: 10,
            action: 0,
            value: "C:/repo
src/a.ts"
                .into(),
        };
        assert_eq!(
            OsRequest::decode_repo(&read.encode().unwrap()).unwrap(),
            read
        );
        assert_eq!(
            OsRequest::decode_repo(&fetch.encode().unwrap()),
            Err(DecodeError::InvalidTag {
                message: "repo-os action",
                tag: 6
            })
        );
        // The GitHub sign-in actions (3, 4, 5) are the newest of the range: a
        // decoder capped at the wrong ceiling drops them with no trace at all
        // (`OsModule::handle` silently ignores a decode failure), which is
        // exactly the bug this pins.
        let sign_in = OsRequest {
            request_id: 11,
            action: 3,
            value: String::new(),
        };
        assert_eq!(
            OsRequest::decode_repo(&sign_in.encode().unwrap()).unwrap(),
            sign_in
        );

        let check = UpdaterRequest {
            request_id: 3,
            action: 0,
            manifest_url: "https://example.com/manifest.json".into(),
        };
        assert_eq!(
            UpdaterRequest::decode(&check.encode().unwrap()).unwrap(),
            check
        );

        let install = UpdaterRequest {
            request_id: 4,
            action: 2,
            manifest_url: String::new(),
        };
        assert_eq!(
            UpdaterRequest::decode(&install.encode().unwrap()).unwrap(),
            install
        );

        let staged = UpdaterResult {
            request_id: 3,
            ok: true,
            available: true,
            fresh: false,
            version: "1.2.0".into(),
            error: String::new(),
        };
        assert_eq!(
            UpdaterResult::decode(&staged.encode().unwrap()).unwrap(),
            staged
        );

        let installed_fresh = UpdaterResult {
            request_id: 4,
            ok: true,
            available: true,
            fresh: true,
            version: String::new(),
            error: String::new(),
        };
        assert_eq!(
            UpdaterResult::decode(&installed_fresh.encode().unwrap()).unwrap(),
            installed_fresh
        );
    }

    #[test]
    fn rejects_unknown_tags_and_trailing_bytes() {
        assert!(GitRequest::decode(&[9]).is_err());
        assert!(WatchRequest::decode(&[1, 0, 0, 0, 2, 0, 0]).is_err());
        assert!(OsRequest::decode(&[1, 0, 0, 0, 10, 0, 0]).is_err());
        assert!(UpdaterRequest::decode(&[1, 0, 0, 0, 3, 0, 0]).is_err());
        assert!(UpdaterResult::decode(&[1, 0, 0, 0, 2]).is_err());

        let mut cancel = vec![1, 7, 0, 0, 0];
        cancel.push(1);
        assert!(GitRequest::decode(&cancel).is_err());
    }
}
