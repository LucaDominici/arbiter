/// Adds two integers.
pub fn add(a: i64, b: i64) -> i64 {
    a + b
}

/// Multiplies two integers.
pub fn multiply(a: i64, b: i64) -> i64 {
    a * b
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn adds_two_numbers() {
        assert_eq!(add(2, 3), 5);
    }

    #[test]
    fn multiplies_two_numbers() {
        assert_eq!(multiply(3, 4), 12);
    }
}
