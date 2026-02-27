mod commands;
mod config;
mod server;

use clap::{Parser, Subcommand};

#[derive(Parser)]
#[command(name = "clog", about = "Local log ingestion CLI")]
struct Cli {
    #[command(subcommand)]
    command: Option<Commands>,

    /// Number of lines to show (when querying logs)
    #[arg(short, default_value_t = 10)]
    n: usize,

    /// Filter lines containing this pattern
    #[arg(short)]
    q: Option<String>,
}

#[derive(Subcommand)]
enum Commands {
    /// Start the log ingestion server
    Start,
    /// Stop the log ingestion server
    Stop,
    /// Show server status and log file info
    Status,
    /// Truncate the log file
    Clear,
    /// Install the clog reproduce skill into the current project's .claude/skills/
    Init,
    /// Internal: run the HTTP server (not for direct use)
    #[command(hide = true)]
    #[command(name = "_serve")]
    Serve,
}

fn main() {
    let cli = Cli::parse();

    match cli.command {
        None => commands::latest(cli.n, cli.q.as_deref()),
        Some(Commands::Start) => commands::start(),
        Some(Commands::Stop) => commands::stop(),
        Some(Commands::Status) => commands::status(),
        Some(Commands::Clear) => commands::clear(),
        Some(Commands::Init) => commands::init(),
        Some(Commands::Serve) => {
            let rt = tokio::runtime::Runtime::new().expect("failed to create tokio runtime");
            rt.block_on(async {
                if let Err(e) = server::run(2999).await {
                    eprintln!("server error: {e}");
                    std::process::exit(1);
                }
            });
        }
    }
}
