import { mkdtempSync, mkdirSync, rmSync, writeFileSync, existsSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { isOwnedStoredPhoto, removeStoredPhoto } from '../src/photo-path.js';

let dir: string;
let photosDir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'keynest-photo-path-'));
  photosDir = join(dir, 'photos');
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('stored photo deletion', () => {
  it('refuses parent traversal and preserves the outside file', () => {
    writeFileSync(join(dir, 'outside.txt'), 'keep');
    expect(removeStoredPhoto(photosDir, '/photos/../outside.txt')).toBe(false);
    expect(existsSync(join(dir, 'outside.txt'))).toBe(true);
  });

  it('deletes a regular photo inside the managed directory', () => {
    mkdirSync(photosDir);
    const photo = join(photosDir, 'property-123.jpg');
    writeFileSync(photo, 'photo');
    expect(removeStoredPhoto(photosDir, '/photos/property-123.jpg')).toBe(true);
    expect(existsSync(photo)).toBe(false);
  });

  it('refuses a symbolic link even when its name is safe', () => {
    mkdirSync(photosDir);
    const outside = join(dir, 'outside.txt');
    const link = join(photosDir, 'linked.jpg');
    writeFileSync(outside, 'keep');
    symlinkSync(outside, link);
    expect(removeStoredPhoto(photosDir, '/photos/linked.jpg')).toBe(false);
    expect(existsSync(outside)).toBe(true);
    expect(existsSync(link)).toBe(true);
  });

  it('allows managed photos only when the entity already owns them', () => {
    expect(isOwnedStoredPhoto([], '/photos/victim-123.jpg')).toBe(false);
    expect(isOwnedStoredPhoto(['/photos/other-123.jpg'], '/photos/victim-123.jpg')).toBe(false);
    expect(isOwnedStoredPhoto(['/photos/victim-123.jpg'], '/photos/victim-123.jpg')).toBe(true);
  });

  it('refuses a symbolic link in the managed directory itself', () => {
    const outside = join(dir, 'outside-photos');
    mkdirSync(outside);
    writeFileSync(join(outside, 'victim.jpg'), 'keep');
    symlinkSync(outside, photosDir);

    expect(removeStoredPhoto(photosDir, '/photos/victim.jpg')).toBe(false);
    expect(existsSync(join(outside, 'victim.jpg'))).toBe(true);
  });
});
