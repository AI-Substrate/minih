/**
 * Test helper — generates valid system output JSON for FakeAgentAdapter.
 */
export function validSystemOutput(
  overrides: Record<string, unknown> = {},
): string {
  return JSON.stringify({
    summary:
      'This is a valid test summary paragraph that meets the minimum length requirement.',
    retrospective: {
      workedWell: 'The test setup was smooth and efficient.',
      confusing: 'Nothing was confusing in this test run.',
      magicWand:
        'I wish the test framework had built-in snapshot support for JSON output validation.',
    },
    ...overrides,
  });
}
