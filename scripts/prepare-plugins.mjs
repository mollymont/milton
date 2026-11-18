import { copyFile, mkdir } from 'node:fs/promises';

for (const plugin of ['plugin', 'mod']) {
  const destination = new URL(`../${plugin}/hooks/shared/`, import.meta.url);
  await mkdir(destination, { recursive: true });
  for (const file of ['recommendation.mts', 'shell-output.mts', 'coordinator.mts', 'registry.mts', 'lifecycle.mts', 'tool-sequence.mts']) {
    await copyFile(new URL(`../src/${file}`, import.meta.url), new URL(file, destination));
  }
}
