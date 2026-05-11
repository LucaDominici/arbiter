// no_std in production builds; std allowed in test to use the default test harness
#![cfg_attr(not(test), no_std)]

/// Fixed-point saturating add for embedded use.
/// Both operands are 8.8 fixed-point (u16).
#[must_use]
pub fn fixed_add(a: u16, b: u16) -> u16 {
    a.saturating_add(b)
}

/// Map a raw ADC reading (0..4095) to a percentage (0..100).
#[must_use]
pub fn adc_to_percent(raw: u16) -> u8 {
    ((raw as u32 * 100) / 4095) as u8
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn fixed_add_no_overflow() {
        assert_eq!(fixed_add(100, 200), 300);
    }

    #[test]
    fn fixed_add_saturates() {
        assert_eq!(fixed_add(u16::MAX, 1), u16::MAX);
    }

    #[test]
    fn adc_full_scale() {
        assert_eq!(adc_to_percent(4095), 100);
    }

    #[test]
    fn adc_zero() {
        assert_eq!(adc_to_percent(0), 0);
    }
}
