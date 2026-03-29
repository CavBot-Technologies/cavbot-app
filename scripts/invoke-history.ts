import 'dotenv/config';
import { prisma } from '../lib/prisma';
import { GET } from '../app/api/settings/history/route';
import { NextRequest } from 'next/server';
import { webcrypto as nodeCrypto } from 'crypto';

const SESSION_SECRET = process.env.CAVBOT_SESSION_SECRET || '';
if (!SESSION_SECRET) throw new Error('missing session secret');

function base64urlEncode(bytes: Uint8Array) {
  const b64 = Buffer.from(bytes).toString('base64');
  return b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

async function hmacSha256(secret: string, data: string) {
  const key = await nodeCrypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await nodeCrypto.subtle.sign('HMAC', key, new TextEncoder().encode(data));
  return base64urlEncode(new Uint8Array(sig));
}

async function signSession(payload: Record<string, unknown>) {
  const payloadJson = JSON.stringify(payload);
  const payloadB64 = base64urlEncode(new TextEncoder().encode(payloadJson));
  const sig = await hmacSha256(SESSION_SECRET, payloadB64);
  return `${payloadB64}.${sig}`;
}

async function main() {
  const membership = await prisma.membership.findFirst({
    select: { userId: true, accountId: true, role: true },
  });
  if (!membership) throw new Error('no membership');
  const iat = Math.floor(Date.now() / 1000);
  const exp = iat + 60 * 60 * 8;
  const session = {
    v: 1,
    sub: membership.userId,
    systemRole: 'user',
    accountId: membership.accountId,
    memberRole: membership.role,
    iat,
    exp,
    sv: 1,
  } as const;
  const token = await signSession(session as Record<string, unknown>);
  const req = new NextRequest('http://localhost/api/settings/history?category=all&limit=24', {
    headers: { cookie: `cavbot_session=${token}`, host: 'localhost:3000' },
    method: 'GET',
  });

  const res = await GET(req);
  console.log('status', res.status);
  console.log(await res.text());
}

main()
  .finally(() => prisma.$disconnect())
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
