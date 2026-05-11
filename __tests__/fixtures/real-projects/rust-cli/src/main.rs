use clap::Parser;

#[derive(Parser, Debug)]
#[command(name = "rust-cli-fixture", version, about = "Fixture CLI for arbiter tests")]
struct Args {
    #[arg(short, long, default_value = "world")]
    name: String,
}

fn main() {
    let args = Args::parse();
    println!("Hello, {}!", args.name);
}

pub fn greet(name: &str) -> String {
    format!("Hello, {name}!")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn greet_returns_expected_string() {
        assert_eq!(greet("arbiter"), "Hello, arbiter!");
    }

    #[test]
    fn greet_with_empty_name() {
        assert_eq!(greet(""), "Hello, !");
    }
}
