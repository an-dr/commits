use crate::wire::{Reader, WireError, Writer};

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum GitRequest {
    Run(GitRun),
    Cancel(u32),
}

impl GitRequest {
    pub fn decode(bytes: &[u8]) -> Result<Self, WireError> {
        let mut reader = Reader::new(bytes);
        match reader.u8()? {
            0 => Ok(Self::Run(GitRun::decode_body(&mut reader)?)),
            1 => {
                let request_id = reader.u32()?;
                reader.finish()?;
                Ok(Self::Cancel(request_id))
            }
            _ => Err(WireError::from("unknown git request")),
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
    pub fn encode(&self) -> Result<Vec<u8>, WireError> {
        let args = u16::try_from(self.args.len()).map_err(|_| WireError::from("too many args"))?;
        let env =
            u16::try_from(self.env.len()).map_err(|_| WireError::from("too many env vars"))?;
        let mut writer = Writer::default()
            .u8(0)
            .u32(self.request_id)
            .string(&self.cwd)?
            .u16(args);
        for arg in &self.args {
            writer = writer.string(arg)?;
        }
        writer = writer.u16(env);
        for (name, value) in &self.env {
            writer = writer.string(name)?.string(value)?;
        }
        Ok(writer.u32(self.timeout_ms).finish())
    }

    pub fn decode(bytes: &[u8]) -> Result<Self, WireError> {
        let mut reader = Reader::new(bytes);
        if reader.u8()? != 0 {
            return Err(WireError::from("not a git run request"));
        }
        Self::decode_body(&mut reader)
    }

    fn decode_body(reader: &mut Reader<'_>) -> Result<Self, WireError> {
        let request_id = reader.u32()?;
        let cwd = reader.string()?;
        let args = read_strings(reader)?;
        let env_count = reader.u16()?;
        let mut env = Vec::with_capacity(env_count as usize);
        for _ in 0..env_count {
            env.push((reader.string()?, reader.string()?));
        }
        let timeout_ms = reader.u32()?;
        reader.finish()?;
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
    pub fn encode(&self) -> Result<Vec<u8>, WireError> {
        Ok(Writer::default()
            .u32(self.request_id)
            .u8(self.status)
            .i32(self.exit_code)
            .blob(&self.stdout)?
            .blob(&self.stderr)?
            .finish())
    }

    pub fn decode(bytes: &[u8]) -> Result<Self, WireError> {
        let mut reader = Reader::new(bytes);
        let result = Self {
            request_id: reader.u32()?,
            status: reader.u8()?,
            exit_code: reader.i32()?,
            stdout: reader.blob()?,
            stderr: reader.blob()?,
        };
        if result.status > 2 {
            return Err(WireError::from("unknown git result status"));
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
    pub fn encode(&self) -> Result<Vec<u8>, WireError> {
        Ok(Writer::default()
            .u32(self.request_id)
            .u8(self.action)
            .string(&self.repository)?
            .finish())
    }

    pub fn decode(bytes: &[u8]) -> Result<Self, WireError> {
        let mut reader = Reader::new(bytes);
        let request = Self {
            request_id: reader.u32()?,
            action: reader.u8()?,
            repository: reader.string()?,
        };
        if request.action > 1 {
            return Err(WireError::from("unknown watch action"));
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
    pub fn encode(&self) -> Result<Vec<u8>, WireError> {
        Ok(Writer::default()
            .u32(self.request_id)
            .u8(self.kind)
            .string(&self.repository)?
            .string(&self.path)?
            .finish())
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct OsRequest {
    pub request_id: u32,
    pub action: u8,
    pub value: String,
}

impl OsRequest {
    pub fn encode(&self) -> Result<Vec<u8>, WireError> {
        Ok(Writer::default()
            .u32(self.request_id)
            .u8(self.action)
            .string(&self.value)?
            .finish())
    }

    pub fn decode(bytes: &[u8]) -> Result<Self, WireError> {
        let mut reader = Reader::new(bytes);
        let request = Self {
            request_id: reader.u32()?,
            action: reader.u8()?,
            value: reader.string()?,
        };
        if request.action > 4 {
            return Err(WireError::from("unknown os action"));
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
    pub fn encode(&self) -> Result<Vec<u8>, WireError> {
        Ok(Writer::default()
            .u32(self.request_id)
            .u8(u8::from(self.accepted))
            .string(&self.value)?
            .string(&self.error)?
            .finish())
    }
}

fn read_strings(reader: &mut Reader<'_>) -> Result<Vec<String>, WireError> {
    let count = reader.u16()?;
    (0..count).map(|_| reader.string()).collect()
}

#[cfg(test)]
mod tests {
    use super::{GitRequest, GitResult, GitRun, OsRequest, WatchRequest};

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
    }

    #[test]
    fn rejects_unknown_tags_and_trailing_bytes() {
        assert!(GitRequest::decode(&[9]).is_err());
        assert!(WatchRequest::decode(&[1, 0, 0, 0, 2, 0, 0]).is_err());
        assert!(OsRequest::decode(&[1, 0, 0, 0, 5, 0, 0]).is_err());

        let mut cancel = vec![1, 7, 0, 0, 0];
        cancel.push(1);
        assert!(GitRequest::decode(&cancel).is_err());
    }
}
