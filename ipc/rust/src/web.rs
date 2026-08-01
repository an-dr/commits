use std::fmt::{Display, Formatter};

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct WireError(&'static str);

impl From<&'static str> for WireError {
    fn from(value: &'static str) -> Self {
        Self(value)
    }
}

impl Display for WireError {
    fn fmt(&self, formatter: &mut Formatter<'_>) -> std::fmt::Result {
        formatter.write_str(self.0)
    }
}

impl std::error::Error for WireError {}

#[derive(Default)]
pub struct Writer {
    bytes: Vec<u8>,
}

impl Writer {
    pub fn u8(mut self, value: u8) -> Self {
        self.bytes.push(value);
        self
    }

    pub fn u16(mut self, value: u16) -> Self {
        self.bytes.extend_from_slice(&value.to_le_bytes());
        self
    }

    pub fn u32(mut self, value: u32) -> Self {
        self.bytes.extend_from_slice(&value.to_le_bytes());
        self
    }

    pub fn i32(mut self, value: i32) -> Self {
        self.bytes.extend_from_slice(&value.to_le_bytes());
        self
    }

    pub fn string(mut self, value: &str) -> Result<Self, WireError> {
        let length = u16::try_from(value.len()).map_err(|_| WireError("string too long"))?;
        self.bytes.extend_from_slice(&length.to_le_bytes());
        self.bytes.extend_from_slice(value.as_bytes());
        Ok(self)
    }

    pub fn blob(mut self, value: &[u8]) -> Result<Self, WireError> {
        let length = u32::try_from(value.len()).map_err(|_| WireError("blob too long"))?;
        self.bytes.extend_from_slice(&length.to_le_bytes());
        self.bytes.extend_from_slice(value);
        Ok(self)
    }

    pub fn finish(self) -> Vec<u8> {
        self.bytes
    }
}

pub struct Reader<'a> {
    bytes: &'a [u8],
    position: usize,
}

impl<'a> Reader<'a> {
    pub fn new(bytes: &'a [u8]) -> Self {
        Self { bytes, position: 0 }
    }

    pub fn u8(&mut self) -> Result<u8, WireError> {
        Ok(self.take(1)?[0])
    }

    pub fn u16(&mut self) -> Result<u16, WireError> {
        Ok(u16::from_le_bytes(self.take(2)?.try_into().unwrap()))
    }

    pub fn u32(&mut self) -> Result<u32, WireError> {
        Ok(u32::from_le_bytes(self.take(4)?.try_into().unwrap()))
    }

    pub fn i32(&mut self) -> Result<i32, WireError> {
        Ok(i32::from_le_bytes(self.take(4)?.try_into().unwrap()))
    }

    pub fn string(&mut self) -> Result<String, WireError> {
        let length = self.u16()? as usize;
        String::from_utf8(self.take(length)?.to_vec()).map_err(|_| WireError("invalid utf-8"))
    }

    pub fn blob(&mut self) -> Result<Vec<u8>, WireError> {
        let length = self.u32()? as usize;
        Ok(self.take(length)?.to_vec())
    }

    pub fn finish(&self) -> Result<(), WireError> {
        (self.position == self.bytes.len())
            .then_some(())
            .ok_or(WireError("trailing bytes"))
    }

    fn take(&mut self, length: usize) -> Result<&'a [u8], WireError> {
        let end = self
            .position
            .checked_add(length)
            .filter(|end| *end <= self.bytes.len())
            .ok_or(WireError("truncated payload"))?;
        let value = &self.bytes[self.position..end];
        self.position = end;
        Ok(value)
    }
}

pub fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|byte| format!("{byte:02x}")).collect()
}
