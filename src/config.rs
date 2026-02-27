use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;

#[derive(Debug, Serialize, Deserialize)]
pub struct ServerInfo {
    pub pid: u32,
    pub port: u16,
}

pub fn clog_dir() -> PathBuf {
    let home = std::env::var("HOME").expect("HOME not set");
    PathBuf::from(home).join(".clog")
}

pub fn logs_dir() -> PathBuf {
    clog_dir().join("logs")
}

pub fn log_file() -> PathBuf {
    logs_dir().join("clog.ndjson")
}

pub fn server_json() -> PathBuf {
    clog_dir().join("server.json")
}

pub fn server_log() -> PathBuf {
    clog_dir().join("server.log")
}

pub fn ensure_dirs() -> std::io::Result<()> {
    fs::create_dir_all(logs_dir())
}

pub fn read_server_info() -> Option<ServerInfo> {
    let data = fs::read_to_string(server_json()).ok()?;
    serde_json::from_str(&data).ok()
}

pub fn write_server_info(info: &ServerInfo) -> std::io::Result<()> {
    let data = serde_json::to_string(info).unwrap();
    fs::write(server_json(), data)
}

pub fn remove_server_info() -> std::io::Result<()> {
    fs::remove_file(server_json())
}
