// Lumen — document storage.
//
// These files are children's admission forms, medical records and staff bank
// details. That obliges more than "write it to a folder":
//
//   Encryption at rest   Every file is AES-256-GCM encrypted before it touches
//                        disk. A copied storage/ folder (stolen laptop, careless
//                        backup) is ciphertext without the key.
//   Authenticated reads  Nothing here is web-served. Files come back only
//                        through routes that re-check the caller's JWT and
//                        school — a stronger guarantee than time-limited signed
//                        URLs, which anyone holding the link can open.
//   Content sniffing     Uploads are verified against their magic bytes; an
//                        .exe renamed to .pdf is rejected before it is stored.
//                        (A real AV daemon — ClamAV — slots into sniffFile as
//                        the natural hook point; byte-sniffing is the honest
//                        subset we can do without one.)
//   Retention            Failed and abandoned uploads are swept on a schedule;
//                        records a school committed are never auto-deleted.
//   Portability          Everything goes through this module, so pointing it
//                        at S3/GCS later is a one-file change. Backup story
//                        today: snapshot `meridian.db` + `storage/` together —
//                        they are the whole state of the system.
//
// On the key: taken from LUMEN_STORAGE_KEY, or derived from the JWT secret in
// dev so the demo works with zero setup. Production deployments should set the
// dedicated key — env.ts documents this — so storage and session credentials
// rotate independently.

import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { prisma } from '../../lib/prisma.js';
import { env } from '../../config/env.js';
import { badRequest } from '../../lib/errors.js';

const ROOT = path.resolve(process.cwd(), 'storage', 'documents');

// ─────────────────────────  encryption at rest  ─────────────────────────

/** File header identifying our envelope: magic + version. */
const MAGIC = Buffer.from('LMN1');
const IV_LEN = 12;
const TAG_LEN = 16;

const KEY: Buffer = crypto
  .createHash('sha256')
  .update(env.lumenStorageKey || `${env.jwtSecret}:lumen-storage-v1`)
  .digest();

function encrypt(plain: Buffer): Buffer {
  const iv = crypto.randomBytes(IV_LEN);
  const cipher = crypto.createCipheriv('aes-256-gcm', KEY, iv);
  const body = Buffer.concat([cipher.update(plain), cipher.final()]);
  return Buffer.concat([MAGIC, iv, cipher.getAuthTag(), body]);
}

function decrypt(stored: Buffer): Buffer {
  // Files written before encryption landed have no envelope; serve them as-is
  // rather than bricking a school's existing archive. They re-encrypt the
  // next time their document is reprocessed (previews are rewritten then).
  if (stored.length < MAGIC.length + IV_LEN + TAG_LEN || !stored.subarray(0, MAGIC.length).equals(MAGIC)) {
    return stored;
  }
  const iv = stored.subarray(MAGIC.length, MAGIC.length + IV_LEN);
  const tag = stored.subarray(MAGIC.length + IV_LEN, MAGIC.length + IV_LEN + TAG_LEN);
  const body = stored.subarray(MAGIC.length + IV_LEN + TAG_LEN);
  const decipher = crypto.createDecipheriv('aes-256-gcm', KEY, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(body), decipher.final()]);
}

// ─────────────────────────  content validation  ─────────────────────────

const SIGNATURES: { name: string; ext: string; test: (b: Buffer) => boolean }[] = [
  { name: 'PDF', ext: '.pdf', test: (b) => b.subarray(0, 5).toString('latin1') === '%PDF-' },
  { name: 'PNG', ext: '.png', test: (b) => b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) },
  { name: 'JPEG', ext: '.jpg', test: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  { name: 'WEBP', ext: '.webp', test: (b) => b.subarray(0, 4).toString('latin1') === 'RIFF' && b.subarray(8, 12).toString('latin1') === 'WEBP' },
  { name: 'TIFF', ext: '.tiff', test: (b) => b.subarray(0, 4).equals(Buffer.from([0x49, 0x49, 0x2a, 0x00])) || b.subarray(0, 4).equals(Buffer.from([0x4d, 0x4d, 0x00, 0x2a])) },
];

/**
 * Verify an upload's bytes actually are one of the formats we process.
 * Extensions and MIME types are claims the client makes; bytes are evidence.
 * This is also the seam where a proper virus scanner would sit.
 */
export function sniffFile(buffer: Buffer, fileName: string): { name: string; ext: string } {
  if (!buffer?.length) throw badRequest('The uploaded file is empty.');
  const match = SIGNATURES.find((s) => s.test(buffer));
  if (!match) {
    throw badRequest(
      `"${fileName}" is not a recognisable PDF or image — its content does not match any supported format. ` +
        'If this is a scan, re-export it as PDF, PNG or JPG.',
    );
  }
  return { name: match.name, ext: match.ext };
}

// ─────────────────────────────  files  ─────────────────────────────

/** Reject anything that could climb out of the storage root. */
function safeId(id: string): string {
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(id)) throw new Error('Invalid document id');
  return id;
}

export function docDir(documentId: string): string {
  return path.join(ROOT, safeId(documentId));
}

export async function saveOriginal(documentId: string, fileName: string, buffer: Buffer): Promise<string> {
  const dir = docDir(documentId);
  await fs.mkdir(dir, { recursive: true });
  // The stored extension comes from the sniffed content, never from the
  // client's filename — the filename is display metadata, nothing more.
  const { ext } = sniffFile(buffer, fileName);
  const target = path.join(dir, `original${ext}`);
  await fs.writeFile(target, encrypt(buffer));
  return target;
}

export async function savePagePreview(documentId: string, index: number, jpeg: Buffer): Promise<string> {
  const dir = docDir(documentId);
  await fs.mkdir(dir, { recursive: true });
  const target = path.join(dir, `page-${index}.jpg`);
  await fs.writeFile(target, encrypt(jpeg));
  return target;
}

export async function readPagePreview(documentId: string, index: number): Promise<Buffer | null> {
  if (!Number.isInteger(index) || index < 0 || index > 999) return null;
  try {
    return decrypt(await fs.readFile(path.join(docDir(documentId), `page-${index}.jpg`)));
  } catch {
    return null;
  }
}

export async function readOriginal(documentId: string): Promise<{ buffer: Buffer; ext: string } | null> {
  try {
    const dir = docDir(documentId);
    const files = await fs.readdir(dir);
    const original = files.find((f) => f.startsWith('original'));
    if (!original) return null;
    return { buffer: decrypt(await fs.readFile(path.join(dir, original))), ext: path.extname(original) };
  } catch {
    return null;
  }
}

/** Remove every artefact for a document — used when a record is deleted. */
export async function purgeDocument(documentId: string): Promise<void> {
  await fs.rm(docDir(documentId), { recursive: true, force: true });
}

// ─────────────────────────────  retention  ─────────────────────────────

/**
 * The retention sweep, run daily (see index.ts):
 *
 *  - FAILED documents older than the retention window are deleted — they hold
 *    an uploaded file that never became data, and keeping broken uploads
 *    forever is liability without value.
 *  - Storage directories whose database row no longer exists are removed
 *    (crash debris between a delete and its purge).
 *  - Anything QUEUED/PROCESSING/REVIEW/VERIFIED/COMMITTED is untouchable here:
 *    live work and committed records are the school's, not the janitor's.
 */
export async function runRetentionSweep(): Promise<{ removedDocs: number; removedOrphans: number }> {
  const cutoff = new Date(Date.now() - env.lumenRetentionDays * 864e5);

  const stale = await prisma.document.findMany({
    where: { status: 'FAILED', updatedAt: { lt: cutoff } },
    select: { id: true },
  });
  for (const doc of stale) {
    await prisma.document.delete({ where: { id: doc.id } }).catch(() => {});
    await purgeDocument(doc.id);
  }

  let removedOrphans = 0;
  try {
    const dirs = await fs.readdir(ROOT);
    if (dirs.length) {
      const known = new Set(
        (await prisma.document.findMany({ select: { id: true } })).map((d) => d.id),
      );
      for (const dir of dirs) {
        if (!known.has(dir) && /^[A-Za-z0-9_-]{1,64}$/.test(dir)) {
          await fs.rm(path.join(ROOT, dir), { recursive: true, force: true });
          removedOrphans++;
        }
      }
    }
  } catch {
    // storage/ not created yet — nothing to sweep.
  }

  if (stale.length || removedOrphans) {
    console.log(`[lumen/retention] removed ${stale.length} stale failed doc(s), ${removedOrphans} orphan dir(s)`);
  }
  return { removedDocs: stale.length, removedOrphans };
}
