/**
 * Sign-in, second factor, step-up, and sign-out endpoints (ADR-0006 rules 2-5, 11).
 * Every path that ends in a session goes through a verified second factor in
 * packages/auth; these handlers only move cookies and validate bodies.
 */
import { SESSION_POLICY, type IssuedSession } from '@deemed/auth';
import {
  EnrollmentStartRequest,
  LoginRequest,
  PasskeyEnrollmentVerifyRequest,
  PasskeyResponseRequest,
  TotpCodeRequest,
  TotpEnrollmentVerifyRequest,
  type LoginResponse,
  type ReauthResponse,
  type SessionIssuedResponse,
} from '@deemed/domain';
import type { Handler, Helpers } from '../context.js';
import type { RouteId } from '../manifest.js';

function signedIn(h: Helpers, issued: IssuedSession): SessionIssuedResponse {
  h.clearSigninCookie();
  h.setSessionCookie(issued.token, issued.absoluteExpiresAt);
  return { signedIn: true, csrfToken: issued.csrfToken };
}

function reauthed(at: Date): ReauthResponse {
  return { reauthenticatedAt: at.toISOString(), validForSeconds: SESSION_POLICY.recentAuthSeconds };
}

export const authHandlers = {
  'auth.login': async (_req, _reply, h): Promise<LoginResponse> => {
    const body = h.body(LoginRequest);
    // Rotation on login: a session cookie presented here ends now.
    await h.services.auth.revokePresentedSession(h.cookie('session'), h.ctx.meta);
    h.clearSessionCookie();
    const step = await h.services.auth.login(
      {
        email: body.email,
        password: body.password,
        ...(body.organizationId ? { organizationId: body.organizationId } : {}),
      },
      h.ctx.meta,
    );
    h.setSigninCookie(step.loginToken);
    return { next: step.next, methods: step.methods };
  },

  'auth.totp.enroll': async (_req, _reply, h) => {
    const { enrollmentToken } = h.body(EnrollmentStartRequest);
    return h.services.auth.startTotpEnrollment(h.cookie('signin'), enrollmentToken, h.ctx.meta);
  },

  'auth.totp.enroll.verify': async (_req, _reply, h) => {
    const { code, enrollmentToken } = h.body(TotpEnrollmentVerifyRequest);
    return signedIn(
      h,
      await h.services.auth.finishTotpEnrollment(
        h.cookie('signin'),
        enrollmentToken,
        code,
        h.ctx.meta,
      ),
    );
  },

  'auth.totp.verify': async (_req, _reply, h) => {
    const { code } = h.body(TotpCodeRequest);
    return signedIn(h, await h.services.auth.verifyTotpLogin(h.cookie('signin'), code, h.ctx.meta));
  },

  'auth.passkey.enroll.options': async (_req, _reply, h) => {
    const { enrollmentToken } = h.body(EnrollmentStartRequest);
    return h.services.auth.passkeyEnrollmentOptions(
      h.cookie('signin'),
      enrollmentToken,
      h.ctx.meta,
    );
  },

  'auth.passkey.enroll.verify': async (_req, _reply, h) => {
    const { response, enrollmentToken } = h.body(PasskeyEnrollmentVerifyRequest);
    return signedIn(
      h,
      await h.services.auth.finishPasskeyEnrollment(
        h.cookie('signin'),
        enrollmentToken,
        response,
        h.ctx.meta,
      ),
    );
  },

  'auth.passkey.options': async (_req, _reply, h) =>
    h.services.auth.passkeyLoginOptions(h.cookie('signin'), h.ctx.meta),

  'auth.passkey.verify': async (_req, _reply, h) => {
    const { response } = h.body(PasskeyResponseRequest);
    return signedIn(
      h,
      await h.services.auth.verifyPasskeyLogin(h.cookie('signin'), response, h.ctx.meta),
    );
  },

  'auth.reauth.totp': async (_req, _reply, h) => {
    const { code } = h.body(TotpCodeRequest);
    return reauthed(await h.services.auth.reauthWithTotp(h.session(), code, h.ctx.meta));
  },

  'auth.reauth.passkey.options': async (_req, _reply, h) =>
    h.services.auth.reauthPasskeyOptions(h.session(), h.ctx.meta),

  'auth.reauth.passkey.verify': async (_req, _reply, h) => {
    const { response } = h.body(PasskeyResponseRequest);
    return reauthed(await h.services.auth.reauthWithPasskey(h.session(), response, h.ctx.meta));
  },

  'auth.logout': async (_req, reply, h) => {
    await h.services.auth.logout(h.session(), h.ctx.meta);
    h.clearSessionCookie();
    reply.status(204);
    return null;
  },
} satisfies Partial<Record<RouteId, Handler>>;
