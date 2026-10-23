mod shell;
mod sidecar;
mod vault;

use std::path::PathBuf;
use std::sync::Arc;

use tauri::{Manager, RunEvent, WindowEvent};
use tauri_plugin_log::{RotationStrategy, Target, TargetKind};
use tauri_plugin_window_state::StateFlags;

use sidecar::Orchestrator;

const LOG_FILE_BYTES: u128 = 5 * 1024 * 1024;
const LOG_FILES_KEPT: usize = 5;

/// Mirrors the orchestrator's data directory rules (apps/orchestrator/src/platform/paths.ts).
fn data_directory() -> Option<PathBuf> {
    if let Ok(root) = std::env::var("BTCORTEX_DATA_DIR") {
        return Some(PathBuf::from(root));
    }
    let folder = if cfg!(debug_assertions) {
        "BTCortex-dev"
    } else {
        "BTCortex"
    };
    std::env::var_os("LOCALAPPDATA").map(|base| PathBuf::from(base).join(folder))
}

fn logs_directory() -> Option<PathBuf> {
    data_directory().map(|directory| directory.join("logs"))
}

fn log_plugin() -> tauri::plugin::TauriPlugin<tauri::Wry> {
    let mut builder = tauri_plugin_log::Builder::new()
        .clear_targets()
        .level(if cfg!(debug_assertions) {
            log::LevelFilter::Debug
        } else {
            log::LevelFilter::Info
        })
        .max_file_size(LOG_FILE_BYTES)
        .rotation_strategy(RotationStrategy::KeepSome(LOG_FILES_KEPT));
    if let Some(path) = logs_directory() {
        builder = builder.target(Target::new(TargetKind::Folder {
            path,
            file_name: Some("shell".into()),
        }));
    }
    if cfg!(debug_assertions) {
        builder = builder.target(Target::new(TargetKind::Stderr));
    }
    builder.build()
}

/// Share of the monitor's work area the window may cover when it does not fit.
const WORK_AREA_FRACTION: f64 = 0.92;

/// Shrinks the window to the monitor's work area (the screen minus the taskbar)
/// when the configured or restored size does not fit, for example on laptops
/// with 125 % display scaling, and centres it again.
fn fit_to_work_area(window: &tauri::WebviewWindow) {
    let Ok(Some(monitor)) = window.current_monitor() else {
        return;
    };
    let Ok(size) = window.outer_size() else {
        return;
    };
    let area = monitor.work_area();
    let max_width = (f64::from(area.size.width) * WORK_AREA_FRACTION) as u32;
    let max_height = (f64::from(area.size.height) * WORK_AREA_FRACTION) as u32;
    if size.width <= area.size.width && size.height <= area.size.height {
        return;
    }
    let fitted = tauri::PhysicalSize::new(size.width.min(max_width), size.height.min(max_height));
    if let Err(error) = window.set_size(fitted) {
        log::warn!("Could not fit the window to the screen: {error}");
        return;
    }
    let x = area.position.x + ((area.size.width - fitted.width) / 2) as i32;
    let y = area.position.y + ((area.size.height - fitted.height) / 2) as i32;
    let _ = window.set_position(tauri::PhysicalPosition::new(x, y));
}

pub fn run() {
    let orchestrator = Orchestrator::new();
    let starter = Arc::clone(&orchestrator);

    let app = tauri::Builder::default()
        // Must be registered first: a second launch focuses the existing window instead.
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            shell::show_main_window(app);
        }))
        .plugin(log_plugin())
        // Visibility is the shell's own decision: a start with Windows can stay
        // in the notification area, and a window closed to it is not restored hidden.
        .plugin(
            tauri_plugin_window_state::Builder::default()
                .with_state_flags(StateFlags::all().difference(StateFlags::VISIBLE))
                .build(),
        )
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_opener::init())
        .manage(orchestrator)
        .manage(shell::Shell::load(data_directory()))
        .invoke_handler(tauri::generate_handler![
            sidecar::orchestrator_call,
            sidecar::orchestrator_status,
            shell::shell_settings,
            shell::shell_update_settings
        ])
        .on_window_event(|window, event| {
            if let WindowEvent::CloseRequested { api, .. } = event
                && shell::close_to_tray(window)
            {
                api.prevent_close();
            }
        })
        .setup(move |app| {
            if let Err(error) = shell::create_tray(app.handle()) {
                log::warn!("Could not create the notification-area icon: {error}");
            }
            if let Some(window) = app.get_webview_window("main") {
                fit_to_work_area(&window);
                let stay_hidden = shell::started_by_windows()
                    && app.state::<shell::Shell>().preferences().start_minimised;
                if stay_hidden {
                    log::info!("Started with Windows: staying in the notification area");
                } else {
                    let _ = window.show();
                    let _ = window.set_focus();
                }
            }
            let handle = app.handle().clone();
            tauri::async_runtime::spawn(async move { starter.supervise(handle).await });
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("BTCortex could not initialise its window");

    app.run(|handle, event| {
        if let RunEvent::Exit = event {
            let orchestrator = Arc::clone(handle.state::<Arc<Orchestrator>>().inner());
            tauri::async_runtime::block_on(orchestrator.shutdown());
        }
    });
}
