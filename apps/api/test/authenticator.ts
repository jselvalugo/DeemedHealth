/**
 * A software WebAuthn authenticator (ES256, "none" attestation, user verified) for
 * tests: it answers the options the API returns exactly as a browser would, so the
 * passkey paths run end to end through @simplewebauthn/server with no network.
 */
import {
  createHash,
  createSign,
  generateKeyPairSync,
  randomBytes,
  type KeyObject,
} from 'node:crypto';
import { isoCBOR } from '@simplewebauthn/server/helpers';

const b64url = (b: Buffer | Uint8Array) => Buffer.from(b).toString('base64url');
const sha256 = (b: Buffer | string) => createHash('sha256').update(b).digest();

function u32(n: number): Buffer {
  const b = Buffer.alloc(4);
  b.writeUInt32BE(n);
  return b;
}

export class SoftwareAuthenticator {
  private readonly privateKey: KeyObject;
  private readonly x: Buffer;
  private readonly y: Buffer;
  readonly credentialId = randomBytes(16);
  private counter = 0;

  constructor(
    private readonly rpId: string,
    private readonly origin: string,
  ) {
    const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
    this.privateKey = privateKey;
    const jwk = publicKey.export({ format: 'jwk' });
    this.x = Buffer.from(jwk.x as string, 'base64url');
    this.y = Buffer.from(jwk.y as string, 'base64url');
  }

  private coseKey(): Uint8Array {
    const key = new Map<number, number | Uint8Array>([
      [1, 2], // kty: EC2
      [3, -7], // alg: ES256
      [-1, 1], // crv: P-256
      [-2, new Uint8Array(this.x)],
      [-3, new Uint8Array(this.y)],
    ]);
    return isoCBOR.encode(key);
  }

  private clientData(type: string, challenge: string): Buffer {
    return Buffer.from(
      JSON.stringify({ type, challenge, origin: this.origin, crossOrigin: false }),
    );
  }

  /** navigator.credentials.create() */
  register(options: { challenge: string }) {
    const clientDataJSON = this.clientData('webauthn.create', options.challenge);
    const idLength = Buffer.alloc(2);
    idLength.writeUInt16BE(this.credentialId.length);
    const authData = Buffer.concat([
      sha256(this.rpId),
      Buffer.from([0x45]), // UP | UV | AT
      u32(this.counter),
      Buffer.alloc(16), // AAGUID
      idLength,
      this.credentialId,
      Buffer.from(this.coseKey()),
    ]);
    const attestation = new Map<string, string | Uint8Array | Map<string, string>>();
    attestation.set('fmt', 'none');
    attestation.set('attStmt', new Map<string, string>());
    attestation.set('authData', new Uint8Array(authData));
    const attestationObject = isoCBOR.encode(attestation);
    return {
      id: b64url(this.credentialId),
      rawId: b64url(this.credentialId),
      type: 'public-key',
      response: {
        clientDataJSON: b64url(clientDataJSON),
        attestationObject: b64url(attestationObject),
        transports: ['internal'],
      },
      clientExtensionResults: {},
      authenticatorAttachment: 'platform',
    };
  }

  /** navigator.credentials.get() */
  authenticate(options: { challenge: string }, { userVerified = true } = {}) {
    this.counter += 1;
    const clientDataJSON = this.clientData('webauthn.get', options.challenge);
    const authData = Buffer.concat([
      sha256(this.rpId),
      Buffer.from([userVerified ? 0x05 : 0x01]),
      u32(this.counter),
    ]);
    const signer = createSign('sha256');
    signer.update(Buffer.concat([authData, sha256(clientDataJSON)]));
    const signature = signer.sign(this.privateKey);
    return {
      id: b64url(this.credentialId),
      rawId: b64url(this.credentialId),
      type: 'public-key',
      response: {
        clientDataJSON: b64url(clientDataJSON),
        authenticatorData: b64url(authData),
        signature: b64url(signature),
      },
      clientExtensionResults: {},
    };
  }
}
