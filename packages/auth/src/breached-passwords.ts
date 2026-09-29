/**
 * Offline breached-password list (ADR-0006 rule 2, ADR-0010 section 6).
 *
 * A SMALL BUNDLED LIST FOR NOW: common passwords of 12+ characters that appear at the
 * top of public breach corpora, lower-cased. Nothing leaves the platform to check a
 * password. The follow-up is the k-anonymity range list shipped with the build
 * (ADR-0010 section 6); the check function's signature stays the same.
 */
export const BREACHED_PASSWORDS: ReadonlySet<string> = new Set([
  '123456789012',
  '1234567890123',
  '12345678901234',
  '123456789123',
  '1q2w3e4r5t6y',
  '1qaz2wsx3edc',
  'abc123456789',
  'abcdefghijkl',
  'abcd12345678',
  'administrator',
  'adminadmin123',
  'asdfghjkl123',
  'basketball12',
  'changeme1234',
  'christopher1',
  'football1234',
  'iloveyou1234',
  'letmein12345',
  'letmeinplease',
  'liverpool123',
  'masterkey123',
  'michaeljordan',
  'monkeymonkey',
  'passw0rd1234',
  'password1234',
  'password12345',
  'password123456',
  'password!123',
  'passwordpassword',
  'princess1234',
  'qazwsxedcrfv',
  'qwerty123456',
  'qwertyuiop12',
  'qwertyuiop123',
  'qwertyuiopasdf',
  'starwars1234',
  'sunshine1234',
  'superman1234',
  'trustno11234',
  'welcome12345',
  'welcome2024!',
  'welcome2025!',
  'welcome2026!',
  'whatever1234',
  'zaq12wsxcde3',
  'zxcvbnm12345',
  'correcthorsebatterystaple',
  'healthcare123',
  'healthcenter1',
  'compliance123',
  'deemedhealth1',
  'deemedhealth123',
]);

/** Characters stripped from the end before the second lookup ("password1234!!" etc.). */
function stripTrailingDigitsAndSymbols(value: string): string {
  let end = value.length;
  while (end > 0) {
    const c = value.charCodeAt(end - 1);
    const letter = (c >= 97 && c <= 122) || c > 127;
    if (letter) break;
    end--;
  }
  return value.slice(0, end);
}

const BREACHED_STEMS: ReadonlySet<string> = new Set(
  [...BREACHED_PASSWORDS].map(stripTrailingDigitsAndSymbols).filter((s) => s.length >= 6),
);

/**
 * True when the password is listed, or when its stem (without trailing digits and
 * symbols) is the stem of a listed one: "Password9876!" is rejected like "password1234".
 */
export function isBreachedPassword(password: string): boolean {
  const lower = password.normalize('NFKC').toLowerCase();
  return BREACHED_PASSWORDS.has(lower) || BREACHED_STEMS.has(stripTrailingDigitsAndSymbols(lower));
}
