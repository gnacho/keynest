import { lstatSync, unlinkSync } from 'node:fs';
import { basename, resolve, sep } from 'node:path';

export function isSafeStoredPhotoPath(storedPath: unknown): storedPath is string {
  if (typeof storedPath !== 'string' || !storedPath.startsWith('/photos/')) return false;
  const filename = storedPath.slice('/photos/'.length);
  return filename.length > 0
    && filename === basename(filename)
    && filename !== '.'
    && filename !== '..'
    && !filename.includes('/')
    && !filename.includes('\\')
    && !filename.includes('\0');
}

export function isOwnedStoredPhoto(currentPhotos: readonly string[], candidate: string): boolean {
  return currentPhotos.includes(candidate);
}

export function removeStoredPhoto(photosDir: string, storedPath: string): boolean {
  if (!isSafeStoredPhotoPath(storedPath)) return false;
  const root = resolve(photosDir);
  const target = resolve(root, storedPath.slice('/photos/'.length));
  if (!target.startsWith(root + sep)) return false;
  try {
    const rootStat = lstatSync(root);
    if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) return false;
    if (!lstatSync(target).isFile()) return false;
    unlinkSync(target);
    return true;
  } catch {
    return false;
  }
}
