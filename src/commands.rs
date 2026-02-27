use std::fs::{self, File, OpenOptions};
use std::io::{BufRead, BufReader};
use std::process::Command;
use std::thread;
use std::time::Duration;

use crate::config;

pub fn start() {
    if let Some(info) = config::read_server_info() {
        if process_alive(info.pid) {
            eprintln!("clog server already running on port {} (pid {})", info.port, info.pid);
            return;
        }
        let _ = config::remove_server_info();
    }

    config::ensure_dirs().expect("failed to create clog directories");

    let _ = config::remove_server_info();

    let exe = std::env::current_exe().expect("failed to get current exe path");

    let log_file = OpenOptions::new()
        .create(true)
        .append(true)
        .open(config::server_log())
        .expect("failed to open server log");
    let log_file_err = log_file.try_clone().expect("failed to clone log file handle");

    let child = Command::new(exe)
        .arg("_serve")
        .stdout(log_file)
        .stderr(log_file_err)
        .stdin(std::process::Stdio::null())
        .spawn()
        .expect("failed to spawn server process");

    eprintln!("spawned server process (pid {}), waiting for it to start...", child.id());

    for _ in 0..50 {
        thread::sleep(Duration::from_millis(100));
        if let Some(info) = config::read_server_info() {
            eprintln!("clog server started on port {} (pid {})", info.port, info.pid);
            return;
        }
    }

    eprintln!("timed out waiting for server to start — check ~/.clog/server.log");
}

pub fn stop() {
    let Some(info) = config::read_server_info() else {
        eprintln!("no server running (server.json not found)");
        return;
    };

    if process_alive(info.pid) {
        unsafe {
            libc::kill(info.pid as i32, libc::SIGTERM);
        }
        eprintln!("sent SIGTERM to pid {}", info.pid);
    } else {
        eprintln!("process {} not alive (stale server.json)", info.pid);
    }

    let _ = config::remove_server_info();
    eprintln!("removed server.json");
}

pub fn status() {
    match config::read_server_info() {
        Some(info) => {
            let alive = process_alive(info.pid);
            println!("server: {}", if alive { "running" } else { "dead (stale server.json)" });
            println!("pid: {}", info.pid);
            println!("port: {}", info.port);
        }
        None => {
            println!("server: not running");
        }
    }

    let log_path = config::log_file();
    match fs::metadata(&log_path) {
        Ok(meta) => {
            let size = meta.len();
            let (display_size, unit) = if size >= 1_048_576 {
                (size as f64 / 1_048_576.0, "MB")
            } else if size >= 1024 {
                (size as f64 / 1024.0, "KB")
            } else {
                (size as f64, "B")
            };
            println!("log file: {} ({:.1} {})", log_path.display(), display_size, unit);
        }
        Err(_) => {
            println!("log file: {} (not created yet)", log_path.display());
        }
    }
}

pub fn latest(n: usize, query: Option<&str>) {
    let log_path = config::log_file();
    let file = match File::open(&log_path) {
        Ok(f) => f,
        Err(_) => {
            eprintln!("no log file found at {}", log_path.display());
            return;
        }
    };

    let reader = BufReader::new(file);
    let all_lines: Vec<String> = reader.lines().map_while(Result::ok).collect();

    let filtered: Vec<&String> = if let Some(q) = query {
        all_lines.iter().filter(|line| line.contains(q)).collect()
    } else {
        all_lines.iter().collect()
    };

    let start = filtered.len().saturating_sub(n);
    for line in &filtered[start..] {
        println!("{line}");
    }
}

pub fn clear() {
    let log_path = config::log_file();
    match File::create(&log_path) {
        Ok(_) => eprintln!("log file truncated"),
        Err(e) => eprintln!("failed to truncate log file: {e}"),
    }
}

pub fn init() {
    let skill_dir = std::path::Path::new(".claude/skills/reproduce");
    let skill_file = skill_dir.join("SKILL.md");

    if skill_file.exists() {
        eprintln!("clog skill already installed at {}", skill_file.display());
        return;
    }

    const SKILL_MD: &str = include_str!("../skills/reproduce.md");
    fs::create_dir_all(skill_dir).expect("failed to create .claude/skills/reproduce/");
    fs::write(&skill_file, SKILL_MD).expect("failed to write SKILL.md");
    eprintln!("installed clog reproduce skill at {}", skill_file.display());
}

fn process_alive(pid: u32) -> bool {
    unsafe { libc::kill(pid as i32, 0) == 0 }
}
