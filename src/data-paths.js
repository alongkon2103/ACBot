import { cpSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
export const SEED_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '../data');
export const DATA_DIR = resolve(process.env.BOT_DATA_DIR || 'data');
export const ASSET_DIR = join(DATA_DIR, 'assets');
export function initializeData(destination = DATA_DIR, source = SEED_DIR) {
  mkdirSync(join(destination, 'assets'), { recursive: true });
  if (resolve(destination) === resolve(source)) return;
  for (const name of ['bot.json', 'server-setup.json']) {
    if (!existsSync(join(destination, name)) && existsSync(join(source, name))) cpSync(join(source, name), join(destination, name), { force: false });
  }
  if (existsSync(join(source, 'assets'))) cpSync(join(source, 'assets'), join(destination, 'assets'), { recursive: true, force: false });
}
