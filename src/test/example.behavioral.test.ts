/**
 * Example of Given/When/Then behavioral test structure using Vitest.
 *
 * Pattern: outer describe = subject; nested describe = context (given X);
 * it() = behaviour assertion (when Y then Z).
 * Replace 'exampleSubject' with the function or module under test.
 */
import { describe, it, expect } from 'vitest'

describe('exampleSubject', () => {
  describe('given a valid input', () => {
    it('when processed, returns the expected result', () => {
      // Arrange
      const input = 'hello'

      // Act
      const result = input.toUpperCase()

      // Assert
      expect(result).toBe('HELLO')
    })

    it('when chained, transforms correctly', () => {
      // Arrange
      const input = '  hello  '

      // Act
      const result = input.trim().toUpperCase()

      // Assert
      expect(result).toBe('HELLO')
    })
  })

  describe('given an empty input', () => {
    it('when processed, returns empty string', () => {
      // Arrange
      const input = ''

      // Act
      const result = input.toUpperCase()

      // Assert
      expect(result).toBe('')
    })
  })
})
