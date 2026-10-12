//! Pure argument parsing shared by startup and subsequent launches.
use std::path::{Path, PathBuf};

#[derive(Debug, Default, Clone, PartialEq, Eq)]
pub struct LaunchRequest {
    pub path: Option<String>,
    pub show: Option<String>,
    pub branch: Option<String>,
    pub commit: Option<String>,
    pub theme: Option<String>,
    pub theme_file: Option<PathBuf>,
}

pub fn parse(args: &[String], cwd: Option<&Path>) -> LaunchRequest {
    let mut request = LaunchRequest::default();
    let mut index = 0;
    while index < args.len() {
        let argument = &args[index];
        index += 1;
        if !argument.starts_with('-') {
            if request.path.is_none() {
                request.path = Some(argument.clone());
            }
            continue;
        }
        let (name, inline) = argument
            .split_once('=')
            .map_or((argument.as_str(), None), |(name, value)| {
                (name, Some(value))
            });
        if !matches!(
            name,
            "--show" | "--branch" | "--commit" | "--theme" | "--theme-file"
        ) {
            continue;
        }
        let value = match inline {
            Some(value) => value,
            None if args.get(index).is_some_and(|value| !value.starts_with('-')) => {
                index += 1;
                &args[index - 1]
            }
            None => continue,
        };
        match name {
            "--show" if matches!(value, "changes" | "conflicts" | "graph") => {
                request.show = Some(value.into())
            }
            "--branch" if !value.is_empty() => request.branch = Some(value.into()),
            "--commit"
                if (4..=64).contains(&value.len())
                    && value.bytes().all(|byte| byte.is_ascii_hexdigit()) =>
            {
                request.commit = Some(value.into())
            }
            "--theme" if matches!(value, "light" | "dark") => request.theme = Some(value.into()),
            "--theme-file" if !value.is_empty() => {
                let path = PathBuf::from(value);
                request.theme_file = Some(if path.is_absolute() {
                    path
                } else {
                    cwd.unwrap_or(Path::new(".")).join(path)
                });
            }
            _ => {}
        }
    }
    request
}

#[cfg(test)]
mod tests {
    use super::*;
    fn args(values: &[&str]) -> Vec<String> {
        values.iter().map(|value| value.to_string()).collect()
    }
    #[test]
    fn accepts_flags_in_any_order_and_inline_values() {
        let request = parse(
            &args(&[
                "--theme=dark",
                "repo",
                "--show",
                "changes",
                "--branch=main",
                "--commit",
                "abcd",
                "--theme-file",
                "palette.json",
                "--unknown",
            ]),
            Some(Path::new("/caller")),
        );
        assert_eq!(request.path.as_deref(), Some("repo"));
        assert_eq!(request.show.as_deref(), Some("changes"));
        assert_eq!(request.commit.as_deref(), Some("abcd"));
        assert_eq!(
            request.theme_file,
            Some(PathBuf::from("/caller/palette.json"))
        );
    }
    #[test]
    fn missing_and_unknown_values_do_not_consume_other_flags() {
        let request = parse(
            &args(&[
                "repo",
                "--branch",
                "--theme=sepia",
                "--commit=bad",
                "--show=other",
                "--unknown=value",
            ]),
            None,
        );
        assert_eq!(
            request,
            LaunchRequest {
                path: Some("repo".into()),
                ..Default::default()
            }
        );
    }
}
