// A fixed UI message keeps Phase 1 independent of session content.
process.stdout.write(JSON.stringify({
  systemMessage: 'Efficiency companion · ready',
}));
