/**
 * Platform email templates for identity flows.
 *
 * Safety rules (doc 14/22): subjects and bodies never embed raw tokens, codes,
 * passwords or other secrets; reset links carry the one-time token as the deep
 * link (it belongs to the recipient only, is short-lived and single-use).
 */
import type { AppConfig } from '../config/environment';

export type PlatformEmailTemplate =
  | 'password-reset'
  | 'lockout'
  | 'forced-logout'
  | 'recovery-code'
  | 'admin-password-changed'
  | 'admin-welcome'
  | 'verification';

export interface TemplateRender {
  subject: string;
  text: string;
}

export function renderPlatformEmail(
  config: AppConfig,
  template: PlatformEmailTemplate,
  params: Record<string, string>,
): TemplateRender {
  switch (template) {
    case 'password-reset':
      return {
        subject: 'Reset your Werefa password',
        text: [
          'We received a request to reset your Werefa password.',
          '',
          `Reset link (valid ${config.resetTokenTtlMinutes} minutes, one-time only):`,
          `${config.publicBaseUrl}/reset/${params.token}`,
          '',
          'If you did not request this, you can safely ignore this email.',
        ].join('\n'),
      };
    case 'lockout':
      return {
        subject: 'Werefa account temporarily locked',
        text: [
          'Your Werefa account was temporarily locked for 15 minutes after several',
          'failed sign-in attempts.',
          '',
          submitterLines(params),
          '',
          'If this was not you, change your password as soon as the lock expires and',
          'review your recent activity.',
        ].join('\n'),
      };
    case 'forced-logout':
      return {
        subject: 'You were signed out of Werefa',
        text: [
          'A Super Admin force-signed you out of all your Werefa sessions.',
          '',
          submitterLines(params),
          '',
          'Sign in again with your existing credentials. If you did not expect this,',
          'contact support and change your password.',
        ].join('\n'),
      };
    case 'recovery-code':
      return {
        subject: 'Your Werefa emergency recovery code',
        text: [
          'An emergency recovery code was requested for the Werefa Super Admin account.',
          '',
          `One-time code (valid ${config.recoveryCodeTtlMinutes} minutes):`,
          params.code,
          '',
          'Use it only at the Super Admin recovery screen. Do not share it.',
        ].join('\n'),
      };
    case 'admin-password-changed':
      return {
        subject: 'Your Werefa password was updated',
        text: [
          'A Super Admin changed the password for your Werefa account.',
          '',
          submitterLines(params),
          '',
          'All your existing sessions were signed out. If you did not expect this,',
          'contact a Super Admin immediately.',
        ].join('\n'),
      };
    case 'admin-welcome':
      return {
        subject: 'Your Werefa Admin account is ready',
        text: [
          'A Super Admin has created a Werefa Admin account for you.',
          '',
          `Account email: ${params.email}`,
          '',
          'Your initial credentials were provided to you out-of-band by a Super',
          'Admin — they are not included in this email for your security.',
          '',
          `Sign in at: ${config.publicBaseUrl}`,
          '',
          'If you did not expect this email, contact a Super Admin immediately.',
        ].join('\n'),
      };
    case 'verification':
      return {
        subject: 'Verify your Werefa account',
        text: [
          'Welcome to Werefa! Confirm your email to finish creating your account.',
          '',
          `Verification link (valid ${config.verificationTokenTtlMinutes} minutes, one-time only):`,
          `${config.publicBaseUrl}/verify/${params.token}`,
          '',
          'If you did not create a Werefa account, you can safely ignore this email.',
        ].join('\n'),
      };
  }
}

function submitterLines(params: Record<string, string>): string {
  const lines: string[] = [];
  if (params.ip) lines.push(`IP address: ${params.ip}`);
  const deviceBrowser = [params.device, params.browser].filter(Boolean).join(' / ');
  if (deviceBrowser) lines.push(`Device / browser: ${deviceBrowser}`);
  if (params.when) lines.push(`Time: ${params.when}`);
  return lines.length ? lines.join('\n') : 'No attempt details were recorded.';
}
