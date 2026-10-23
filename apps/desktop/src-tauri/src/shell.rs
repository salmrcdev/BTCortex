//! Windows integration of the shell (specification section 3.4): the
//! notification-area icon, closing the window to it, and starting with
//! Windows.
//!
//! The preferences live in a small JSON file in the data directory, so the
//! shell can honour them before the WebView or the orchestrator has started.
//! They hold nothing sensitive. Starting with Windows is the current user's
//! `Run` registry value, which needs no administrator rights; Windows' own
//! start-up settings can still turn it off, and that is reported, not undone.

use std::path::PathBuf;
use std::sync::Mutex;
use std::sync::atomic::{AtomicBool, Ordering};

use serde::{Deserialize, Serialize};
use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Manager, Runtime};
use tauri_plugin_notification::NotificationExt;

/// Passed by the `Run` value, so a start with Windows can stay in the notification area.
pub const AUTOSTART_ARGUMENT: &str = "--autostart";
const PREFERENCES_FILE: &str = "shell.json";
const TRAY_ID: &str = "main";
const MENU_OPEN: &str = "open";
const MENU_QUIT: &str = "quit";

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Preferences {
    /// Closing the window leaves BTCortex running in the notification area.
    pub close_to_tray: bool,
    /// A start with Windows opens no window, only the notification-area icon.
    pub start_minimised: bool,
}

impl Default for Preferences {
    fn default() -> Self {
        Self {
            close_to_tray: false,
            start_minimised: true,
        }
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ShellSettings {
    pub close_to_tray: bool,
    pub start_minimised: bool,
    pub start_with_windows: bool,
    /// Turned off in Windows' start-up settings, which take precedence.
    pub disabled_by_windows: bool,
    pub autostart_supported: bool,
}

#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SettingsUpdate {
    pub close_to_tray: Option<bool>,
    pub start_minimised: Option<bool>,
    pub start_with_windows: Option<bool>,
}

pub struct Shell {
    preferences: Mutex<Preferences>,
    file: Option<PathBuf>,
    tray_notice_shown: AtomicBool,
}

impl Shell {
    pub fn load(data_directory: Option<PathBuf>) -> Self {
        let file = data_directory.map(|directory| directory.join(PREFERENCES_FILE));
        let preferences = file
            .as_ref()
            .and_then(|path| std::fs::read_to_string(path).ok())
            .and_then(|text| parse_preferences(&text))
            .unwrap_or_default();
        Self {
            preferences: Mutex::new(preferences),
            file,
            tray_notice_shown: AtomicBool::new(false),
        }
    }

    pub fn preferences(&self) -> Preferences {
        *self
            .preferences
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
    }

    fn save(&self, preferences: Preferences) -> Result<(), String> {
        *self
            .preferences
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner()) = preferences;
        let Some(path) = &self.file else {
            return Ok(());
        };
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent)
                .map_err(|error| format!("The settings folder could not be created: {error}"))?;
        }
        let text = serde_json::to_string_pretty(&preferences)
            .map_err(|error| format!("The settings could not be written: {error}"))?;
        std::fs::write(path, text)
            .map_err(|error| format!("The settings could not be saved: {error}"))
    }

    pub fn settings(&self) -> ShellSettings {
        let preferences = self.preferences();
        let autostart = autostart::state();
        ShellSettings {
            close_to_tray: preferences.close_to_tray,
            start_minimised: preferences.start_minimised,
            start_with_windows: autostart.registered,
            disabled_by_windows: autostart.registered && autostart.disabled_by_windows,
            autostart_supported: autostart::SUPPORTED,
        }
    }

    pub fn update(&self, update: &SettingsUpdate) -> Result<ShellSettings, String> {
        let mut preferences = self.preferences();
        if let Some(close_to_tray) = update.close_to_tray {
            preferences.close_to_tray = close_to_tray;
        }
        if let Some(start_minimised) = update.start_minimised {
            preferences.start_minimised = start_minimised;
        }
        self.save(preferences)?;
        if let Some(enabled) = update.start_with_windows {
            if enabled {
                autostart::register()?;
            } else {
                autostart::unregister()?;
            }
            log::info!(
                "Starting with Windows turned {}",
                if enabled { "on" } else { "off" }
            );
        }
        Ok(self.settings())
    }

    /// The first time the window closes to the notification area, say where BTCortex went.
    fn tell_once_about_tray<R: Runtime>(&self, app: &AppHandle<R>) {
        if self.tray_notice_shown.swap(true, Ordering::SeqCst) {
            return;
        }
        let shown = app
            .notification()
            .builder()
            .title("BTCortex is still running")
            .body("It keeps watching your nodes from the notification area. Quit it from there.")
            .show();
        if let Err(error) = shown {
            log::warn!("Could not show the notification-area notice: {error}");
        }
    }
}

fn parse_preferences(text: &str) -> Option<Preferences> {
    match serde_json::from_str(text) {
        Ok(preferences) => Some(preferences),
        Err(error) => {
            log::warn!("Ignoring unreadable shell settings: {error}");
            None
        }
    }
}

/// Whether this launch came from the `Run` value at sign-in.
pub fn started_by_windows() -> bool {
    std::env::args().any(|argument| argument == AUTOSTART_ARGUMENT)
}

pub fn show_main_window<R: Runtime>(app: &AppHandle<R>) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
    }
}

/// Hides the window instead of closing it when the user chose so; returns whether it did.
pub fn close_to_tray<R: Runtime>(window: &tauri::Window<R>) -> bool {
    let app = window.app_handle();
    let shell = app.state::<Shell>();
    if window.label() != "main" || !shell.preferences().close_to_tray {
        return false;
    }
    if let Err(error) = window.hide() {
        log::warn!("Could not hide the window: {error}");
        return false;
    }
    shell.tell_once_about_tray(app);
    true
}

pub fn create_tray<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<()> {
    let open = MenuItem::with_id(app, MENU_OPEN, "Open BTCortex", true, None::<&str>)?;
    let separator = PredefinedMenuItem::separator(app)?;
    let quit = MenuItem::with_id(app, MENU_QUIT, "Quit BTCortex", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&open, &separator, &quit])?;
    let mut builder = TrayIconBuilder::with_id(TRAY_ID)
        .tooltip("BTCortex")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id().as_ref() {
            MENU_OPEN => show_main_window(app),
            MENU_QUIT => {
                log::info!("Quit chosen from the notification area");
                app.exit(0);
            }
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                show_main_window(tray.app_handle());
            }
        });
    if let Some(icon) = app.default_window_icon() {
        builder = builder.icon(icon.clone());
    }
    builder.build(app)?;
    Ok(())
}

#[tauri::command]
pub fn shell_settings(shell: tauri::State<'_, Shell>) -> ShellSettings {
    shell.settings()
}

#[tauri::command]
pub fn shell_update_settings(
    shell: tauri::State<'_, Shell>,
    update: SettingsUpdate,
) -> Result<ShellSettings, String> {
    shell.update(&update)
}

/// The `Run` value under the current user's key. Development builds use their
/// own name, so they never replace an installed BTCortex's value.
#[cfg(windows)]
mod autostart {
    use windows::Win32::Foundation::{ERROR_FILE_NOT_FOUND, ERROR_SUCCESS, WIN32_ERROR};
    use windows::Win32::System::Registry::{
        HKEY_CURRENT_USER, REG_SZ, RRF_RT_REG_BINARY, RRF_RT_REG_SZ, RegDeleteKeyValueW,
        RegGetValueW, RegSetKeyValueW,
    };
    use windows::core::{HSTRING, w};

    pub const SUPPORTED: bool = true;

    const RUN: windows::core::PCWSTR = w!("Software\\Microsoft\\Windows\\CurrentVersion\\Run");
    const STARTUP_APPROVED: windows::core::PCWSTR =
        w!("Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\StartupApproved\\Run");

    pub struct State {
        pub registered: bool,
        pub disabled_by_windows: bool,
    }

    fn value_name() -> HSTRING {
        HSTRING::from(if cfg!(debug_assertions) {
            "BTCortex (development)"
        } else {
            "BTCortex"
        })
    }

    pub(super) fn command_for(executable: &std::path::Path) -> String {
        format!("\"{}\" {}", executable.display(), super::AUTOSTART_ARGUMENT)
    }

    fn expected_command() -> Result<String, String> {
        std::env::current_exe()
            .map(|executable| command_for(&executable))
            .map_err(|error| format!("BTCortex could not find its own program file: {error}"))
    }

    fn read_command() -> Option<String> {
        let name = value_name();
        let mut size: u32 = 0;
        // SAFETY: a size query with no buffer; the strings are valid and NUL-terminated.
        let status = unsafe {
            RegGetValueW(
                HKEY_CURRENT_USER,
                RUN,
                &name,
                RRF_RT_REG_SZ,
                None,
                None,
                Some(&mut size),
            )
        };
        if status != ERROR_SUCCESS || size == 0 {
            return None;
        }
        let mut buffer = vec![0u16; (size as usize).div_ceil(2)];
        // SAFETY: the buffer holds `size` bytes, as the call is told.
        let status = unsafe {
            RegGetValueW(
                HKEY_CURRENT_USER,
                RUN,
                &name,
                RRF_RT_REG_SZ,
                None,
                Some(buffer.as_mut_ptr().cast()),
                Some(&mut size),
            )
        };
        if status != ERROR_SUCCESS {
            return None;
        }
        let length = buffer
            .iter()
            .position(|&unit| unit == 0)
            .unwrap_or(buffer.len());
        Some(String::from_utf16_lossy(&buffer[..length]))
    }

    /// Windows marks start-up entries the user turned off with an odd first byte.
    fn disabled_by_windows() -> bool {
        let name = value_name();
        let mut data = [0u8; 12];
        let mut size = data.len() as u32;
        // SAFETY: the buffer holds `size` bytes, as the call is told.
        let status = unsafe {
            RegGetValueW(
                HKEY_CURRENT_USER,
                STARTUP_APPROVED,
                &name,
                RRF_RT_REG_BINARY,
                None,
                Some(data.as_mut_ptr().cast()),
                Some(&mut size),
            )
        };
        status == ERROR_SUCCESS && size > 0 && data[0] & 1 == 1
    }

    pub fn state() -> State {
        let registered = match (read_command(), expected_command()) {
            (Some(found), Ok(expected)) => found.eq_ignore_ascii_case(&expected),
            _ => false,
        };
        State {
            registered,
            disabled_by_windows: registered && disabled_by_windows(),
        }
    }

    fn check(status: WIN32_ERROR, what: &str) -> Result<(), String> {
        if status == ERROR_SUCCESS || status == ERROR_FILE_NOT_FOUND {
            Ok(())
        } else {
            Err(format!("Windows refused to {what} (error {}).", status.0))
        }
    }

    /// Writes the `Run` value, and clears a "turned off" mark from an earlier
    /// choice in Windows' settings, since the user has just asked for it.
    pub fn register() -> Result<(), String> {
        let command = expected_command()?;
        let wide: Vec<u16> = command.encode_utf16().chain(std::iter::once(0)).collect();
        let name = value_name();
        let bytes = u32::try_from(wide.len() * 2)
            .map_err(|_| "The program path is too long to register.".to_string())?;
        // SAFETY: `wide` is NUL-terminated and `bytes` is its length in bytes.
        let status = unsafe {
            RegSetKeyValueW(
                HKEY_CURRENT_USER,
                RUN,
                &name,
                REG_SZ.0,
                Some(wide.as_ptr().cast()),
                bytes,
            )
        };
        check(status, "register BTCortex to start with Windows")?;
        // SAFETY: valid key and value names.
        let status = unsafe { RegDeleteKeyValueW(HKEY_CURRENT_USER, STARTUP_APPROVED, &name) };
        check(status, "clear the start-up setting")
    }

    pub fn unregister() -> Result<(), String> {
        let name = value_name();
        // SAFETY: valid key and value names.
        let status = unsafe { RegDeleteKeyValueW(HKEY_CURRENT_USER, RUN, &name) };
        check(status, "stop BTCortex from starting with Windows")?;
        // SAFETY: valid key and value names.
        let status = unsafe { RegDeleteKeyValueW(HKEY_CURRENT_USER, STARTUP_APPROVED, &name) };
        check(status, "clear the start-up setting")
    }
}

#[cfg(not(windows))]
mod autostart {
    pub const SUPPORTED: bool = false;

    pub struct State {
        pub registered: bool,
        pub disabled_by_windows: bool,
    }

    pub fn state() -> State {
        State {
            registered: false,
            disabled_by_windows: false,
        }
    }

    pub fn register() -> Result<(), String> {
        Err("Starting with the operating system is only available on Windows.".into())
    }

    pub fn unregister() -> Result<(), String> {
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_preferences_with_defaults_for_missing_fields() {
        assert_eq!(
            parse_preferences(r#"{"closeToTray":true}"#),
            Some(Preferences {
                close_to_tray: true,
                start_minimised: true,
            })
        );
        assert_eq!(parse_preferences("{}"), Some(Preferences::default()));
        assert_eq!(parse_preferences("not json"), None);
    }

    #[test]
    fn keeps_preferences_across_loads() {
        let directory = std::env::temp_dir().join(format!("btcortex-shell-{}", std::process::id()));
        let shell = Shell::load(Some(directory.clone()));
        assert_eq!(shell.preferences(), Preferences::default());
        shell
            .save(Preferences {
                close_to_tray: true,
                start_minimised: false,
            })
            .expect("saved");
        let again = Shell::load(Some(directory.clone()));
        assert!(again.preferences().close_to_tray);
        assert!(!again.preferences().start_minimised);
        let _ = std::fs::remove_dir_all(directory);
    }

    #[cfg(windows)]
    #[test]
    fn quotes_the_program_path_in_the_run_value() {
        let command = autostart::command_for(std::path::Path::new(
            "C:\\Users\\A B\\AppData\\Local\\Programs\\BTCortex\\btcortex.exe",
        ));
        assert_eq!(
            command,
            "\"C:\\Users\\A B\\AppData\\Local\\Programs\\BTCortex\\btcortex.exe\" --autostart"
        );
    }
}
