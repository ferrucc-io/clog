use axum::{Router, extract::Json, http::StatusCode, routing::post};
use chrono::Utc;
use serde_json::Value;
use std::fs::OpenOptions;
use std::io::Write;
use std::net::SocketAddr;
use tokio::net::TcpListener;
use tower_http::cors::CorsLayer;

use crate::config;

pub async fn run(port: u16) -> std::io::Result<()> {
    config::ensure_dirs()?;

    let app = Router::new()
        .route("/", post(handle_log))
        .route("/log", post(handle_log))
        .layer(CorsLayer::permissive());

    let addr = SocketAddr::from(([127, 0, 0, 1], port));
    let listener = TcpListener::bind(addr).await?;
    let actual_port = listener.local_addr()?.port();

    let info = config::ServerInfo {
        pid: std::process::id(),
        port: actual_port,
    };
    config::write_server_info(&info)?;

    eprintln!("clog server listening on port {actual_port}");

    axum::serve(listener, app).await?;
    Ok(())
}

async fn handle_log(Json(body): Json<Value>) -> (StatusCode, Json<Value>) {
    let wrapped = serde_json::json!({
        "ts": Utc::now().to_rfc3339(),
        "data": body,
    });

    let line = serde_json::to_string(&wrapped).unwrap();

    let result = OpenOptions::new()
        .create(true)
        .append(true)
        .open(config::log_file())
        .and_then(|mut f| writeln!(f, "{line}"));

    match result {
        Ok(()) => (StatusCode::OK, Json(serde_json::json!({"ok": true}))),
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({"ok": false, "error": e.to_string()})),
        ),
    }
}
