import { auditProjectInstructions } from '../src/project-audit.mts';
import { optimizationRegistry } from '../src/registry.mts';

const args = process.argv.slice(2);
const preview = args.includes('--preview');
const directories = args.filter(arg => !arg.startsWith('-'));
if (directories.length > 1 || args.some(arg => arg.startsWith('-') && arg !== '--preview')) {
  console.error('Usage: npm run audit -- [PROJECT_DIRECTORY] [--preview]');
  process.exitCode = 2;
} else {
  const result = await auditProjectInstructions(directories[0] ?? process.cwd(), preview);
  console.log(`Audited ${result.files.length} project instruction files. Skipped or unsupported: ${result.skipped}.`);
  if (!result.findings.length) console.log('No supported recommendation found in the inspected files.');
  for (const { recommendation, location, preview: diff } of result.findings) {
    console.log(`${location} · ${recommendation.message} Task-level savings: ${recommendation.savings}.`);
    console.log(optimizationRegistry.find(rule => rule.id === recommendation.ruleId)?.documentation);
    if (diff) process.stdout.write(diff);
  }
}
