/**
 * Passkeys (WebAuthn) through @simplewebauthn/server (ADR-0006 rule 3, ADR-0010
 * section 6). User verification is required, attestation is not requested (no
 * authenticator allow-list in Phase 1), and challenges are single use: the caller
 * stores the challenge and clears it after one verification attempt.
 */
import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
  type AuthenticationResponseJSON,
  type AuthenticatorTransportFuture,
  type PublicKeyCredentialCreationOptionsJSON,
  type PublicKeyCredentialRequestOptionsJSON,
  type RegistrationResponseJSON,
} from '@simplewebauthn/server';

export interface WebAuthnConfig {
  /** Relying party id: the registrable domain of the web app (e.g. "localhost"). */
  rpId: string;
  rpName: string;
  /** Exact origins the browser may report (e.g. "https://dev.example.org"). */
  origins: readonly string[];
}

export interface StoredPasskey {
  credentialId: string;
  publicKey: Buffer;
  counter: number;
  transports: readonly string[] | null;
}

const TRANSPORTS: readonly AuthenticatorTransportFuture[] = [
  'ble',
  'cable',
  'hybrid',
  'internal',
  'nfc',
  'smart-card',
  'usb',
];

function transportsOf(
  values: readonly string[] | null,
): AuthenticatorTransportFuture[] | undefined {
  if (!values) return undefined;
  return values.filter((t): t is AuthenticatorTransportFuture =>
    (TRANSPORTS as readonly string[]).includes(t),
  );
}

function uuidBytes(uuid: string): Uint8Array<ArrayBuffer> {
  return new Uint8Array(Buffer.from(uuid.split('-').join(''), 'hex'));
}

export async function passkeyRegistrationOptions(
  config: WebAuthnConfig,
  user: { userAccountId: string; email: string; displayName: string },
  existing: readonly StoredPasskey[],
): Promise<PublicKeyCredentialCreationOptionsJSON> {
  return generateRegistrationOptions({
    rpName: config.rpName,
    rpID: config.rpId,
    userID: uuidBytes(user.userAccountId),
    userName: user.email,
    userDisplayName: user.displayName,
    attestationType: 'none',
    excludeCredentials: existing.map((c) => {
      const transports = transportsOf(c.transports);
      return { id: c.credentialId, ...(transports ? { transports } : {}) };
    }),
    authenticatorSelection: { residentKey: 'preferred', userVerification: 'required' },
  });
}

export async function verifyPasskeyRegistration(
  config: WebAuthnConfig,
  response: unknown,
  expectedChallenge: string,
): Promise<StoredPasskey | null> {
  try {
    const result = await verifyRegistrationResponse({
      response: response as RegistrationResponseJSON,
      expectedChallenge,
      expectedOrigin: [...config.origins],
      expectedRPID: config.rpId,
      requireUserVerification: true,
    });
    if (!result.verified) return null;
    const { credential } = result.registrationInfo;
    return {
      credentialId: credential.id,
      publicKey: Buffer.from(credential.publicKey),
      counter: credential.counter,
      transports: credential.transports ?? null,
    };
  } catch {
    return null;
  }
}

export async function passkeyAuthenticationOptions(
  config: WebAuthnConfig,
  credentials: readonly StoredPasskey[],
): Promise<PublicKeyCredentialRequestOptionsJSON> {
  return generateAuthenticationOptions({
    rpID: config.rpId,
    userVerification: 'required',
    allowCredentials: credentials.map((c) => {
      const transports = transportsOf(c.transports);
      return { id: c.credentialId, ...(transports ? { transports } : {}) };
    }),
  });
}

/** The credential id the browser answered with, or null when the payload is malformed. */
export function responseCredentialId(response: unknown): string | null {
  if (typeof response !== 'object' || response === null) return null;
  const id = (response as { id?: unknown }).id;
  return typeof id === 'string' && id.length > 0 && id.length <= 1024 ? id : null;
}

/** Returns the new signature counter, or null when verification fails. */
export async function verifyPasskeyAuthentication(
  config: WebAuthnConfig,
  response: unknown,
  expectedChallenge: string,
  credential: StoredPasskey,
): Promise<number | null> {
  try {
    const transports = transportsOf(credential.transports);
    const result = await verifyAuthenticationResponse({
      response: response as AuthenticationResponseJSON,
      expectedChallenge,
      expectedOrigin: [...config.origins],
      expectedRPID: config.rpId,
      requireUserVerification: true,
      credential: {
        id: credential.credentialId,
        publicKey: new Uint8Array(credential.publicKey),
        counter: credential.counter,
        ...(transports ? { transports } : {}),
      },
    });
    return result.verified ? result.authenticationInfo.newCounter : null;
  } catch {
    return null;
  }
}
