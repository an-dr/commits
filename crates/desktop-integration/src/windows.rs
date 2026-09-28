//! Per-user Windows registration: classic shell verbs under
//! `HKEY_CURRENT_USER` and `.lnk` shortcuts in the Start Menu and on the
//! desktop.

use std::path::Path;

use windows::core::{Interface, HSTRING, PCWSTR};
use windows::Win32::Foundation::{ERROR_FILE_NOT_FOUND, ERROR_SUCCESS, RPC_E_CHANGED_MODE, WIN32_ERROR};
use windows::Win32::System::Com::{CoCreateInstance, CoInitializeEx, CoUninitialize, IPersistFile, CLSCTX_INPROC_SERVER, COINIT_APARTMENTTHREADED};
use windows::Win32::System::Registry::{
    RegCloseKey, RegCreateKeyExW, RegDeleteTreeW, RegGetValueW, RegSetValueExW, HKEY, HKEY_CURRENT_USER, KEY_WRITE, REG_OPTION_NON_VOLATILE, REG_SZ, RRF_RT_REG_SZ,
};
use windows::Win32::UI::Shell::{IShellLinkW, ShellLink};

use crate::windows_verbs::{shortcut_name, verbs, Verb};
use crate::{Integration, Locations};

pub(crate) fn register(integration: &Integration, locations: &Locations) -> Result<(), String> {
    for verb in verbs(integration) {
        let key = format!(r"{}\{}", locations.classes_key, verb.key);
        set_value(&key, None, &verb.label)?;
        set_value(&key, Some("Icon"), &verb.icon)?;
        set_value(&format!(r"{key}\command"), None, &verb.command)?;
    }
    for folder in [&locations.start_menu, &locations.desktop] {
        write_shortcut(&folder.join(shortcut_name(integration)), &integration.executable)?;
    }
    Ok(())
}

pub(crate) fn unregister(integration: &Integration, locations: &Locations) -> Result<(), String> {
    for verb in verbs(integration) {
        delete_tree(&format!(r"{}\{}", locations.classes_key, verb.key))?;
    }
    for folder in [&locations.start_menu, &locations.desktop] {
        let path = folder.join(shortcut_name(integration));
        match std::fs::remove_file(&path) {
            Err(error) if error.kind() != std::io::ErrorKind::NotFound => return Err(format!("could not remove {}: {error}", path.display())),
            _ => {}
        }
    }
    Ok(())
}

pub(crate) fn is_registered(integration: &Integration, locations: &Locations) -> bool {
    let verbs_current = verbs(integration).iter().all(|verb| verb_is_current(verb, &locations.classes_key));
    let shortcuts_present = [&locations.start_menu, &locations.desktop].iter().all(|folder| folder.join(shortcut_name(integration)).is_file());
    verbs_current && shortcuts_present
}

fn verb_is_current(verb: &Verb, classes_key: &str) -> bool {
    let key = format!(r"{classes_key}\{}", verb.key);
    get_value(&key, None).as_deref() == Some(verb.label.as_str())
        && get_value(&key, Some("Icon")).as_deref() == Some(verb.icon.as_str())
        && get_value(&format!(r"{key}\command"), None).as_deref() == Some(verb.command.as_str())
}

/// Writes a `REG_SZ` value; `None` is the key's default value.
fn set_value(key: &str, name: Option<&str>, value: &str) -> Result<(), String> {
    let mut handle = HKEY::default();
    let status = unsafe { RegCreateKeyExW(HKEY_CURRENT_USER, &HSTRING::from(key), None, PCWSTR::null(), REG_OPTION_NON_VOLATILE, KEY_WRITE, None, &mut handle, None) };
    check(status, || format!(r"could not create HKCU\{key}"))?;
    let data: Vec<u8> = value.encode_utf16().chain([0]).flat_map(u16::to_le_bytes).collect();
    let name = name.map(HSTRING::from).unwrap_or_default();
    let status = unsafe { RegSetValueExW(handle, &name, None, REG_SZ, Some(&data)) };
    unsafe {
        let _ = RegCloseKey(handle);
    }
    check(status, || format!(r"could not write HKCU\{key}"))
}

/// Reads a `REG_SZ` value, or `None` when the key or value is missing.
fn get_value(key: &str, name: Option<&str>) -> Option<String> {
    let key = HSTRING::from(key);
    let name = name.map(HSTRING::from).unwrap_or_default();
    let mut size = 0u32;
    let status = unsafe { RegGetValueW(HKEY_CURRENT_USER, &key, &name, RRF_RT_REG_SZ, None, None, Some(&mut size)) };
    if status != ERROR_SUCCESS {
        return None;
    }
    let mut buffer = vec![0u16; (size as usize).div_ceil(2)];
    let status = unsafe { RegGetValueW(HKEY_CURRENT_USER, &key, &name, RRF_RT_REG_SZ, None, Some(buffer.as_mut_ptr().cast()), Some(&mut size)) };
    if status != ERROR_SUCCESS {
        return None;
    }
    let text = &buffer[..(size as usize / 2)];
    Some(String::from_utf16_lossy(text.strip_suffix(&[0]).unwrap_or(text)))
}

/// Deletes a key and everything below it; a missing key is not an error.
pub(crate) fn delete_tree(key: &str) -> Result<(), String> {
    let status = unsafe { RegDeleteTreeW(HKEY_CURRENT_USER, &HSTRING::from(key)) };
    if status == ERROR_FILE_NOT_FOUND {
        return Ok(());
    }
    check(status, || format!(r"could not delete HKCU\{key}"))
}

fn check(status: WIN32_ERROR, context: impl FnOnce() -> String) -> Result<(), String> {
    if status == ERROR_SUCCESS {
        Ok(())
    } else {
        Err(format!("{}: {}", context(), windows::core::Error::from(status.to_hresult()).message()))
    }
}

/// Saves a shortcut at `path` that starts `target` in its own directory and
/// takes its icon from it.
fn write_shortcut(path: &Path, target: &Path) -> Result<(), String> {
    let context = |error: windows::core::Error| format!("could not create {}: {}", path.display(), error.message());
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|error| format!("could not create {}: {error}", parent.display()))?;
    }
    // A thread that already joined another apartment can still use the
    // shell link object; only an apartment this call joined is left again.
    let initialized = unsafe { CoInitializeEx(None, COINIT_APARTMENTTHREADED) };
    let joined = initialized.is_ok();
    if !joined && initialized != RPC_E_CHANGED_MODE {
        return Err(context(initialized.into()));
    }
    let result = unsafe {
        (|| {
            let link: IShellLinkW = CoCreateInstance(&ShellLink, None, CLSCTX_INPROC_SERVER)?;
            link.SetPath(&HSTRING::from(target))?;
            if let Some(directory) = target.parent() {
                link.SetWorkingDirectory(&HSTRING::from(directory))?;
            }
            link.SetIconLocation(&HSTRING::from(target), 0)?;
            link.cast::<IPersistFile>()?.Save(&HSTRING::from(path), true)
        })()
    };
    if joined {
        unsafe { CoUninitialize() };
    }
    result.map_err(context)
}
